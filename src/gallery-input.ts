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
