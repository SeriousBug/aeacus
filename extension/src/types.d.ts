// What crosses the extension's boundaries, so a field name or a message shape is checked where it is
// written instead of where it is read. Ambient, because the sources are plain JavaScript.

// Set by the build from the environment, see build.mjs.
declare const AEACUS_MODEL_BASE: string | undefined;

type Provider = "webgpu" | "wasm";

type Band = "human" | "unsure" | "ai";

interface Calibration {
  x: number[];
  y: number[];
}

// Where the model leans one way or the other. The bands are all the page side needs; the
// calibration belongs to whoever turns raw scores into probabilities.
interface Bands {
  low: number;
  high: number;
}

interface Thresholds extends Bands {
  calibration: Calibration;
}

// A piece of a page: the text, and where each of its text nodes sits inside that text.
interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

// What one container on the page holds.
interface PageBlock {
  element: Element;
  text: string;
  nodes: TextNodeSpan[];
  words: number;
  linkShare: number;
}

// A container cut to the size of a window, with the text nodes counted from its own start.
interface Block extends PageBlock {
  base: number;
}

interface BlockTask {
  index: number;
  text: string;
  words?: number;
}

interface ModelState {
  state: "idle" | "downloading" | "starting" | "ready" | "error";
  loaded?: number;
  total?: number;
  cached?: boolean;
  provider?: Provider;
  threads?: number | null;
  low?: number;
  high?: number;
  calibration?: Calibration;
  message?: string;
}

interface ModelVerdict {
  verdict: "ai_leaning" | "human_leaning" | "insufficient_text";
  ai_score: number | null;
}

// What the page asks the model to do.
type ModelRequest =
  | { type: "check"; id: string; blocks: BlockTask[] }
  | { type: "cancel"; id: string }
  | { type: "state" }
  | { type: "warm" };

// What the model says back. Every score-carrying message names the check it belongs to.
type ModelReply =
  | ({ type: "model" } & ModelState)
  | { type: "total"; id: string; windows: number; tokens: number; blocks: number;
    low: number; high: number }
  | { type: "tokens"; id: string; block: number; starts: number[]; ends: number[] }
  | { type: "progress"; id: string; block: number; from: number; probs: number[];
    done: number; total: number }
  | ({ type: "block"; id: string; block: number; probs: number[]; words: number } & ModelVerdict)
  | { type: "done"; id: string; blocks: number; tokens: number; inferenceMs: number;
    provider: Provider; threads: number | null; skipped: number }
  | { type: "error"; id?: string; message: string };

interface PageSummary {
  blocks: number;
  words: number;
  aiBlocks: number;
  aiShare: number;
  humanShare: number;
  unsureShare: number;
  score: number;
  skipped?: number;
}

type Phase = "idle" | "checking" | "done" | "empty" | "error" | "unsupported" | "home";

// What the popup is told about the page it is looking at.
interface PageState {
  phase: Phase;
  message: string;
  progress: { done: number; total: number } | null;
  summary: PageSummary | null;
  model?: ModelState;
  provider?: Provider;
  threads?: number | null;
  milliseconds?: number;
  tokens?: number;
  skipped?: number;
}

// The model, as the extension context that holds it offers it to the relay in front of it.
interface Host {
  send(message: ModelRequest): void;
}

type Post = (message: ModelReply) => void;
