// Below LOW a token counts as likely human, above HIGH as likely AI, in between as unsure.
// CALIBRATION maps the model's raw probability to how often tokens at that probability are AI.
// All three are set from the model's thresholds.json before any token is painted.
let LOW;
let HIGH;
let CALIBRATION;

const editor = document.getElementById("editor");
// The text in the placeholder, which an empty box checks instead of nothing.
const sample = editor.dataset.placeholder;

const status = document.getElementById("status");
const statusLabel = document.getElementById("status-label");
const bar = document.getElementById("bar");
const checkButton = document.getElementById("check");
const clearButton = document.getElementById("clear");
const statsToggle = document.getElementById("stats-toggle");
const stats = document.getElementById("stats");
const statsList = document.getElementById("stats-list");
const thresholdsList = document.getElementById("thresholds-list");
const calibrationList = document.getElementById("calibration-list");
const hint = document.getElementById("hint");
const tip = document.getElementById("tip");
// The download size the page states is written in by vite.config.js at build time, and the
// worker's download progress corrects it if the served model differs.
const modelSize = document.getElementById("model-size");

const worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });

let runId = 0;
let checking = false;
let hasResults = false;
let model = { state: "loading", loaded: 0, total: 0 };
let probs = new Float32Array(0);
let tokenSpans = [];

worker.onmessage = ({ data }) => {
  switch (data.type) {
    case "download":
      model = { state: "loading", loaded: data.loaded, total: data.total };
      if (data.total) modelSize.textContent = megabytes(data.total);
      break;
    case "starting":
      model = { state: "starting" };
      break;
    case "ready":
      model = { state: "ready" };
      LOW = data.low;
      HIGH = data.high;
      CALIBRATION = data.calibration;
      showCalibration(data.target);
      showChecks(data.checks);
      break;
    case "tokens":
      if (data.id === runId) {
        renderTokens(data.starts, data.ends);
        hasResults = true;
        updateActions();
      }
      break;
    case "progress":
      if (data.id === runId) applyProgress(data);
      break;
    case "stats":
      if (data.id === runId) showStats(data);
      break;
    case "error":
      if (data.id === undefined) {
        model = { state: "error", message: data.message };
        if (checking) {
          checking = false;
          updateActions();
          showModelStatus();
        }
      } else if (data.id === runId) {
        checking = false;
        updateActions();
        showStatus(`Something went wrong: ${data.message}`, null, true);
      }
      break;
  }
  if (checking && data.type !== "progress" && data.type !== "tokens") showModelStatus();
};

function megabytes(bytes) {
  return `${Math.round(bytes / 1e6)} MB`;
}

// The sure share is the share of calls the calibration allows to be wrong, taken off 100: with the
// model's 5% target, a labeled token is right about 95% of the time.
function showCalibration(target) {
  if (!(target > 0 && target <= 0.5)) return;
  for (const el of document.querySelectorAll("[data-sure]")) {
    el.textContent = Math.round((1 - target) * 100);
  }
  for (const el of document.querySelectorAll("[data-one-in]")) {
    el.textContent = Math.round(1 / target);
  }
}

// How well the model does on each check set, as the share of the tokens it named that it named
// right, so the page's own claims follow thresholds.json rather than a number written by hand.
function showChecks(checks) {
  for (const el of document.querySelectorAll("[data-check]")) {
    const share = checks?.[el.dataset.check];
    if (share > 0) el.textContent = share.toFixed(1);
  }
}

// Touch screens get a read-only field once a check starts, since tapping is how the text is read
// there and an editable field would only put a keyboard over the results. Hover screens keep
// editing, and an edit starts over.
const touchScreen = matchMedia("(hover: none) and (pointer: coarse)");
touchScreen.addEventListener("change", updateActions);

function updateActions() {
  const readonly = touchScreen.matches && (checking || hasResults);
  editor.contentEditable = readonly ? "false" : "plaintext-only";
  editor.setAttribute("aria-readonly", String(readonly));
  checkButton.hidden = readonly;
  clearButton.hidden = !readonly;
  checkButton.disabled = checking || !(editor.textContent.trim() || sample);
  fitSample();
}

function showModelStatus() {
  if (model.state === "loading") {
    showStatus(model.total
      ? `Downloading Aeacus (${Math.round(model.loaded / 1e6)} of ${Math.round(model.total / 1e6)} MB). This only happens once.`
      : "Loading Aeacus…",
    model.total ? model.loaded / model.total : null);
  } else if (model.state === "starting") {
    showStatus("Starting Aeacus…", null);
  } else if (model.state === "ready") {
    showStatus("Checking text…", 0);
  } else if (model.state === "error") {
    showStatus(`Aeacus couldn't load: ${model.message}. Reload the page to try again.`, null, true);
  }
}

function showStatus(label, fraction, error = false) {
  status.hidden = false;
  status.classList.toggle("error", error);
  statusLabel.textContent = label;
  bar.classList.toggle("indeterminate", fraction === null && !error);
  bar.style.setProperty("--fraction", fraction ?? 0);
  if (fraction === null) bar.removeAttribute("aria-valuenow");
  else bar.setAttribute("aria-valuenow", Math.round(fraction * 100));
}

function check() {
  // An empty box checks the sample the placeholder shows, so the field fills with it first and the
  // text is then read back out like any other.
  if (!editor.textContent.trim() && sample) editor.textContent = sample;
  const text = editor.innerText.normalize("NFC");
  if (!text.trim()) return;
  runId++;
  checking = true;
  hasResults = false;
  editor.textContent = text;
  statsToggle.hidden = true;
  stats.hidden = true;
  statsToggle.setAttribute("aria-expanded", "false");
  hint.hidden = true;
  hideTip();
  updateActions();
  showModelStatus();
  worker.postMessage({ type: "run", id: runId, text });
}

// Drops whatever the last run left behind, including the run itself if it is still going.
function resetRun() {
  probs = new Float32Array(0);
  tokenSpans = [];
  hasResults = false;
  if (checking) {
    runId++;
    worker.postMessage({ type: "cancel", id: runId });
  }
  checking = false;
  status.hidden = true;
  statsToggle.hidden = true;
  stats.hidden = true;
  statsToggle.setAttribute("aria-expanded", "false");
  hint.hidden = true;
  hideTip();
}

function resetAfterEdit() {
  for (const span of editor.querySelectorAll(".tok")) {
    span.removeAttribute("class");
    span.removeAttribute("style");
  }
  resetRun();
  updateActions();
}

function clearText() {
  editor.replaceChildren();
  resetRun();
  updateActions();
  editor.focus({ preventScroll: true });
}

function showStats(data) {
  const seconds = data.inferenceMs / 1000;
  const rows = [
    ["Compute device", data.provider === "webgpu" ? "GPU (WebGPU)" : `CPU (WebAssembly${data.threads ? `, ${data.threads} threads configured` : ""})`],
    ["Model", `Aeacus 1 (${data.quantization})`],
    ["Input tokens", data.tokens.toLocaleString()],
    ["Windows", `${data.windows} × up to 512 tokens (including special tokens)`],
    ["Inference time", `${data.inferenceMs.toFixed(1)} ms`],
    ["Average throughput", `${seconds > 0 ? (data.tokens / seconds).toFixed(1) : "—"} tok/s`],
  ];
  statsList.replaceChildren(...statElements(rows));
  calibrationList.replaceChildren(...statElements(
    MAPPING_AT.map((p) => [`Raw ${p.toFixed(2)}`, formatPercent(calibrate(p))])));
  thresholdsList.replaceChildren(...statElements([
    ["Likely human", `≤ ${formatPercent(data.low)} (raw ≤ ${rawFor(data.low).toFixed(3)})`],
    ["Likely AI", `≥ ${formatPercent(data.high)} (raw ≥ ${rawFor(data.high).toFixed(3)})`],
  ]));
  statsToggle.hidden = false;
}

// Fixed raw scores rather than a sample of the curve's knots: the knots bunch up at both ends, so
// an even sample of them would show 0.001 three times and say nothing about the middle, where a
// raw score means something quite different from the rate it maps to.
const MAPPING_AT = [0.01, 0.1, 0.5, 0.9, 0.99];

// The inverse of calibrate(): the lowest raw score whose mapped rate is `rate`.
function rawFor(rate) {
  const { x, y } = CALIBRATION;
  for (let i = 1; i < x.length; i++) {
    if (y[i] >= rate) {
      const t = y[i] === y[i - 1] ? 0 : (rate - y[i - 1]) / (y[i] - y[i - 1]);
      return x[i - 1] + Math.min(1, Math.max(0, t)) * (x[i] - x[i - 1]);
    }
  }
  return 1;
}

function statElements(rows) {
  return rows.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    return [term, detail];
  });
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// Tokens can overlap (an emoji split across byte-level tokens), so a token that starts inside
// the previous one is shown as part of it.
function renderTokens(starts, ends) {
  const text = editor.textContent;
  const fragment = document.createDocumentFragment();
  probs = new Float32Array(starts.length).fill(NaN);
  tokenSpans = new Array(starts.length);
  let cursor = 0;
  let last = null;
  for (let i = 0; i < starts.length; i++) {
    const start = Math.max(starts[i], cursor);
    if (ends[i] <= start) {
      if (last) {
        last.tokens.push(i);
        tokenSpans[i] = last;
      }
      continue;
    }
    if (start > cursor) fragment.append(text.slice(cursor, start));
    const el = document.createElement("span");
    el.className = "tok";
    el.textContent = text.slice(start, ends[i]);
    last = { el, tokens: [i], p: null, raw: null };
    el.token = last;
    tokenSpans[i] = last;
    fragment.append(el);
    cursor = ends[i];
  }
  if (cursor < text.length) fragment.append(text.slice(cursor));
  editor.replaceChildren(fragment);
  showStatus("Checking text…", 0);
}

function applyProgress({ done, total, from, probs: windowProbs }) {
  probs.set(windowProbs, from);
  const touched = new Set();
  for (let i = from; i < from + windowProbs.length; i++) {
    if (tokenSpans[i]) touched.add(tokenSpans[i]);
  }
  for (const span of touched) paint(span);
  if (done < total) {
    showStatus(`Checking text… ${Math.round((done / total) * 100)}%`, done / total);
  } else {
    checking = false;
    status.hidden = true;
    hint.hidden = false;
    updateActions();
  }
}

function paint(span) {
  let sum = 0;
  let n = 0;
  for (const i of span.tokens) {
    if (!Number.isNaN(probs[i])) {
      sum += probs[i];
      n++;
    }
  }
  if (!n) return;
  const raw = sum / n;
  const p = calibrate(raw);
  span.raw = raw;
  span.p = p;
  const [kind, strength] = verdict(p);
  span.el.className = `tok ${kind}`;
  span.el.style.setProperty("--strength", strength.toFixed(3));
}

function calibrate(p) {
  if (!CALIBRATION) return p;
  const { x, y } = CALIBRATION;
  let i = 1;
  while (i < x.length - 1 && x[i] < p) i++;
  const t = x[i] === x[i - 1] ? 0 : (p - x[i - 1]) / (x[i] - x[i - 1]);
  return y[i - 1] + Math.min(1, Math.max(0, t)) * (y[i] - y[i - 1]);
}

function verdict(p) {
  if (p >= HIGH) return ["ai", (p - HIGH) / (1 - HIGH)];
  if (p <= LOW) return ["human", (LOW - p) / LOW];
  return ["unsure", 0];
}

// The tooltip says only which way the token leans and how far, and adds the raw score when the
// stats panel is open, since that is the number the calibration maps from.
function tipLabel(p, detailed) {
  const [side, share] = p >= 0.5 ? ["AI", p] : ["human", 1 - p];
  const percent = share * 100;
  // A token in the unsure band is called that and nothing else. The page only says "likely human"
  // or "likely AI" outside the band, so quoting its percentage would put back the certainty the
  // band exists to withhold. The number belongs to the stats panel, which is why hovering with it
  // open still reveals the estimate.
  if (p > LOW && p < HIGH) {
    return detailed ? `Unsure · ${Math.round(percent)}% ${side}` : "Unsure";
  }
  // Never 100%: a token the model is sure of can still be misjudged, so the top reads "99%+".
  return percent >= 99.5 ? `99%+ likely ${side}` : `${Math.round(percent)}% likely ${side}`;
}

function showTip(el, x, y) {
  const span = el.token;
  if (!span || span.p === null) return;
  // Four decimals, because three would print a raw 0.9996 as a flat "1.000", which is the one
  // thing the calibration exists to talk people out of.
  const detailed = !stats.hidden;
  const raw = detailed && span.raw !== null
    ? `<div class="tip-raw">raw score ${span.raw.toFixed(4)}</div>`
    : "";
  tip.innerHTML = `<div class="tip-prob">${tipLabel(span.p, detailed)}</div>${raw}`;
  setHovered(el);
  tip.hidden = false;
  // A token can wrap across lines; anchor to the line the pointer is on.
  const rects = [...el.getClientRects()];
  const rect = rects.find((r) => y >= r.top && y <= r.bottom) ?? rects[0];
  const margin = 8;
  const tipRect = tip.getBoundingClientRect();
  let left = Math.min(Math.max(margin, x - tipRect.width / 2), innerWidth - tipRect.width - margin);
  let top = rect.top - tipRect.height - margin;
  if (top < margin) top = rect.bottom + margin;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// The token the tooltip describes carries an outline, so the number is attached to a word rather
// than floating over the paragraph. Touch taps show tooltips too, and they get the same marker.
let hovered = null;

function setHovered(el) {
  if (hovered === el) return;
  hovered?.classList.remove("hovered");
  hovered = el;
  hovered?.classList.add("hovered");
}

function hideTip() {
  tip.hidden = true;
  setHovered(null);
}

editor.addEventListener("pointerover", (e) => {
  const el = e.target.closest(".tok");
  if (el) showTip(el, e.clientX, e.clientY);
});
// A touch lifts right after the tap, so touch tooltips stay until the next tap elsewhere.
editor.addEventListener("pointerout", (e) => {
  if (e.pointerType === "touch") return;
  if (!e.relatedTarget || !editor.contains(e.relatedTarget)) hideTip();
});
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && !e.target.closest?.(".tok")) hideTip();
});
addEventListener("scroll", hideTip, { passive: true });

// A hidden twin of the editor, filled with the sample: the sample is shown through a ::before,
// which no Range can read, so it is laid out in here instead, to find how tall the box has to be to
// show all of it at whatever width it has.
const probe = document.createElement("div");
probe.className = "editor probe";
probe.setAttribute("aria-hidden", "true");
editor.after(probe);

// Start check runs the sample, so the empty box is made tall enough to show the whole of it, and
// given back its own height as soon as the sample goes.
function fitSample() {
  const showing = !editor.firstChild && !editor.classList.contains("placeholder-hidden");
  if (!showing) {
    editor.style.height = "";
    return;
  }
  probe.textContent = sample;
  editor.style.height = `${Math.ceil(probe.getBoundingClientRect().height) + 2}px`;
}

// The sample would get in the way of typing, so it goes as soon as the field is entered, and comes
// back if the field is left empty, since that is when Start check would run it.
function hideSample() {
  editor.classList.add("placeholder-hidden");
  fitSample();
}

function showSample() {
  if (!editor.textContent.trim()) editor.classList.remove("placeholder-hidden");
  fitSample();
}

addEventListener("resize", fitSample);
// How the sample wraps, and so how tall the box has to be, follows the font it ends up in.
document.fonts?.ready.then(fitSample);

editor.addEventListener("pointerdown", hideSample);
editor.addEventListener("focus", hideSample);
editor.addEventListener("blur", showSample);
editor.addEventListener("input", resetAfterEdit);
statsToggle.addEventListener("click", () => {
  const expanded = statsToggle.getAttribute("aria-expanded") === "true";
  statsToggle.setAttribute("aria-expanded", String(!expanded));
  stats.hidden = expanded;
});
checkButton.addEventListener("click", check);
clearButton.addEventListener("click", clearText);

updateActions();
