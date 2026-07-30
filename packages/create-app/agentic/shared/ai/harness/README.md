# Agent harness evaluations

`cases.json` is the 196-case standalone-app contract. Run `yarn harness:validate --all` for the deterministic gate. Besides the schema, reference, and relation checks, that gate measures each case's declared context on disk and fails a case whose required or `allowedExtra` paths cannot fit its own file/byte budgets — so a grown guide or fact-sheet surfaces here, naming the exact numbers, instead of as a live routing failure. Live routing uses a fresh read-only process per case:

```text
yarn harness:validate --runner codex --all
yarn harness:validate --runner claude --case OMH-009
```

A blocking release selects one primary runner for every live lane. The optional portability runner must be different and receives only the exact 40-case representative read-only set:

```text
yarn harness:release --runner codex --prepare-targets /absolute/empty-release-targets --acknowledge-writes
yarn harness:release --runner codex --portability-runner claude --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

The primary runner owns all 196 routing cases, all 40 writable cases, and all generated-code reviews. No per-case fallback or mixed primary ownership is allowed. Omitting `--portability-runner` is valid and the sanitized report records `portabilityRunner: null`; explicitly requesting an unavailable or failing secondary runner fails that extended run.

Writable evaluation is intentionally opt-in. The expanded catalog has a 40-case writable release target, but only cases registered in `release-matrix.json` and backed by controller-owned fixtures and oracles are executable. Copy or create a fresh standalone app for one registered case, then seed only that case and mark the target disposable:

```text
yarn harness:fixture --case OMH-009 --target /absolute/disposable/app --acknowledge-writes
yarn harness:validate --runner codex --case OMH-009 --writable-root /absolute/disposable/app --acknowledge-writes
```

The preparer refuses the controller app, non-standalone targets, reused targets, and existing fixture files. The evaluator rejects writes outside each case's `allowedWrites`. Every writable case is checked by the fixed controller-owned TypeScript AST oracle, so imports, comments, and token stuffing cannot satisfy an implementation contract. Integration/workflow and seeded regression cases also run isolated mocked behavior probes; the after phase runs the target's fixed `yarn typecheck` gate. A case-local `timeoutMs` may only raise the operator timeout floor for an unusually broad writable one-shot; it never lowers an explicit operator timeout and is capped at 10 minutes. The target can never supply or replace executable oracle code. Regression oracles must fail before the change and pass afterward. Fixture preparation is not run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.

The three generated-test cases use direct controller-resolved Jest/Playwright CLIs, never target package scripts. The target and dependencies stay read-only; Jest has no network, Playwright has loopback only, and the browser lane exposes only the exact installed headless-shell runtime. JSON reporters must attest at least one passed test and zero skipped, todo, focused, flaky, or expected-failure tests before review evidence can be created.

Generated-code review is a separate post-oracle lane, never a nested second-model call. The individual command is opt-in while developing one case; the once-per-release suite requires it for every writable case:

```text
yarn harness:validate --runner codex --review-writable-result /absolute/controller/.ai/harness/results/<writable-result>.json --writable-root /absolute/disposable/app
```

The source must be a passing one-shot implementation result from the current harness and its final whole-target fingerprint must still match. The controller copies changed regular text files as line-numbered inert snapshots, plus its pinned installed `om-code-review` skill and bounded trusted evidence, into a temporary read-only bundle. Target package scripts, dependencies, Git data, tracker state, original source files, and the target's absolute path are not copied or supplied to the reviewer; trace-verified out-of-bundle, environment, or process inspection and any bundle or target mutation fail closed. A separate sanitized artifact records source-result, target, policy, and installed-skill hashes plus the strict verdict, findings, and report. This supplemental review uses prior controller oracle evidence and does not claim the full repository validation gate or CI passed.

## Live-run security boundary

The trusted runner receives an explicit allowlist of runtime/authentication variables rather than the evaluator's complete environment. The model receives no general shell, process, environment, discovery, browser, or network tool. Codex and Claude are both restricted to one evaluator-owned MCP server launched through `env -i`; it exposes only exact-path `read` and, for writable cases, allowlisted atomic `write`. The server rejects absolute/traversal paths, symlink escapes, credentials, dependencies, Git state, build output, and harness internals. Every response-derived string is also recursively redacted before validation or persistence.

The controller places routing and generated-code review inside a host filesystem sandbox: macOS uses `/usr/bin/sandbox-exec`; Linux uses Bubblewrap with user namespaces; native Windows is unsupported for live/review lanes. Only the trusted runner binary receives provider transport and isolated authentication state. Prompt-directed tools cannot open sockets or read runner state: the sole MCP subprocess has an empty environment, is rooted at the app or inert review bundle, and implements no process or network operation. The mandatory outer sandbox remains the filesystem authority; the narrow MCP contract is the model-tool authority. Tool-event traces are still mandatory release evidence: missing traces, out-of-root reads, `.env*`, `.git/**`, `.ai/harness/**`, and case-forbidden or arbitrary app-root reads fail closed. `actualContext` contains only traced MCP reads; `declaredContext` separately measures the model-reported selection. Writable runs additionally fingerprint normally ignored/protected roots before and after execution so writes under `.git`, `node_modules`, build output, or harness results cannot evade the allowlist check.
