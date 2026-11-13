// Turning raw token scores into what a person reads: a calibrated AI rate, a band, and how sure the
// label is within that band. The website does the same thing in app.js.

import { MIN_WORDS, STRIDE, WINDOW } from "./config.js";

// Below `low` a token counts as likely human, above `high` as likely AI, in between as unsure.
/**
 * @param {number} p
 * @param {Bands} thresholds
 * @returns {[Band, number]}
 */
export function verdict(p, thresholds) {
  if (p >= thresholds.high) return ["ai", (p - thresholds.high) / (1 - thresholds.high)];
  if (p <= thresholds.low) return ["human", (thresholds.low - p) / thresholds.low];
  return ["unsure", 0];
}

// The model's raw scores are not probabilities; the calibration maps one to how often tokens scoring
// like that really are AI.
/**
 * @param {number} p
 * @param {Calibration} knots
 * @returns {number}
 */
export function calibrate(p, knots) {
  const { x, y } = knots;
  if (p <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (p <= x[i]) {
      const t = x[i] === x[i - 1] ? 0 : (p - x[i - 1]) / (x[i] - x[i - 1]);
      return y[i - 1] + t * (y[i] - y[i - 1]);
    }
  }
  return y[y.length - 1];
}

// Where each window of a token sequence starts, as the website's worker walks them.
/**
 * @param {number} tokens
 * @returns {number[]}
 */
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
/**
 * @param {number[]} probabilities
 * @param {number} words
 * @param {Thresholds} thresholds
 * @returns {ModelVerdict}
 */
export function summary(probabilities, words, thresholds) {
  const aiScore = probabilities.length
    ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length
    : null;
  const leaning = aiScore !== null && aiScore >= 0.5 ? "ai_leaning" : "human_leaning";
  const verdict = words < MIN_WORDS ? "insufficient_text" : leaning;
  return { verdict, ai_score: aiScore === null ? null : Number(aiScore.toFixed(4)) };
}
