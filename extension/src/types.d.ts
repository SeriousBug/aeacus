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

// A piece of a page: the text, and where each of its text nodes sits inside that text. Nodes that
// something unread sits between, an image or a code block, carry different runs, so a highlight is
// drawn over one run at a time instead of covering what broke it.
interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
  run: number;
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

// What a site's rule names: the parts of the page that hold its writing, and what to drop inside
// them. A region can be a selector, or a function for a site whose markup is hashed or unlabelled.
interface SiteRule {
  host: RegExp;
  path?: RegExp;
  keep: (string | ((root: ParentNode) => Element[]))[];
  drop?: string[];
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
  verdict: "ai_leaning" | "human_leaning";
  ai_score: number | null;
}

// What the page asks the model to do. `gpu` is filled in by the background, which is where the
// setting is read, so neither the page nor the popup has to know about it.
type ModelRequest =
  | { type: "check"; id: string; blocks: BlockTask[]; gpu?: boolean }
  | { type: "cancel"; id: string }
  | { type: "state" }
  | { type: "warm"; gpu?: boolean };

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

interface Settings {
  gpu: boolean;
}
