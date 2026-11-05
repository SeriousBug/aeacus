#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import ort from "onnxruntime-node";
import { Tokenizer } from "./tokenizer.js";

const REVISION = "57d4ce806931beff3d0150f74f330b831a9efb80";
const MODEL_FILES = ["tokenizer.json", "thresholds.json", "onnx/model_q4f16.onnx"];
const WINDOW = 510;
const STRIDE = 128;

function usage() {
  return `Usage: aeacus [file] [--json|--porcelain] [--model-dir directory]

Read text from a file or stdin and estimate how AI-like its writing is.

Options:
  --json             Output a JSON object for agents and scripts
  --porcelain        Output stable tab-separated summary fields
  --model-dir PATH   Use a local folder with tokenizer.json, thresholds.json,
                     and onnx/model_q4f16.onnx
  -h, --help         Show this help

Examples:
  cat draft.txt | aeacus
  aeacus draft.txt --json
  cat draft.txt | aeacus --porcelain`;
}

function parseArgs(args) {
  const opts = { format: "text", modelDir: null, input: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") opts.format = "json";
    else if (arg === "--porcelain") opts.format = "porcelain";
    else if (arg === "--model-dir") {
      if (!args[i + 1]) throw new Error("--model-dir requires a path");
      opts.modelDir = path.resolve(args[++i]);
    } else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (opts.input) throw new Error("Provide one input file, or pipe text through stdin");
    else opts.input = arg;
  }
  return opts;
}

function cacheDir() {
  return process.env.AEACUS_CACHE_DIR
    ? path.resolve(process.env.AEACUS_CACHE_DIR)
    : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "aeacus", REVISION);
}

async function ensureFile(root, relative) {
  const file = path.join(root, relative);
  try {
    await fs.access(file);
    return file;
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const url = `https://huggingface.co/level20tauren/aeacus-s-1/resolve/${REVISION}/${relative}`;
    process.stderr.write(`Downloading ${relative} from the Aeacus model repository…\n`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Model download failed (${response.status}): ${relative}`);
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, Buffer.from(await response.arrayBuffer()));
    await fs.rename(temp, file);
    return file;
  }
}

async function loadModel(modelDir) {
  const root = modelDir ?? cacheDir();
  const files = await Promise.all(MODEL_FILES.map((file) => ensureFile(root, file)));
  const [tokenizerJson, thresholds] = await Promise.all([
    fs.readFile(files[0], "utf8").then(JSON.parse),
    fs.readFile(files[1], "utf8").then(JSON.parse),
  ]);
  const session = await ort.InferenceSession.create(files[2], { executionProviders: ["cpu"] });
  return { tokenizer: new Tokenizer(tokenizerJson), thresholds, session };
}

async function readInput(file) {
  if (file) return fs.readFile(file, "utf8");
  if (process.stdin.isTTY) throw new Error("Provide a file or pipe text to aeacus on stdin");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function calibrate(value, knots) {
  const { x, y } = knots;
  if (value <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (value <= x[i]) {
      const t = (value - x[i - 1]) / (x[i] - x[i - 1] || 1);
      return y[i - 1] + t * (y[i] - y[i - 1]);
    }
  }
  return y.at(-1);
}

function classification(score, thresholds) {
  if (score >= thresholds.high) return "likely_ai";
  if (score <= thresholds.low) return "likely_human";
  return "uncertain";
}

function regions(text, encoded, probabilities, thresholds) {
  const result = [];
  for (let i = 0; i < probabilities.length; i++) {
    const verdict = classification(probabilities[i], thresholds);
    const previous = result.at(-1);
    if (previous && previous.verdict === verdict) {
      previous.end = encoded.ends[i];
      previous.ai_score = (previous.ai_score * previous.tokens + probabilities[i]) / (previous.tokens + 1);
      previous.tokens++;
    } else {
      result.push({ start: encoded.starts[i], end: encoded.ends[i], verdict,
        ai_score: probabilities[i], tokens: 1 });
    }
  }
  return result.map((region) => ({
    ...region,
    ai_score: Number(region.ai_score.toFixed(4)),
    text: text.slice(region.start, region.end),
  }));
}

async function score(text, model) {
  const encoded = model.tokenizer.encode(text);
  const sums = new Float64Array(encoded.ids.length);
  const counts = new Uint16Array(encoded.ids.length);
  const windowCount = Math.max(1, Math.ceil(Math.max(0, encoded.ids.length - WINDOW) / (WINDOW - STRIDE)) + 1);
  for (let w = 0; w < windowCount; w++) {
    const from = w * (WINDOW - STRIDE);
    const to = Math.min(from + WINDOW, encoded.ids.length);
    const input = BigInt64Array.from([model.tokenizer.clsId, ...encoded.ids.slice(from, to), model.tokenizer.sepId], BigInt);
    const mask = new BigInt64Array(input.length).fill(1n);
    const out = await model.session.run({
      input_ids: new ort.Tensor("int64", input, [1, input.length]),
      attention_mask: new ort.Tensor("int64", mask, [1, input.length]),
    });
    const logits = out.logits.data;
    for (let i = from; i < to; i++) {
      const k = (i - from + 1) * 2;
      const raw = 1 / (1 + Math.exp(logits[k] - logits[k + 1]));
      sums[i] += raw;
      counts[i]++;
    }
    out.logits.dispose?.();
  }
  const probabilities = Array.from(sums, (sum, i) => calibrate(sum / counts[i], model.thresholds.calibration));
  const aiScore = probabilities.length
    ? probabilities.reduce((sum, probability) => sum + probability, 0) / probabilities.length
    : null;
  const wordCount = (text.match(/\S+/g) ?? []).length;
  const verdict = wordCount < 30 ? "insufficient_text"
    : aiScore >= 0.5 ? "ai_leaning" : "human_leaning";
  return {
    verdict,
    ai_score: aiScore === null ? null : Number(aiScore.toFixed(4)),
    words: wordCount,
    tokens: probabilities.length,
    regions: regions(text, encoded, probabilities, model.thresholds),
    thresholds: { likely_human: model.thresholds.low, likely_ai: model.thresholds.high },
    note: "ai_score is the mean calibrated token score, not a probability of authorship. The verdict is a heuristic; short texts are marked insufficient.",
  };
}

function printResult(result, format) {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (format === "porcelain") {
    process.stdout.write(`verdict\t${result.verdict}\nai_score\t${result.ai_score ?? "null"}\nwords\t${result.words}\ntokens\t${result.tokens}\n`);
  } else {
    const score = result.ai_score === null ? "unavailable" : `${Math.round(result.ai_score * 100)}%`;
    process.stdout.write(`Aeacus: ${result.verdict.replaceAll("_", " ")} (AI-like score ${score}; ${result.words} words)\n`);
    const likelyAi = result.regions.filter((r) => r.verdict === "likely_ai");
    if (likelyAi.length) {
      process.stdout.write("Likely AI regions:\n");
      for (const region of likelyAi) {
        const excerpt = region.text.replace(/\s+/g, " ").trim();
        process.stdout.write(`  ${Math.round(region.ai_score * 100)}%  ${excerpt}\n`);
      }
    }
    if (result.verdict === "insufficient_text") process.stdout.write("The model was trained on passages of at least 30 words.\n");
  }
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const text = (await readInput(opts.input)).normalize("NFC");
    const model = await loadModel(opts.modelDir);
    printResult(await score(text, model), opts.format);
  }
} catch (error) {
  process.stderr.write(`aeacus: ${error.message}\n`);
  process.exitCode = 2;
}
