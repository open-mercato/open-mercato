# Agent harness evaluations

`cases.json` is the 92-case standalone-app contract. Run `yarn harness:validate --all` for the deterministic gate. Live routing uses a fresh read-only process per case:

```text
yarn harness:validate --runner codex --all
yarn harness:validate --runner claude --case OMH-009
```

Writable evaluation is intentionally opt-in and only accepts the fixed 16 cases in `release-matrix.json`. Copy or create a fresh standalone app for one case, then seed only that case and mark the target disposable:

```text
yarn harness:fixture --case OMH-009 --target /absolute/disposable/app --acknowledge-writes
yarn harness:validate --runner codex --case OMH-009 --writable-root /absolute/disposable/app --acknowledge-writes
```

The preparer refuses the controller app, non-standalone targets, reused targets, and existing fixture files. The evaluator rejects writes outside each case's `allowedWrites`. Regression oracles must fail before the change and pass afterward. Fixture preparation is not run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.
