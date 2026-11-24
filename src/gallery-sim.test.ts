import test from "node:test";
import assert from "node:assert/strict";
import {
  CLEAN_HITS_TO_END,
  MISS_SCORE,
  MIN_SHOT_GAP_SEC,
  TARGET_COUNT,
} from "./gallery-protocol.ts";
import {
  CAMERA_ORIGIN,
  aimAt,
  evaluateRound,
  layoutAt,
  type Vec3,
} from "./gallery-sim.ts";

const SEED = "0123456789abcdef0123456789abcdef";

function bullseye(targetIndex: number, t: number, seed = SEED) {
  const target = layoutAt(seed, t)[targetIndex]!;
  return { t, ...aimAt(CAMERA_ORIGIN, target.position) };
}

function offTarget(t: number) {
  return { t, yaw: 1.05, pitch: -0.55 };
}

function spaced(times: number[], targetFor: (t: number, i: number) => ReturnType<typeof bullseye> | ReturnType<typeof offTarget>) {
  return times.map((t, i) => targetFor(t, i));
}

test("four bullseyes skip the fifth shot and land on the 20 floor", () => {
  const times = [0.5, 0.5 + MIN_SHOT_GAP_SEC, 0.5 + MIN_SHOT_GAP_SEC * 2, 0.5 + MIN_SHOT_GAP_SEC * 3, 0.5 + MIN_SHOT_GAP_SEC * 4];
  const forfeitIndex = 5;
  const shots = spaced(times, (t, i) => bullseye(i, t));
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex,
    shots,
    elapsedSec: 8,
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
  const times = [0.6, 0.6 + MIN_SHOT_GAP_SEC];
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 1,
    shots: [bullseye(0, times[0]!), bullseye(1, times[1]!)],
    elapsedSec: 5,
  });
  assert.ok(!("error" in result));
  assert.equal(result.status, "forfeit");
  if (result.status !== "forfeit") return;
  assert.equal(result.score, null);
  assert.equal(result.shots[1]?.forfeit, true);
  assert.equal(result.shots[1]?.targetIndex, 1);
});

test("a miss scores 25 and still uses a shot", () => {
  const times = [0.5, 0.5 + MIN_SHOT_GAP_SEC, 0.5 + MIN_SHOT_GAP_SEC * 2, 0.5 + MIN_SHOT_GAP_SEC * 3, 0.5 + MIN_SHOT_GAP_SEC * 4];
  const shots = spaced(times, (t, i) => (i === 0 ? offTarget(t) : bullseye(i - 1, t)));
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots,
    elapsedSec: 8,
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
  const t1 = 0.8;
  const t2 = 0.8 + MIN_SHOT_GAP_SEC;
  const first = bullseye(2, t1);
  const result = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [first, bullseye(2, t2)],
    elapsedSec: 4,
  });
  assert.ok(!("error" in result));
  assert.equal(result.status, "scored");
  if (result.status !== "scored") return;
  assert.equal(result.shots[0]?.targetIndex, 2);
  assert.equal(result.shots[1]?.targetIndex, null);
  assert.equal(result.shots[1]?.points, MISS_SCORE);
});

test("shots that are too fast or out of order are rejected", () => {
  const fast = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [bullseye(0, 0.5), bullseye(1, 0.6)],
    elapsedSec: 2,
  });
  assert.deepEqual(fast, { error: "Shots too fast" });
  const order = evaluateRound({
    seed: SEED,
    forfeitIndex: 5,
    shots: [bullseye(0, 1.2), bullseye(1, 0.5)],
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
