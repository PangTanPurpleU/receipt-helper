import test from "node:test";
import assert from "node:assert/strict";
import { introFrame } from "../src/page-motion.js";
test("intro contracts monotonically with upward scrolling and restores on reversal", () => {
  const positions = [0, 30, 70, 140],
    frames = positions.map(introFrame);
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].scale < frames[i - 1].scale);
    assert.ok(frames[i].opacity < frames[i - 1].opacity);
  }
  for (const y of positions.toReversed())
    assert.deepEqual(introFrame(y), frames[positions.indexOf(y)]);
  assert.deepEqual(introFrame(0), { scale: 1, opacity: 1, y: 0 });
});
test("rubber-band overscroll cannot enlarge the intro or shrink it beyond its readable bound", () => {
  assert.deepEqual(introFrame(-80), introFrame(0));
  assert.deepEqual(introFrame(800), introFrame(140));
  assert.ok(introFrame(140).scale >= 0.85);
  assert.ok(introFrame(140).opacity > 0);
});
