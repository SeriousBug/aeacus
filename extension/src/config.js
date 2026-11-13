// The model files, named the way the website and the CLI name them, from the same pinned revision
// the CLI downloads. A build can point it elsewhere, which the tests do.
export const MODEL_REPO = "level20tauren/aeacus-s-1";
export const MODEL_REVISION = "57d4ce806931beff3d0150f74f330b831a9efb80";

export const MODEL_BASE = (typeof AEACUS_MODEL_BASE === "string" ? AEACUS_MODEL_BASE : "")
  || `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/`;
export const MODEL_FILE = "onnx/model_q4f16.onnx";

// Same windowing as training: 512 tokens including [CLS] and [SEP], overlapping by 128.
export const WINDOW = 510;
export const STRIDE = 128;

// A page can hold more text than anyone wants to wait for. A window takes about a quarter of a
// second on a GPU and ten or more without one, so the budget follows the engine.
export const MAX_TOKENS = 24000;
export const MAX_TOKENS_WASM = 3000;

export const MAX_BLOCKS = 400;

// A page opened with `?aeacus-debug` says what was read and drawn to its own console, which is the
// only way to see the ranges a highlight is made of: they are not elements.
export const DEBUG = /[?&]aeacus-debug\b/.test(globalThis.location?.search ?? "");
