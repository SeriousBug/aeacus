// Turning raw token scores into what a person reads: a calibrated AI rate, a band, and how sure the
// label is within that band. The website does the same thing in app.js.

import { STRIDE, WINDOW } from "./config.js";

// Below `low` a token counts as likely human, above `high` as likely AI, in between as unsure.
export function verdict(p, thresholds) {
  if (p >= thresholds.high) return ["ai", (p - thresholds.high) / (1 - thresholds.high)];
  if (p <= thresholds.low) return ["human", (thresholds.low - p) / thresholds.low];
  return ["unsure", 0];
}

// The model's raw scores are not probabilities; the calibration maps one to how often tokens scoring
// like that really are AI.
export function calibrate(p, knots) {
  const { x, y } = knots;
  if (p <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (p <= x[i]) {
      const t = x[i] === x[i - 1] ? 0 : (p - x[i - 1]) / (x[i] - x[i - 1]);
      return y[i - 1] + t * (y[i] - y[i - 1]);
    }
  }
  return y.at(-1);
}

// Where each window of a token sequence starts, as the website's worker walks them.
export function windowsFor(tokens) {
  const starts = [];
  for (let s = 0; ; s += WINDOW - STRIDE) {
    starts.push(s);
    if (s + WINDOW >= tokens) break;
  }
  return starts;
}

// The page-level numbers the CLI reports: a mean calibrated score over the block's tokens, and a
// verdict that refuses to lean either way on text the model was not trained for.
export function summary(probabilities, words, thresholds) {
  const aiScore = probabilities.length
    ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length
    : null;
  const verdict = words < 30 ? "insufficient_text"
    : aiScore >= 0.5 ? "ai_leaning" : "human_leaning";
  return { verdict, ai_score: aiScore === null ? null : Number(aiScore.toFixed(4)) };
}
