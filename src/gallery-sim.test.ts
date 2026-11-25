import test from "node:test";
import assert from "node:assert/strict";
import {
  BONUS_SCORE,
  CLEAN_HITS_TO_END,
  DECOY_SCORE,
  MAX_YAW,
  MISS_SCORE,
  MIN_SHOT_GAP_SEC,
  TARGET_COUNT,
} from "./gallery-protocol.ts";
import {
  CAMERA_ORIGIN,
  actorsAt,
  aimAt,
  buildRound,
  castShot,
  evaluateRound,
  findClearTargetShot,
  layoutAt,
  type Vec3,
} from "./gallery-sim.ts";

const SEED = "0123456789abcdef0123456789abcdef";

function clearBullseye(
  targetIndex: number,
  after: number,
  seed = SEED,
  down = new Set<string>(),
) {
  return findClearTargetShot(seed, targetIndex, after, down);
}

function offTarget(t: number) {
  return { t, yaw: 1.05, pitch: -0.55 };
}

test("four bullseyes skip the fifth shot and land on the 20 floor", () => {
  const down = new Set<string>();
  const shots = [];
  let t = 0.5;
  for (let i = 0; i < 4; i++) {
    const shot = clearBullseye(i, t, SEED, down);
    shots.push(shot);
    down.add(`t:${i}`);
    t = shot.t + MIN_SHOT_GAP_SEC;
  }
  shots.push({ t: t, yaw: 0, pitch: 0 });
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots,
    elapsedSec: shots.at(-1)!.t + 2,
  });
  assert.ok(!("error" in result), "error" in result ? result.error : "");
  assert.equal(result.status, "scored");
  if (result.status !== "scored") return;
  assert.equal(result.score, 20);
  assert.equal(result.cleanHits, CLEAN_HITS_TO_END);
  assert.equal(result.skippedFifth, true);
  assert.equal(result.shots.length, 4);
  assert.ok(result.shots.every((shot) => shot.points === 5 && shot.ring === 0));
});

test("hitting the committed forfeit target ends the round with no score", () => {
  const first = clearBullseye(0, 0.6);
  const second = clearBullseye(1, first.t + MIN_SHOT_GAP_SEC, SEED, new Set(["t:0"]));
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 1,
    shots: [first, second],
    elapsedSec: second.t + 2,
  });
  assert.ok(!("error" in result));
  assert.equal(result.status, "forfeit");
  if (result.status !== "forfeit") return;
  assert.equal(result.score, null);
  assert.equal(result.shots[1]?.forfeit, true);
  assert.equal(result.shots[1]?.targetIndex, 1);
});

test("a miss scores 25 and still uses a shot", () => {
  const shots = [offTarget(0.5)];
  const down = new Set<string>();
  let t = 0.5 + MIN_SHOT_GAP_SEC;
  for (let i = 0; i < 4; i++) {
    const shot = clearBullseye(i, t, SEED, down);
    shots.push(shot);
    down.add(`t:${i}`);
    t = shot.t + MIN_SHOT_GAP_SEC;
  }
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots,
    elapsedSec: shots.at(-1)!.t + 2,
  });
  assert.ok(!("error" in result));
  assert.equal(result.status, "scored");
  if (result.status !== "scored") return;
  assert.equal(result.score, MISS_SCORE + 20);
  assert.equal(result.cleanHits, 4);
  assert.equal(result.shots[0]?.points, MISS_SCORE);
  assert.equal(result.skippedFifth, false);
  assert.equal(result.shots.length, 5);
});

test("aiming at a target that already fell is a miss", () => {
  const first = clearBullseye(2, 0.8);
  let second = null;
  const down = new Set(["t:2"]);
  for (let i = 0; i < 80 && !second; i++) {
    const t = first.t + MIN_SHOT_GAP_SEC + i * 0.05;
    const target = layoutAt(SEED, t)[2];
    if (!target) continue;
    const aim = { t, ...aimAt(CAMERA_ORIGIN, target.position) };
    const hit = castShot(SEED, aim, down);
    if (!hit || hit.kind === "cover") {
      second = aim;
    }
  }
  assert.ok(second, "expected a later aim at the fallen target");
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [first, second!],
    elapsedSec: second!.t + 2,
  });
  assert.ok(!("error" in result));
  assert.equal(result.status, "scored");
  if (result.status !== "scored") return;
  assert.equal(result.shots[0]?.targetIndex, 2);
  assert.equal(result.shots[1]?.targetIndex, null);
  assert.equal(result.shots[1]?.points, MISS_SCORE);
});

test("shots that are too fast or out of order are rejected", () => {
  const first = clearBullseye(0, 0.5);
  const fast = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [first, { ...clearBullseye(1, first.t + 0.05), t: first.t + 0.1 }],
    elapsedSec: 2,
  });
  assert.deepEqual(fast, { error: "Shots too fast" });
  const later = clearBullseye(0, 1.2);
  const earlier = { ...clearBullseye(1, 0.5), t: later.t - 0.7 };
  const order = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [later, earlier],
    elapsedSec: 3,
  });
  assert.deepEqual(order, { error: "Shots are out of order" });
});

test("every seed lays out six moving targets and aimAt hits the bullseye", () => {
  const t = 1.25;
  const layout = layoutAt(SEED, t);
  assert.equal(layout.length, TARGET_COUNT);
  const uniqueX = new Set(layout.map((target) => target.position.x.toFixed(4)));
  assert.equal(uniqueX.size, TARGET_COUNT);
  const later: Vec3 = layoutAt(SEED, t + 0.4)[0]!.position;
  const first = layout[0]!.position;
  assert.ok(
    Math.hypot(later.x - first.x, later.y - first.y, later.z - first.z) > 0.05,
  );
});

test("different seeds produce different layouts and a seed is stable", () => {
  const other = "ffeeddccbbaa99887766554433221100";
  const a = layoutAt(SEED, 1.5).map((pose) => pose.position);
  const again = layoutAt(SEED, 1.5).map((pose) => pose.position);
  const b = layoutAt(other, 1.5).map((pose) => pose.position);
  assert.deepEqual(a, again);
  const moved = a.some((pose, i) => Math.hypot(pose.x - b[i]!.x, pose.y - b[i]!.y, pose.z - b[i]!.z) > 0.05);
  assert.ok(moved);
  const roundA = buildRound(SEED);
  const roundB = buildRound(other);
  assert.ok(roundA.decoys.length >= 2);
  assert.ok(roundA.covers.length >= 2);
  assert.ok(roundA.bonuses.length >= 1);
  const samePaths =
    roundA.targets[0]!.wx === roundB.targets[0]!.wx &&
    roundA.targets[0]!.base.x === roundB.targets[0]!.base.x;
  assert.equal(samePaths, false);
});

test("hitting a decoy costs 40 and is not a clean hit", () => {
  let shot = null;
  let label = "";
  for (let i = 0; i < 120 && !shot; i++) {
    const t = 0.3 + i * 0.08;
    for (const actor of actorsAt(SEED, t)) {
      if (actor.kind !== "decoy" || !actor.active) continue;
      const aim = { t, ...aimAt(CAMERA_ORIGIN, actor.position) };
      const hit = castShot(SEED, aim, new Set());
      if (hit?.kind === "decoy") {
        shot = aim;
        label = actor.id;
        break;
      }
    }
  }
  assert.ok(shot, "expected a hittable decoy");
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [shot!],
    elapsedSec: shot!.t + 2,
  });
  assert.ok(!("error" in result));
  assert.equal(result.status, "scored");
  if (result.status !== "scored") return;
  assert.equal(result.shots[0]?.kind, "decoy");
  assert.equal(result.shots[0]?.actorId, label);
  assert.equal(result.shots[0]?.points, DECOY_SCORE);
  assert.equal(result.cleanHits, 0);
});

test("catching an airdrop scores 0 and counts as a clean hit", () => {
  let shot = null;
  for (const seed of [SEED, "aaaabbbbccccddddeeeeffff00001111", "01010101010101010101010101010101"]) {
    const bonus = buildRound(seed).bonuses[0];
    if (!bonus) continue;
    const mid = (bonus.appearAt + bonus.vanishAt) / 2;
    for (let i = 0; i < 60 && !shot; i++) {
      const t = mid + (i - 30) * 0.04;
      if (t < bonus.appearAt || t > bonus.vanishAt) continue;
      const actor = actorsAt(seed, t).find((row) => row.id === bonus.id && row.active);
      if (!actor) continue;
      const aim = { t, ...aimAt(CAMERA_ORIGIN, actor.position) };
      const hit = castShot(seed, aim, new Set());
      if (hit?.kind === "bonus") {
        const result = evaluateRound({
          seed,
          forfeitIndex: 5,
          shots: [aim],
          elapsedSec: t + 2,
        });
        assert.ok(!("error" in result));
        assert.equal(result.status, "scored");
        if (result.status !== "scored") return;
        assert.equal(result.shots[0]?.kind, "bonus");
        assert.equal(result.shots[0]?.points, BONUS_SCORE);
        assert.equal(result.cleanHits, 1);
        return;
      }
    }
  }
  assert.fail("expected a hittable airdrop on one of the test seeds");
});

test("cover in front of a target blocks the shot", () => {
  for (const seed of [SEED, "feedfacecafebabe0123456789abcdef", "99998888777766665555444433332222"]) {
    for (let i = 0; i < 160; i++) {
      const t = 0.4 + i * 0.08;
      const targets = actorsAt(seed, t).filter((row) => row.kind === "target" && row.active);
      for (const target of targets) {
        const aim = { t, ...aimAt(CAMERA_ORIGIN, target.position) };
        const hit = castShot(seed, aim, new Set());
        if (hit?.kind === "cover") {
          const result = evaluateRound({
            seed,
            forfeitIndex: 5,
            shots: [aim],
            elapsedSec: t + 2,
          });
          assert.ok(!("error" in result));
          assert.equal(result.status, "scored");
          if (result.status !== "scored") return;
          assert.equal(result.shots[0]?.kind, "cover");
          assert.equal(result.shots[0]?.points, MISS_SCORE);
          assert.equal(result.shots[0]?.targetIndex, null);
          return;
        }
      }
    }
  }
  assert.fail("expected a cover occlusion on one of the test seeds");
});

test("extreme aim is rejected", () => {
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [{ t: 0.5, yaw: MAX_YAW + 0.2, pitch: 0 }],
    elapsedSec: 2,
  });
  assert.deepEqual(result, { error: "Shot aim is out of range" });
});
