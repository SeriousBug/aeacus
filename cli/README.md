# Aeacus CLI

You can also run Aeacus in your terminal.
[aeacus-cli](https://www.npmjs.com/package/aeacus-cli) is published on npm.

The CLI will automatically download and cache the
[Aeacus S 1](https://huggingface.co/level20tauren/aeacus-s-1) from huggingface. Here are some
example uses:

```sh
cat draft.txt | npx aeacus-cli             # or npx aeacus-cli draft.txt
cat draft.txt | npx aeacus-cli --json      # for feeding into other programs, prints per-region verdicts
cat draft.txt | npx aeacus-cli --porcelain # short, stable plain text output for scripts
```

Default output is a short summary with excerpts of likely AI regions. Regions combine adjacent tokens with the same classification. `--json` emits one JSON object, including grouped regions with character offsets, scores, and excerpts. `--porcelain` emits stable tab-separated summary fields.

The document `ai_score` is the mean calibrated score across tokens. It is an AI-likeness heuristic, not a probability of authorship. A score at or above 0.5 is `ai_leaning`; below 0.5 is `human_leaning`. Text under 30 words is `insufficient_text`, since the model was trained on longer passages. Per-token regions use the model's calibrated thresholds and may be `likely_ai`, `likely_human`, or `uncertain`.

The CLI runs on CPU. Use `--model-dir` to point to a local model directory containing `tokenizer.json`, `thresholds.json`, and `onnx/model_q4f16.onnx`. `AEACUS_CACHE_DIR` overrides the default model cache location.

The CLI package has no license declaration.
