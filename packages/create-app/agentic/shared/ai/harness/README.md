# Agent harness evaluations

`cases.json` is the 184-case standalone-app contract. Run `yarn harness:validate --all` for the deterministic gate. Live routing uses a fresh read-only process per case:

```text
yarn harness:validate --runner codex --all
yarn harness:validate --runner claude --case OMH-009
```

Writable evaluation is intentionally opt-in. The expanded catalog has a 39-case writable release target, but only cases registered in `release-matrix.json` and backed by controller-owned fixtures and oracles are executable. Copy or create a fresh standalone app for one registered case, then seed only that case and mark the target disposable:

```text
yarn harness:fixture --case OMH-009 --target /absolute/disposable/app --acknowledge-writes
yarn harness:validate --runner codex --case OMH-009 --writable-root /absolute/disposable/app --acknowledge-writes
```

The preparer refuses the controller app, non-standalone targets, reused targets, and existing fixture files. The evaluator rejects writes outside each case's `allowedWrites`. Every writable case is checked by the fixed controller-owned TypeScript AST oracle, so imports, comments, and token stuffing cannot satisfy an implementation contract. Integration/workflow and seeded regression cases also run isolated mocked behavior probes; the after phase runs the target's fixed `yarn typecheck` gate. The target can never supply or replace executable oracle code. Regression oracles must fail before the change and pass afterward. Fixture preparation is not run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.

The three generated-test cases use direct controller-resolved Jest/Playwright CLIs, never target package scripts. The target and dependencies stay read-only; Jest has no network, Playwright has loopback only, and the browser lane exposes only the exact installed headless-shell runtime. JSON reporters must attest at least one passed test and zero skipped, todo, focused, flaky, or expected-failure tests before review evidence can be created.

Generated-code review is a separate post-oracle lane, never a nested second-model call. The individual command is opt-in while developing one case; the once-per-release suite requires it for every writable case:

```text
yarn harness:validate --runner codex --review-writable-result /absolute/controller/.ai/harness/results/<writable-result>.json --writable-root /absolute/disposable/app
```

The source must be a passing one-shot implementation result from the current harness and its final whole-target fingerprint must still match. The controller copies changed regular text files as line-numbered inert snapshots, plus its pinned installed `om-code-review` skill and bounded trusted evidence, into a temporary read-only bundle. Target package scripts, dependencies, Git data, tracker state, original source files, and the target's absolute path are not copied or supplied to the reviewer; trace-verified out-of-bundle, environment, or process inspection and any bundle or target mutation fail closed. A separate sanitized artifact records source-result, target, policy, and installed-skill hashes plus the strict verdict, findings, and report. This supplemental review uses prior controller oracle evidence and does not claim the full repository validation gate or CI passed.

## Live-run security boundary

The runner receives an explicit allowlist of runtime/authentication variables rather than the evaluator's complete environment. Codex tool shells inherit no environment; Claude routing exposes only `Read`, `Glob`, and `Grep`. Every response-derived string is recursively redacted before validation or persistence.

The controller places read-only routing and generated-code review inside a host filesystem sandbox: macOS uses `/usr/bin/sandbox-exec`; Linux uses Bubblewrap with user namespaces; native Windows is unsupported for live/review lanes. Only the app or inert review bundle and isolated runner state are readable, only isolated output state is writable, and provider network access remains available. Claude's plan/read-only controls are defense in depth. Codex deliberately uses a permissive inner tool sandbox because nested macOS Seatbelt profiles cannot reliably read the already-contained app; the mandatory outer sandbox remains the filesystem authority. Tool-event traces are still mandatory release evidence: missing traces, environment-inspection commands, out-of-root reads, `.env*`, `.git/**`, `.ai/harness/**`, and case-forbidden or arbitrary app-root reads fail closed. `actualContext` contains only traced reads; `declaredContext` separately measures the model-reported selection. Writable runs additionally fingerprint normally ignored/protected roots before and after execution so writes under `.git`, `node_modules`, build output, or harness results cannot evade the allowlist check.
