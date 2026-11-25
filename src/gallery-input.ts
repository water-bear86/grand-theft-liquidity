/** Map a pointer/touch client coordinate to a canvas-local pixel and NDC pair. */
export function pointerFromClient(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
): { localX: number; localY: number; ndcX: number; ndcY: number } {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  return {
    localX,
    localY,
    ndcX: (localX / width) * 2 - 1,
    ndcY: -((localY / height) * 2 - 1),
  };
}

export function isGalleryControl(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined") return false;
  return target instanceof Element && !!target.closest("button, a, input, textarea, select, label");
}

export function preventGesture(event: Event) {
  if (event.cancelable) event.preventDefault();
}

export function phantomBrowseLink(pageUrl: string, ref = "https://grandtheftliquidity.fun"): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(ref)}`;
}

export function isLikelyMobile(input?: {
  userAgent?: string;
  coarsePointer?: boolean;
  maxTouchPoints?: number;
}): boolean {
  const ua = input?.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const coarse =
    input?.coarsePointer ??
    (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const touches =
    input?.maxTouchPoints ?? (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints);
  return coarse || touches > 0 || /Android|iPhone|iPad|iPod|Mobile|IEMobile/i.test(ua);
}

export const RECOIL_RECOVER_MS = 360;

export type Point = { x: number; y: number };

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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function applyRelativeDrag(
  base: { localX: number; localY: number },
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
): { localX: number; localY: number } {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  return {
    localX: clamp(base.localX + dx, 0, width),
    localY: clamp(base.localY + dy, 0, height),
  };
}

export function recoilKick(seed: string, shotIndex: number): Point {
  const up = 22 + unit(seed, `recoil:up:${shotIndex}`) * 16;
  const x = (unit(seed, `recoil:x:${shotIndex}`) - 0.5) * 28;
  const yJitter = unit(seed, `recoil:y:${shotIndex}`) * 8;
  return { x, y: -(up + yJitter) };
}

export function recoilRemaining(elapsedMs: number, recoverMs = RECOIL_RECOVER_MS): number {
  if (elapsedMs <= 0) return 1;
  if (elapsedMs >= recoverMs) return 0;
  const t = elapsedMs / recoverMs;
  return (1 - t) * (1 - t);
}

export type RecoilImpulse = { kick: Point; at: number };

export function recoilOffset(
  impulses: readonly RecoilImpulse[],
  now: number,
  recoverMs = RECOIL_RECOVER_MS,
): Point {
  let x = 0;
  let y = 0;
  for (const impulse of impulses) {
    const remaining = recoilRemaining(now - impulse.at, recoverMs);
    if (remaining <= 0) continue;
    x += impulse.kick.x * remaining;
    y += impulse.kick.y * remaining;
  }
  return { x, y };
}

export function aimWithRecoil(
  base: { localX: number; localY: number },
  offset: Point,
  bounds: { width: number; height: number },
): { localX: number; localY: number; ndcX: number; ndcY: number } {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const localX = clamp(base.localX + offset.x, 0, width);
  const localY = clamp(base.localY + offset.y, 0, height);
  return {
    localX,
    localY,
    ndcX: (localX / width) * 2 - 1,
    ndcY: -((localY / height) * 2 - 1),
  };
}

export function isFireControl(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined") return false;
  return target instanceof Element && !!target.closest("#gallery-fire, .gallery-fire");
}
