# Agent harness evaluations

`cases.json` is the 92-case standalone-app contract. Run `yarn harness:validate --all` for the deterministic gate. Live routing uses a fresh read-only process per case:

```text
yarn harness:validate --runner codex --all
yarn harness:validate --runner claude --case OMH-009
```

Writable evaluation is intentionally opt-in and only accepts the fixed 16 cases in `release-matrix.json`. The target must be a disposable standalone scaffold containing `.ai/harness/DISPOSABLE`:

```text
yarn harness:validate --runner codex --case OMH-009 --writable-root /absolute/disposable/app --acknowledge-writes
```

The evaluator rejects writes outside each case's `allowedWrites`. Regression oracles must fail before the change and pass afterward. Fixture and oracle declarations are interfaces, not fabricated run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.
