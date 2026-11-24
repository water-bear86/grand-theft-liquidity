import {
  CLEAN_HITS_TO_END,
  MISS_SCORE,
  SHOT_COUNT,
  TARGET_COUNT,
  TARGET_RADIUS,
  MIN_SHOT_GAP_SEC,
  MAX_ROUND_SEC,
  scoreFromRadius,
  type RoundEvaluation,
  type ShotInput,
  type ShotOutcome,
} from "./gallery-protocol.ts";

export const CAMERA_ORIGIN = { x: 0, y: 1.35, z: 0 } as const;
export const TARGET_BASE_Z = -15.4;
export const TARGET_BASE_Y = 1.55;
export const TARGET_SPACING = 1.85;

export type Vec3 = { x: number; y: number; z: number };

export type TargetMotion = {
  index: number;
  base: Vec3;
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

export type TargetPose = {
  index: number;
  position: Vec3;
  normal: Vec3;
  radius: number;
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

export function targetMotions(seed: string): TargetMotion[] {
  const motions: TargetMotion[] = [];
  const mid = (TARGET_COUNT - 1) / 2;
  for (let i = 0; i < TARGET_COUNT; i++) {
    motions.push({
      index: i,
      base: {
        x: (i - mid) * TARGET_SPACING,
        y: TARGET_BASE_Y + ranged(seed, `by:${i}`, -0.12, 0.12),
        z: TARGET_BASE_Z + ranged(seed, `bz:${i}`, -0.35, 0.2),
      },
      ax: ranged(seed, `ax:${i}`, 0.55, 1.45),
      wx: ranged(seed, `wx:${i}`, 1.15, 2.55),
      px: ranged(seed, `px:${i}`, 0, Math.PI * 2),
      ax2: ranged(seed, `ax2:${i}`, 0.12, 0.4),
      wx2: ranged(seed, `wx2:${i}`, 2.4, 4.2),
      px2: ranged(seed, `px2:${i}`, 0, Math.PI * 2),
      ay: ranged(seed, `ay:${i}`, 0.28, 0.75),
      wy: ranged(seed, `wy:${i}`, 1.35, 2.8),
      py: ranged(seed, `py:${i}`, 0, Math.PI * 2),
      az: ranged(seed, `az:${i}`, 0.15, 0.45),
      wz: ranged(seed, `wz:${i}`, 0.7, 1.6),
      pz: ranged(seed, `pz:${i}`, 0, Math.PI * 2),
    });
  }
  return motions;
}

export function targetPoseAt(motion: TargetMotion, t: number): TargetPose {
  const { base } = motion;
  return {
    index: motion.index,
    position: {
      x:
        base.x +
        motion.ax * Math.sin(t * motion.wx + motion.px) +
        motion.ax2 * Math.sin(t * motion.wx2 + motion.px2),
      y: base.y + motion.ay * Math.sin(t * motion.wy + motion.py),
      z: base.z + motion.az * Math.sin(t * motion.wz + motion.pz),
    },
    normal: { x: 0, y: 0, z: 1 },
    radius: TARGET_RADIUS,
  };
}

export function layoutAt(seed: string, t: number): TargetPose[] {
  return targetMotions(seed).map((motion) => targetPoseAt(motion, t));
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
  target: TargetPose,
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
  return radial / target.radius;
}

export type CastHit = {
  targetIndex: number;
  radiusFraction: number;
};

export function castShot(seed: string, shot: ShotInput, down: Set<number>): CastHit | null {
  const direction = aimDirection(shot.yaw, shot.pitch);
  const layout = layoutAt(seed, shot.t);
  let best: CastHit | null = null;
  for (const target of layout) {
    if (down.has(target.index)) continue;
    const fraction = interceptDisc(CAMERA_ORIGIN, direction, target);
    if (fraction == null) continue;
    if (!best || fraction < best.radiusFraction)
      best = { targetIndex: target.index, radiusFraction: fraction };
  }
  return best;
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
    if (shot.t + 1e-6 < previous) return { error: "Shots are out of order" };
    if (previous > -Infinity && shot.t - previous < MIN_SHOT_GAP_SEC - 1e-6)
      return { error: "Shots too fast" };
    if (shot.t > elapsedSec + 0.35) return { error: "Shot is later than the clock" };
    previous = shot.t;
  }
  return null;
}

export function evaluateRound(input: {
  seed: string;
  forfeitIndex: number;
  shots: ShotInput[];
  elapsedSec: number;
}): RoundEvaluation | ShotValidationError {
  const invalid = validateShotSequence(input.shots, input.elapsedSec);
  if (invalid) return invalid;
  const down = new Set<number>();
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
    if (!hit) {
      const miss: ShotOutcome = {
        t: shot.t,
        targetIndex: null,
        radiusFraction: null,
        points: MISS_SCORE,
        ring: -1,
        forfeit: false,
        counted: true,
      };
      shots.push(miss);
      score += MISS_SCORE;
      continue;
    }
    const forfeit = hit.targetIndex === input.forfeitIndex;
    const ring = scoreFromRadius(hit.radiusFraction);
    const outcome: ShotOutcome = {
      t: shot.t,
      targetIndex: hit.targetIndex,
      radiusFraction: hit.radiusFraction,
      points: forfeit ? 0 : ring.points,
      ring: forfeit ? -1 : ring.ring,
      forfeit,
      counted: true,
    };
    shots.push(outcome);
    down.add(hit.targetIndex);
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
  return {
    status: "scored",
    score,
    shots,
    cleanHits,
    skippedFifth,
  };
}
