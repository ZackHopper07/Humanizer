# Detector eval

```bash
npm run eval                                   # score all samples, pass/fail table
npm run eval -- eval/samples/ai/<file>.txt     # per-sentence report for one file
node eval/baseline.js local                     # legacy post-processing vs new cleanup (no API)
node eval/baseline.js full                      # legacy vs new pipeline via Claude (needs .env key)
npm run eval -- --json                         # machine-readable output
```

The samples are **not in git** (`eval/samples/` is ignored) because they include third-party essays. Create the folders locally and add `.txt` files:

- `samples/human/` — verified human writing. Must score **under 20%** (Turnitin's highlight threshold). A failure here is a detector bug, and the run exits non-zero.
- `samples/ai/` — AI-written text. Should score **60% or more**. Files named `placeholder-*` were written to imitate typical AI styles. Replace or extend them with real chatbot output.

The detector (`lib/detector.js`) is rules-only: rhythm/burstiness plus style tells from Wikipedia:Signs_of_AI_writing, scored per 100 words. It approximates the signals Turnitin is described as using. It does not reproduce Turnitin's trained classifier, so treat its scores as a guide, not a prediction of Turnitin's number.
