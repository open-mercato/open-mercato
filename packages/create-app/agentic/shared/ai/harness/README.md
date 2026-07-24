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

The preparer refuses the controller app, non-standalone targets, reused targets, and existing fixture files. The evaluator rejects writes outside each case's `allowedWrites`. Every writable case is checked by the fixed controller-owned TypeScript AST oracle, so imports, comments, and token stuffing cannot satisfy an implementation contract. Integration/workflow and seeded regression cases also run isolated mocked behavior probes; the after phase runs the target's fixed `yarn typecheck` gate. The target can never supply or replace executable oracle code. Regression oracles must fail before the change and pass afterward. Fixture preparation is not run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.

## Live-run security boundary

The runner receives an explicit allowlist of runtime/authentication variables rather than the evaluator's complete environment. Codex tool shells inherit no environment; Claude routing exposes only `Read`, `Glob`, and `Grep`. Every response-derived string is recursively redacted before validation or persistence.

The CLI read-only/plan modes prevent harness writes, but neither runner provides a portable filesystem read denylist. Run live routing only in a generated or otherwise non-sensitive app. Tool-event traces are therefore mandatory release evidence: missing traces, environment-inspection commands, out-of-root reads, `.env*`, `.git/**`, `.ai/harness/**`, and case-forbidden or arbitrary app-root reads fail closed. `actualContext` contains only traced reads; `declaredContext` separately measures the model-reported selection. Writable runs additionally fingerprint normally ignored/protected roots before and after execution so writes under `.git`, `node_modules`, build output, or harness results cannot evade the allowlist check.
