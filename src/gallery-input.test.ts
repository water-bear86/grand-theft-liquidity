import test from "node:test";
import assert from "node:assert/strict";
import {
  isGalleryControl,
  isLikelyMobile,
  phantomBrowseLink,
  pointerFromClient,
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
