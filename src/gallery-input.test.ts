import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOIL_RECOVER_MS,
  aimWithRecoil,
  applyRelativeDrag,
  isFireControl,
  isGalleryControl,
  isLikelyMobile,
  phantomBrowseLink,
  pointerFromClient,
  recoilKick,
  recoilOffset,
  recoilRemaining,
} from "./gallery-input.ts";

test("pointer mapping uses the canvas box and device-independent NDC", () => {
  const mapped = pointerFromClient(150, 80, { left: 100, top: 50, width: 200, height: 100 });
  assert.equal(mapped.localX, 50);
  assert.equal(mapped.localY, 30);
  assert.equal(mapped.ndcX, -0.5);
  assert.equal(mapped.ndcY, 0.4);
  const corner = pointerFromClient(300, 150, { left: 100, top: 50, width: 200, height: 100 });
  assert.equal(corner.ndcX, 1);
  assert.equal(corner.ndcY, -1);
  const empty = pointerFromClient(10, 10, { left: 0, top: 0, width: 0, height: 0 });
  assert.ok(Number.isFinite(empty.ndcX) && Number.isFinite(empty.ndcY));
});

test("Phantom browse deep links encode the current page", () => {
  const link = phantomBrowseLink("https://grandtheftliquidity.fun/");
  assert.equal(
    link,
    "https://phantom.app/ul/browse/https%3A%2F%2Fgrandtheftliquidity.fun%2F?ref=https%3A%2F%2Fgrandtheftliquidity.fun",
  );
  assert.equal(isLikelyMobile({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", coarsePointer: false, maxTouchPoints: 5 }), true);
  assert.equal(isLikelyMobile({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", coarsePointer: false, maxTouchPoints: 0 }), false);
});

test("gallery controls are ignored so the forfeit button still works", () => {
  assert.equal(isGalleryControl(null), false);
});

test("relative drag moves the sight without snapping to the finger", () => {
  const next = applyRelativeDrag({ localX: 100, localY: 80 }, 40, -15, { width: 200, height: 120 });
  assert.equal(next.localX, 140);
  assert.equal(next.localY, 65);
  const clamped = applyRelativeDrag({ localX: 190, localY: 10 }, 40, -20, { width: 200, height: 120 });
  assert.equal(clamped.localX, 200);
  assert.equal(clamped.localY, 0);
});

test("recoil is deterministic, kicks up, stacks, and recovers", () => {
  const seed = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(recoilKick(seed, 0), recoilKick(seed, 0));
  assert.notDeepEqual(recoilKick(seed, 0), recoilKick(seed, 1));
  const first = recoilKick(seed, 0);
  assert.ok(first.y < -20, "kick should jump the sight up");
  assert.equal(recoilRemaining(0), 1);
  assert.equal(recoilRemaining(RECOIL_RECOVER_MS), 0);
  assert.ok(recoilRemaining(RECOIL_RECOVER_MS / 2) > 0.2);
  assert.ok(recoilRemaining(RECOIL_RECOVER_MS / 2) < 0.8);
  const at = 1_000;
  const one = recoilOffset([{ kick: first, at }], at);
  assert.equal(one.x, first.x);
  assert.equal(one.y, first.y);
  const recovered = recoilOffset([{ kick: first, at }], at + RECOIL_RECOVER_MS);
  assert.equal(recovered.x, 0);
  assert.equal(recovered.y, 0);
  const mid = recoilOffset([{ kick: first, at }], at + 120);
  assert.ok(mid.y < 0 && mid.y > first.y);
  const stacked = recoilOffset(
    [
      { kick: first, at },
      { kick: recoilKick(seed, 1), at: at + 80 },
    ],
    at + 80,
  );
  assert.ok(Math.abs(stacked.y) > Math.abs(mid.y));
});

test("the shot aim is the displayed crosshair, including leftover recoil", () => {
  const base = { localX: 100, localY: 80 };
  const displayed = aimWithRecoil(base, { x: 12, y: -30 }, { width: 200, height: 100 });
  assert.equal(displayed.localX, 112);
  assert.equal(displayed.localY, 50);
  assert.equal(displayed.ndcX, (112 / 200) * 2 - 1);
  assert.equal(displayed.ndcY, -((50 / 100) * 2 - 1));
  assert.equal(isFireControl(null), false);
});
