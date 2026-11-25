import {
  BONUS_RADIUS,
  BONUS_SCORE,
  CLEAN_HITS_TO_END,
  DECOY_SCORE,
  MAX_PITCH,
  MAX_YAW,
  MISS_SCORE,
  SHOT_COUNT,
  TARGET_COUNT,
  TARGET_RADIUS,
  MIN_SHOT_GAP_SEC,
  MAX_ROUND_SEC,
  scoreFromRadius,
  type RoundEvaluation,
  type ShotInput,
  type ShotKind,
  type ShotOutcome,
} from "./gallery-protocol.ts";

export const CAMERA_ORIGIN = { x: 0, y: 1.35, z: 0 } as const;
export const TARGET_BASE_Z = -15.4;
export const TARGET_BASE_Y = 1.55;
export const TARGET_SPACING = 1.85;

export type Vec3 = { x: number; y: number; z: number };

export type ActorKind = "target" | "decoy" | "bonus" | "cover";
export type DecoyLabel = "rug" | "bystander";

type PathKind = "bob" | "sweep" | "zigzag" | "dart";

type DiscActor = {
  kind: "target" | "decoy" | "bonus";
  id: string;
  index: number | null;
  label?: DecoyLabel;
  radius: number;
  appearAt: number;
  vanishAt: number;
  base: Vec3;
  path: PathKind;
  ax: number;
  wx: number;
  px: number;
  ax2: number;
  wx2: number;
  px2: number;
  ay: number;
  wy: number;
  py: number;
  az: number;
  wz: number;
  pz: number;
};

type CoverActor = {
  kind: "cover";
  id: string;
  index: null;
  appearAt: number;
  vanishAt: number;
  base: Vec3;
  half: Vec3;
  ax: number;
  wx: number;
  px: number;
  ay: number;
  wy: number;
  py: number;
};

export type RoundActors = {
  targets: DiscActor[];
  decoys: DiscActor[];
  bonuses: DiscActor[];
  covers: CoverActor[];
};

export type TargetMotion = DiscActor;

export type TargetPose = {
  index: number;
  position: Vec3;
  normal: Vec3;
  radius: number;
};

export type ActorPose = {
  id: string;
  kind: ActorKind;
  index: number | null;
  label?: DecoyLabel;
  position: Vec3;
  normal: Vec3;
  radius: number;
  half?: Vec3;
  active: boolean;
};

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(seed: string, label: string): number {
  return hash32(`${seed}:${label}`) / 4294967296;
}

function ranged(seed: string, label: string, min: number, max: number): number {
  return min + unit(seed, label) * (max - min);
}

function shuffled(seed: string, label: string, count: number): number[] {
  const items = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(unit(seed, `${label}:${i}`) * (i + 1));
    const current = items[i]!;
    items[i] = items[j]!;
    items[j] = current;
  }
  return items;
}

const PATHS: PathKind[] = ["bob", "sweep", "zigzag", "dart"];

function discFromSeed(
  seed: string,
  id: string,
  kind: DiscActor["kind"],
  index: number | null,
  opts: {
    base: Vec3;
    radius: number;
    appearAt: number;
    vanishAt: number;
    label?: DecoyLabel;
    speed?: number;
  },
): DiscActor {
  const path = PATHS[Math.floor(unit(seed, `${id}:path`) * PATHS.length)]!;
  const speed = opts.speed ?? 1;
  return {
    kind,
    id,
    index,
    label: opts.label,
    radius: opts.radius,
    appearAt: opts.appearAt,
    vanishAt: opts.vanishAt,
    base: opts.base,
    path,
    ax: ranged(seed, `${id}:ax`, 0.45, 1.85) * (path === "sweep" || path === "dart" ? 1.35 : 1),
    wx: ranged(seed, `${id}:wx`, 0.85, 2.7) * speed * (path === "dart" ? 1.8 : 1),
    px: ranged(seed, `${id}:px`, 0, Math.PI * 2),
    ax2: ranged(seed, `${id}:ax2`, 0.08, 0.55),
    wx2: ranged(seed, `${id}:wx2`, 1.8, 4.6) * speed,
    px2: ranged(seed, `${id}:px2`, 0, Math.PI * 2),
    ay: ranged(seed, `${id}:ay`, 0.22, 0.95) * (path === "bob" ? 1.25 : 1),
    wy: ranged(seed, `${id}:wy`, 1.05, 3.1) * speed,
    py: ranged(seed, `${id}:py`, 0, Math.PI * 2),
    az: ranged(seed, `${id}:az`, 0.12, 0.7),
    wz: ranged(seed, `${id}:wz`, 0.55, 1.9) * speed,
    pz: ranged(seed, `${id}:pz`, 0, Math.PI * 2),
  };
}

function positionOf(actor: DiscActor, t: number): Vec3 {
  const { base, path } = actor;
  const sweep = path === "sweep" ? Math.sin(t * actor.wx * 0.55 + actor.px) : Math.sin(t * actor.wx + actor.px);
  const dart = path === "dart" ? Math.sin(t * actor.wx + actor.px) * Math.sin(t * actor.wx * 0.5 + actor.px2) : 0;
  const zigzag = path === "zigzag" ? (Math.asin(Math.sin(t * actor.wx + actor.px)) / (Math.PI / 2)) : sweep;
  const xWave = path === "zigzag" ? zigzag : path === "dart" ? dart : sweep;
  return {
    x: base.x + actor.ax * xWave + actor.ax2 * Math.sin(t * actor.wx2 + actor.px2),
    y: base.y + actor.ay * Math.sin(t * actor.wy + actor.py),
    z: base.z + actor.az * Math.sin(t * actor.wz + actor.pz),
  };
}

function coverPosition(actor: CoverActor, t: number): Vec3 {
  return {
    x: actor.base.x + actor.ax * Math.sin(t * actor.wx + actor.px),
    y: actor.base.y + actor.ay * Math.sin(t * actor.wy + actor.py),
    z: actor.base.z,
  };
}

function isActive(actor: { appearAt: number; vanishAt: number }, t: number): boolean {
  return t + 1e-9 >= actor.appearAt && t <= actor.vanishAt;
}

export function buildRound(seed: string): RoundActors {
  const mid = (TARGET_COUNT - 1) / 2;
  const lanes = shuffled(seed, "lanes", TARGET_COUNT);
  const targets: DiscActor[] = [];
  for (let i = 0; i < TARGET_COUNT; i++) {
    const lane = lanes[i]!;
    targets.push(
      discFromSeed(seed, `t:${i}`, "target", i, {
        radius: TARGET_RADIUS,
        appearAt: 0,
        vanishAt: MAX_ROUND_SEC + 5,
        base: {
          x: (lane - mid) * TARGET_SPACING + ranged(seed, `tx:${i}`, -0.55, 0.55),
          y: TARGET_BASE_Y + ranged(seed, `ty:${i}`, -0.28, 0.42),
          z: TARGET_BASE_Z + ranged(seed, `tz:${i}`, -1.8, 1.35),
        },
      }),
    );
  }

  const decoyLabels: DecoyLabel[] = unit(seed, "decoy-order") > 0.5 ? ["rug", "bystander"] : ["bystander", "rug"];
  const decoys = decoyLabels.map((label, i) =>
    discFromSeed(seed, `d:${label}`, "decoy", null, {
      label,
      radius: TARGET_RADIUS * 0.92,
      appearAt: ranged(seed, `d-on:${i}`, 0.2, 2.2),
      vanishAt: MAX_ROUND_SEC + 5,
      base: {
        x: ranged(seed, `dx:${i}`, -5.6, 5.6),
        y: ranged(seed, `dy:${i}`, 1.15, 2.35),
        z: ranged(seed, `dz:${i}`, -17.4, -12.2),
      },
    }),
  );

  const bonuses: DiscActor[] = [];
  const bonusCount = 1 + (unit(seed, "bonus-count") > 0.45 ? 1 : 0);
  for (let i = 0; i < bonusCount; i++) {
    const appearAt = ranged(seed, `b-on:${i}`, 1.2 + i * 3.5, 3.4 + i * 5);
    bonuses.push(
      discFromSeed(seed, `b:${i}`, "bonus", null, {
        radius: BONUS_RADIUS,
        appearAt,
        vanishAt: appearAt + ranged(seed, `b-life:${i}`, 2.1, 3.4),
        speed: 1.7,
        base: {
          x: ranged(seed, `bx:${i}`, -4.8, 4.8),
          y: ranged(seed, `by:${i}`, 1.6, 2.7),
          z: ranged(seed, `bz:${i}`, -16.8, -12.6),
        },
      }),
    );
  }

  const covers: CoverActor[] = [];
  const coverCount = 2 + (unit(seed, "cover-count") > 0.5 ? 1 : 0);
  for (let i = 0; i < coverCount; i++) {
    covers.push({
      kind: "cover",
      id: `c:${i}`,
      index: null,
      appearAt: 0,
      vanishAt: MAX_ROUND_SEC + 5,
      base: {
        x: ranged(seed, `cx:${i}`, -4.8, 4.8),
        y: ranged(seed, `cy:${i}`, 0.7, 1.45),
        z: ranged(seed, `cz:${i}`, -12.8, -8.8),
      },
      half: {
        x: ranged(seed, `chx:${i}`, 0.38, 0.72),
        y: ranged(seed, `chy:${i}`, 0.42, 0.85),
        z: ranged(seed, `chz:${i}`, 0.22, 0.38),
      },
      ax: ranged(seed, `cax:${i}`, 0.7, 2.2),
      wx: ranged(seed, `cwx:${i}`, 0.35, 0.9),
      px: ranged(seed, `cpx:${i}`, 0, Math.PI * 2),
      ay: ranged(seed, `cay:${i}`, 0.05, 0.18),
      wy: ranged(seed, `cwy:${i}`, 0.6, 1.4),
      py: ranged(seed, `cpy:${i}`, 0, Math.PI * 2),
    });
  }

  return { targets, decoys, bonuses, covers };
}

let cached: { seed: string; actors: RoundActors } | null = null;

export function roundActors(seed: string): RoundActors {
  if (cached?.seed === seed) return cached.actors;
  const actors = buildRound(seed);
  cached = { seed, actors };
  return actors;
}

export function targetMotions(seed: string): TargetMotion[] {
  return roundActors(seed).targets;
}

export function targetPoseAt(motion: TargetMotion, t: number): TargetPose {
  const position = positionOf(motion, t);
  return {
    index: motion.index ?? 0,
    position,
    normal: { x: 0, y: 0, z: 1 },
    radius: motion.radius,
  };
}

export function layoutAt(seed: string, t: number): TargetPose[] {
  return roundActors(seed).targets.map((motion) => targetPoseAt(motion, t));
}

export function actorsAt(seed: string, t: number): ActorPose[] {
  const round = roundActors(seed);
  const poses: ActorPose[] = [];
  for (const actor of [...round.targets, ...round.decoys, ...round.bonuses]) {
    poses.push({
      id: actor.id,
      kind: actor.kind,
      index: actor.index,
      label: actor.label,
      position: positionOf(actor, t),
      normal: { x: 0, y: 0, z: 1 },
      radius: actor.radius,
      active: isActive(actor, t),
    });
  }
  for (const cover of round.covers) {
    poses.push({
      id: cover.id,
      kind: "cover",
      index: null,
      position: coverPosition(cover, t),
      normal: { x: 0, y: 0, z: 1 },
      radius: 0,
      half: cover.half,
      active: isActive(cover, t),
    });
  }
  return poses;
}

export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

export function aimAt(origin: Vec3, target: Vec3): { yaw: number; pitch: number } {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const horiz = Math.hypot(dx, dz);
  return {
    yaw: Math.atan2(dx, -dz),
    pitch: Math.atan2(dy, horiz),
  };
}

function interceptDisc(
  origin: Vec3,
  direction: Vec3,
  target: { position: Vec3; normal: Vec3; radius: number },
): number | null {
  const denom =
    direction.x * target.normal.x +
    direction.y * target.normal.y +
    direction.z * target.normal.z;
  if (Math.abs(denom) < 1e-8) return null;
  const to =
    (target.position.x - origin.x) * target.normal.x +
    (target.position.y - origin.y) * target.normal.y +
    (target.position.z - origin.z) * target.normal.z;
  const distance = to / denom;
  if (distance <= 0) return null;
  const hit = {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
  const radial = Math.hypot(
    hit.x - target.position.x,
    hit.y - target.position.y,
    hit.z - target.position.z,
  );
  if (radial > target.radius + 1e-7) return null;
  return distance;
}

function interceptAabb(
  origin: Vec3,
  direction: Vec3,
  center: Vec3,
  half: Vec3,
): number | null {
  let tMin = 0;
  let tMax = Infinity;
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const o = origin[axis];
    const d = direction[axis];
    const min = center[axis] - half[axis];
    const max = center[axis] + half[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMin <= 0) return tMax > 0 ? tMax : null;
  return tMin;
}

export type CastHit = {
  targetIndex: number | null;
  kind: Exclude<ShotKind, "miss">;
  actorId: string;
  radiusFraction: number;
  distance: number;
  label?: DecoyLabel;
};

export function castShot(seed: string, shot: ShotInput, down: Set<string>): CastHit | null {
  const direction = aimDirection(shot.yaw, shot.pitch);
  const layout = actorsAt(seed, shot.t);
  let best: CastHit | null = null;
  for (const actor of layout) {
    if (!actor.active) continue;
    if (actor.kind !== "cover" && down.has(actor.id)) continue;
    if (actor.kind === "cover" && actor.half) {
      const distance = interceptAabb(CAMERA_ORIGIN, direction, actor.position, actor.half);
      if (distance == null) continue;
      const hit: CastHit = {
        targetIndex: null,
        kind: "cover",
        actorId: actor.id,
        radiusFraction: 1,
        distance,
      };
      if (!best || hit.distance < best.distance) best = hit;
      continue;
    }
    const distance = interceptDisc(CAMERA_ORIGIN, direction, actor);
    if (distance == null) continue;
    const radial = (() => {
      const hitPoint = {
        x: CAMERA_ORIGIN.x + direction.x * distance,
        y: CAMERA_ORIGIN.y + direction.y * distance,
        z: CAMERA_ORIGIN.z + direction.z * distance,
      };
      return Math.hypot(
        hitPoint.x - actor.position.x,
        hitPoint.y - actor.position.y,
        hitPoint.z - actor.position.z,
      );
    })();
    const hit: CastHit = {
      targetIndex: actor.index,
      kind: actor.kind === "decoy" ? "decoy" : actor.kind === "bonus" ? "bonus" : "target",
      actorId: actor.id,
      radiusFraction: actor.radius > 0 ? radial / actor.radius : 1,
      distance,
      label: actor.label,
    };
    if (!best || hit.distance < best.distance) best = hit;
  }
  return best;
}


export function findClearTargetShot(
  seed: string,
  targetIndex: number,
  after: number,
  down: ReadonlySet<string> = new Set(),
  window = 8,
): ShotInput {
  const owned = new Set(down);
  for (let i = 0; i < Math.ceil(window / 0.05); i++) {
    const t = after + i * 0.05;
    const target = layoutAt(seed, t)[targetIndex];
    if (!target) continue;
    const shot = { t, ...aimAt(CAMERA_ORIGIN, target.position) };
    const hit = castShot(seed, shot, owned);
    if (hit?.kind === "target" && hit.targetIndex === targetIndex) return shot;
  }
  throw new Error(`no clear shot at target ${targetIndex} after ${after}`);
}

export type ShotValidationError = { error: string };

export function validateShotSequence(
  shots: ShotInput[],
  elapsedSec: number,
): ShotValidationError | null {
  if (shots.length > SHOT_COUNT) return { error: "Too many shots" };
  if (elapsedSec > MAX_ROUND_SEC + 0.001) return { error: "Round expired" };
  let previous = -Infinity;
  for (const shot of shots) {
    if (!Number.isFinite(shot.t) || !Number.isFinite(shot.yaw) || !Number.isFinite(shot.pitch))
      return { error: "Shot aim is invalid" };
    if (Math.abs(shot.yaw) > MAX_YAW + 1e-6 || Math.abs(shot.pitch) > MAX_PITCH + 1e-6)
      return { error: "Shot aim is out of range" };
    if (shot.t + 1e-6 < previous) return { error: "Shots are out of order" };
    if (previous > -Infinity && shot.t - previous < MIN_SHOT_GAP_SEC - 1e-6)
      return { error: "Shots too fast" };
    if (shot.t > elapsedSec + 0.35) return { error: "Shot is later than the clock" };
    previous = shot.t;
  }
  return null;
}

function missOutcome(t: number, kind: ShotKind = "miss", actorId: string | null = null): ShotOutcome {
  return {
    t,
    targetIndex: null,
    actorId,
    kind,
    radiusFraction: null,
    points: MISS_SCORE,
    ring: -1,
    forfeit: false,
    counted: true,
  };
}

export function evaluateRound(input: {
  seed: string;
  forfeitIndex: number;
  shots: ShotInput[];
  elapsedSec: number;
}): RoundEvaluation | ShotValidationError {
  const invalid = validateShotSequence(input.shots, input.elapsedSec);
  if (invalid) return invalid;
  const down = new Set<string>();
  const shots: ShotOutcome[] = [];
  let score = 0;
  let cleanHits = 0;
  let skippedFifth = false;
  for (const shot of input.shots) {
    if (cleanHits >= CLEAN_HITS_TO_END) {
      skippedFifth = true;
      break;
    }
    const hit = castShot(input.seed, shot, down);
    if (!hit || hit.kind === "cover") {
      const miss = missOutcome(shot.t, hit?.kind === "cover" ? "cover" : "miss", hit?.actorId ?? null);
      shots.push(miss);
      score += miss.points;
      continue;
    }
    if (hit.kind === "decoy") {
      down.add(hit.actorId);
      const outcome: ShotOutcome = {
        t: shot.t,
        targetIndex: null,
        actorId: hit.actorId,
        kind: "decoy",
        radiusFraction: hit.radiusFraction,
        points: DECOY_SCORE,
        ring: -1,
        forfeit: false,
        counted: true,
      };
      shots.push(outcome);
      score += DECOY_SCORE;
      continue;
    }
    if (hit.kind === "bonus") {
      down.add(hit.actorId);
      const outcome: ShotOutcome = {
        t: shot.t,
        targetIndex: null,
        actorId: hit.actorId,
        kind: "bonus",
        radiusFraction: hit.radiusFraction,
        points: BONUS_SCORE,
        ring: 0,
        forfeit: false,
        counted: true,
      };
      shots.push(outcome);
      score += BONUS_SCORE;
      cleanHits++;
      continue;
    }
    const forfeit = hit.targetIndex === input.forfeitIndex;
    const ring = scoreFromRadius(hit.radiusFraction);
    const outcome: ShotOutcome = {
      t: shot.t,
      targetIndex: hit.targetIndex,
      actorId: hit.actorId,
      kind: "target",
      radiusFraction: hit.radiusFraction,
      points: forfeit ? 0 : ring.points,
      ring: forfeit ? -1 : ring.ring,
      forfeit,
      counted: true,
    };
    shots.push(outcome);
    down.add(hit.actorId);
    if (forfeit) {
      return {
        status: "forfeit",
        score: null,
        shots,
        cleanHits,
        skippedFifth: false,
      };
    }
    score += ring.points;
    cleanHits++;
  }
  if (cleanHits >= CLEAN_HITS_TO_END) skippedFifth = input.shots.length > shots.length || skippedFifth;
  // Unfired shots are misses. Without this, filing a card with fewer shots (or
  // none at all) scored lower, and lowest score wins the pot.
  if (cleanHits < CLEAN_HITS_TO_END) {
    for (let fired = shots.length; fired < SHOT_COUNT; fired++) {
      const miss = missOutcome(Math.min(input.elapsedSec, MAX_ROUND_SEC), "miss", null);
      shots.push(miss);
      score += miss.points;
    }
  }
  return {
    status: "scored",
    score,
    shots,
    cleanHits,
    skippedFifth,
  };
}
