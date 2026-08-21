# Agent harness evaluations

`cases.json` is the 235-case standalone-app contract. Run `yarn harness:validate --all` for the deterministic gate. Live routing uses a fresh read-only process per case:

UMES routing is fact-first. The additive and unified-override audit evaluations, plus their targeted cases, resolve exact/pattern hosts, outgoing contributions, correlation provenance, round-trip groups, framework-owned targets, and override domain/key/mode from the generated module sheets and `.ai/guides/framework-extension-points.md` before bounded installed source. The repository UMES umbrella spec may appear as optional source-checkout provenance; it is never required in a standalone scaffold.

```text
yarn harness:validate --runner codex --all
yarn harness:validate --runner claude --case OMH-009
```

For an explicitly requested Codex comparison outside the blocking release matrix, pin both dimensions so the sanitized result is reproducible, for example `--model gpt-5.4-mini --reasoning-effort high`. The effort override is Codex-only; supported values are `minimal`, `low`, `medium`, `high`, and `xhigh`, and omitting it preserves the existing runner default. Measured high-effort mini runs legitimately exceed ten minutes on broad context, so that exact model/effort pair uses a 15-minute per-attempt floor; measured Claude/Sonnet runs use a 10-minute floor. Passing `--timeout` remains authoritative, and other routing runs retain the five-minute default.

A blocking release selects one primary runner for every live lane. The optional portability runner must be different and receives only the exact 49-case representative read-only set:

```text
yarn harness:release --runner codex --prepare-targets /absolute/empty-release-targets --acknowledge-writes
yarn harness:release --runner codex --portability-runner claude --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

The primary runner owns all 235 routing cases, all 49 writable cases, and all generative-judge runs. No per-case fallback or mixed primary ownership is allowed. Omitting `--portability-runner` is valid and the sanitized report records `portabilityRunner: null`; explicitly requesting an unavailable or failing secondary runner fails that extended run.

Writable evaluation is intentionally opt-in. The expanded catalog has a 49-case writable release target, but only cases registered in `release-matrix.json` and backed by controller-owned fixtures and oracles are executable. Copy or create a fresh standalone app for one registered case, then seed only that case and mark the target disposable:

```text
yarn harness:fixture --case OMH-009 --target /absolute/disposable/app --acknowledge-writes
yarn harness:validate --runner codex --case OMH-009 --writable-root /absolute/disposable/app --acknowledge-writes
```

For a manually prepared writable target, run `yarn generate` in the target first and replace its `node_modules` directory with a link to the controller scaffold's dependency tree. The evaluator rejects copied or independently installed dependency trees because the controller must fingerprint and mount one protected dependency source. `--prepare-targets` performs both steps automatically for a full release run.

The preparer refuses the controller app, non-standalone targets, reused targets, and existing fixture files. The evaluator rejects writes outside each case's `allowedWrites`. Every writable case is checked by the fixed controller-owned TypeScript AST oracle, so imports, comments, and token stuffing cannot satisfy an implementation contract. Integration/workflow and seeded regression cases also run isolated mocked behavior probes; the after phase runs the target's fixed `yarn typecheck` gate. A case-local `timeoutMs` may only raise the operator timeout floor for an unusually broad writable one-shot; it never lowers an explicit operator timeout and is capped at 10 minutes. The target can never supply or replace executable oracle code. Regression oracles must fail before the change and pass afterward. Fixture preparation is not run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.

The four generated-test cases use direct controller-resolved Jest/Playwright CLIs, never target package scripts. The target and dependencies stay read-only; Jest has no network, Playwright has loopback only, and the browser lane exposes only the exact installed headless-shell runtime. JSON reporters must attest at least one passed test and zero skipped, todo, focused, flaky, or expected-failure tests before review evidence can be created.

The generative judge is a separate post-oracle lane, never a nested second-model call. It applies the reusable `om-judge-agent-session` workflow, the pinned `om-code-review` skill, and UI design-system references when applicable. The individual command is opt-in while developing one case; the once-per-release suite requires it for every writable case:

```text
yarn harness:validate --runner codex --judge-writable-result /absolute/controller/.ai/harness/results/<writable-result>.json --writable-root /absolute/disposable/app
```

The source must be a passing one-shot implementation result from the current harness and its final whole-target fingerprint must still match. The controller copies changed regular text files as line-numbered inert snapshots, the local judge skill, its pinned installed `om-code-review` skill, and bounded trusted evidence into a temporary read-only bundle. Target package scripts, dependencies, Git data, tracker state, original source files, and the target's absolute path are not copied or supplied to the judge; trace-verified out-of-bundle, environment, or process inspection and any bundle or target mutation fail closed. A separate sanitized artifact records source-result, target, policy, and skill hashes plus fixed evidence, artifact findings, design-system assessment, the smallest harness-owner findings, strict verdicts, and both reports. The legacy `--review-writable-result` and `--review-validation-result` flags remain read-only compatibility aliases. This supplemental judge uses prior controller evidence and does not claim validation or CI that did not run.

## Live-run security boundary

The trusted runner receives an explicit allowlist of runtime/authentication variables rather than the evaluator's complete environment. The model receives no general shell, process, environment, discovery, browser, or network tool. Codex and Claude are both restricted to one evaluator-owned MCP server launched through `env -i`; it exposes only exact-path `read` and, for writable cases, allowlisted atomic `write`. The server rejects absolute/traversal paths, symlink escapes, credentials, dependencies, Git state, build output, and harness internals. Every response-derived string is also recursively redacted before validation or persistence.

On macOS, Claude Code subscription credentials normally live in the login Keychain and cannot be copied into the isolated runner home. Run `claude setup-token`, export the resulting value as `CLAUDE_CODE_OAUTH_TOKEN`, and then start the Claude lane. Missing or exhausted provider authentication aborts the matrix as an environment failure instead of being counted as a case result.

The controller places routing and generated-code review inside a host filesystem sandbox: macOS uses `/usr/bin/sandbox-exec`; Linux uses Bubblewrap with user namespaces; native Windows is unsupported for live/review lanes. Only the trusted runner binary receives provider transport and isolated authentication state. Prompt-directed tools cannot open sockets or read runner state: the sole MCP subprocess has an empty environment, is rooted at the app or inert review bundle, and implements no process or network operation. The mandatory outer sandbox remains the filesystem authority; the narrow MCP contract is the model-tool authority. Tool-event traces are still mandatory release evidence: missing traces, out-of-root reads, `.env*`, `.git/**`, `.ai/harness/**`, and case-forbidden or arbitrary app-root reads fail closed. `actualContext` contains only traced MCP reads; `declaredContext` separately measures the model-reported selection. Writable runs additionally fingerprint normally ignored/protected roots before and after execution so writes under `.git`, `node_modules`, build output, or harness results cannot evade the allowlist check.
