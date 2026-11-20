export const RAMP_CENTERS = [-44, -136, -226, -314] as const;
export const FINAL_RAMP = RAMP_CENTERS[RAMP_CENTERS.length - 1];
export const RAMP_LENGTH = 9.5;
export const RAMP_HALF_WIDTH = 2.4;
export const RAMP_HEIGHT = 1.9;
const SEGMENTS = 10;

export const rampLip = (center: number) => center - RAMP_LENGTH / 2;
export const rampProgress = (z: number, center: number) =>
  Math.max(0, Math.min(1, (center + RAMP_LENGTH / 2 - z) / RAMP_LENGTH));

export function rampHeight(u: number) {
  // The street collider is at -0.05. Bury the toe so a tire never hits a vertical seam.
  return -0.08 + RAMP_HEIGHT * u * (0.12 + 0.88 * u);
}

export function rampSlope(u: number) {
  return RAMP_HEIGHT / RAMP_LENGTH * (0.12 + 1.76 * u);
}

export function crossesRampLip(x: number, z: number, nextX: number, nextZ: number, center: number) {
  const lip = rampLip(center);
  if (nextZ >= z || z <= lip || nextZ > lip) return false;
  const xAtLip = x + (nextX - x) * (lip - z) / (nextZ - z);
  return Math.abs(xAtLip) <= RAMP_HALF_WIDTH - 0.22;
}

export function rampTakeoffSpeed(forwardSpeed: number) {
  return Math.min(6.2, Math.max(0, forwardSpeed) * rampSlope(1));
}

/** The road mesh and the Rapier collider consume the same indexed surface. */
export function rampMeshData() {
  const vertices: number[] = [];
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);
  const w = RAMP_HALF_WIDTH;
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const z = (0.5 - u) * RAMP_LENGTH;
    const y = rampHeight(u);
    // Each slice contains top-left, top-right, bottom-left and bottom-right.
    vertices.push(-w, y, z, w, y, z, -w, -0.14, z, w, -0.14, z);
    if (i === SEGMENTS) break;
    const here = i * 4, next = here + 4;
    quad(here, here + 1, next + 1, next);
    quad(here, next, next + 2, here + 2);
    quad(here + 1, here + 3, next + 3, next + 1);
    quad(here + 2, next + 2, next + 3, here + 3);
  }
  const last = SEGMENTS * 4;
  quad(0, 2, 3, 1);
  quad(last, last + 1, last + 3, last + 2);
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
