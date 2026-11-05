# Aeacus CLI

`aeacus` reads a text file or standard input, scores it with the published Aeacus model, and prints a verdict. The first run downloads the model, tokenizer, and calibration settings (about 82 MB) from Hugging Face and caches them under `~/.cache/aeacus/`.

```sh
cat draft.txt | aeacus
aeacus draft.txt
aeacus draft.txt --json
```

Default output is a short summary with excerpts of likely AI regions. Regions combine adjacent tokens with the same classification. `--json` emits one JSON object, including grouped regions with character offsets, scores, and excerpts. `--porcelain` emits stable tab-separated summary fields.

The document `ai_score` is the mean calibrated score across tokens. It is an AI-likeness heuristic, not a probability of authorship. A score at or above 0.5 is `ai_leaning`; below 0.5 is `human_leaning`. Text under 30 words is `insufficient_text`, since the model was trained on longer passages. Per-token regions use the model's calibrated thresholds and may be `likely_ai`, `likely_human`, or `uncertain`.

The CLI runs on CPU. Use `--model-dir` to point to a local model directory containing `tokenizer.json`, `thresholds.json`, and `onnx/model_q4f16.onnx`. `AEACUS_CACHE_DIR` overrides the default model cache location.

This package will be published to npm as `aeacus-cli`, exposing the command `aeacus`. The CLI package has no license declaration. Publish its first version once from an npm-authenticated environment, then configure npm Trusted Publishing for this repository and `.github/workflows/publish-cli.yml`. Later releases build a package archive and publish when a matching `cli-v<version>` tag is pushed.
