// What a raw token score turns into: a band, a calibrated rate, and the page-level numbers.

import assert from "node:assert/strict";
import test from "node:test";

import { STRIDE, WINDOW } from "../src/config.js";
import { calibrate, summary, verdict, windowsFor } from "../src/scoring.js";

const thresholds = { low: 0.05, high: 0.95, calibration: { x: [0, 0.5, 1], y: [0.02, 0.4, 0.98] } };

test("verdict puts a score in the band the thresholds cut", () => {
  assert.deepEqual(verdict(0.99, thresholds), ["ai", 0.8]);
  assert.deepEqual(verdict(0.5, thresholds), ["unsure", 0]);
  assert.ok(Math.abs(verdict(0.01, thresholds)[1] - 0.8) < 1e-12);
  assert.deepEqual(verdict(0.95, thresholds), ["ai", 0]);
  assert.deepEqual(verdict(0.05, thresholds), ["human", 0]);
});

test("calibrate maps a score through the knots and holds the ends", () => {
  assert.equal(calibrate(-1, thresholds.calibration), 0.02);
  assert.equal(calibrate(0, thresholds.calibration), 0.02);
  assert.equal(calibrate(1, thresholds.calibration), 0.98);
  assert.equal(calibrate(2, thresholds.calibration), 0.98);
  assert.ok(Math.abs(calibrate(0.25, thresholds.calibration) - 0.21) < 1e-9);
});

test("windowsFor covers a token sequence with the training stride", () => {
  assert.deepEqual(windowsFor(10), [0]);
  assert.deepEqual(windowsFor(WINDOW), [0]);
  assert.deepEqual(windowsFor(WINDOW + 1), [0, WINDOW - STRIDE]);
  const starts = windowsFor(2000);
  assert.equal(starts.at(-1) + WINDOW >= 2000, true);
  assert.equal(starts.at(-2) + WINDOW < 2000, true);
  for (let i = 1; i < starts.length; i++) assert.equal(starts[i] - starts[i - 1], WINDOW - STRIDE);
});

test("summary leans the way the mean of the block's tokens leans", () => {
  assert.deepEqual(summary([0.9, 0.9]), { verdict: "ai_leaning", ai_score: 0.9 });
  assert.equal(summary([0.7, 0.6, 0.5]).verdict, "ai_leaning");
  assert.equal(summary([0.1, 0.1]).verdict, "human_leaning");
  assert.deepEqual(summary([]), { verdict: "human_leaning", ai_score: null });
});
