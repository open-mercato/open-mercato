# Agent harness evaluations

`cases.json` is the 192-case standalone-app contract. Run `yarn harness:validate --all` for the deterministic gate. Live routing uses a fresh read-only process per case:

```text
yarn harness:validate --runner codex --all
yarn harness:validate --runner claude --case OMH-009
yarn harness:validate --runner oai --model qwen/qwen3.6-35b-a3b --all
```

For an explicitly requested Codex comparison outside the blocking release matrix, pin both dimensions so the sanitized result is reproducible, for example `--model gpt-5.4-mini --reasoning-effort high`. The effort override is Codex-only; supported values are `minimal`, `low`, `medium`, `high`, and `xhigh`, and omitting it preserves the existing runner default. Measured high-effort mini runs legitimately exceed ten minutes on broad context, so that exact model/effort pair uses a 15-minute per-attempt floor; measured Claude/Sonnet runs use a 10-minute floor. Passing `--timeout` remains authoritative, and other routing runs retain the five-minute default.

A blocking release selects one primary runner for every live lane. The optional portability runner must be different and receives only the exact 45-case representative read-only set:

```text
yarn harness:release --runner codex --prepare-targets /absolute/empty-release-targets --acknowledge-writes
yarn harness:release --runner codex --portability-runner claude --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

The primary runner owns all 192 routing cases, all 45 writable cases, and all generated-code reviews. No per-case fallback or mixed primary ownership is allowed. Omitting `--portability-runner` is valid and the sanitized report records `portabilityRunner: null`; explicitly requesting an unavailable or failing secondary runner fails that extended run.

Writable evaluation is intentionally opt-in. The expanded catalog has a 45-case writable release target, but only cases registered in `release-matrix.json` and backed by controller-owned fixtures and oracles are executable. Copy or create a fresh standalone app for one registered case, then seed only that case and mark the target disposable:

```text
yarn harness:fixture --case OMH-009 --target /absolute/disposable/app --acknowledge-writes
yarn harness:validate --runner codex --case OMH-009 --writable-root /absolute/disposable/app --acknowledge-writes
```

For a manually prepared writable target, run `yarn generate` in the target first and replace its `node_modules` directory with a link to the controller scaffold's dependency tree. The evaluator rejects copied or independently installed dependency trees because the controller must fingerprint and mount one protected dependency source. `--prepare-targets` performs both steps automatically for a full release run.

The preparer refuses the controller app, non-standalone targets, reused targets, and existing fixture files. The evaluator rejects writes outside each case's `allowedWrites`. Every writable case is checked by the fixed controller-owned TypeScript AST oracle, so imports, comments, and token stuffing cannot satisfy an implementation contract. Integration/workflow and seeded regression cases also run isolated mocked behavior probes; the after phase runs the target's fixed `yarn typecheck` gate. A case-local `timeoutMs` may only raise the operator timeout floor for an unusually broad writable one-shot; it never lowers an explicit operator timeout and is capped at 10 minutes. The target can never supply or replace executable oracle code. Regression oracles must fail before the change and pass afterward. Fixture preparation is not run evidence. Generated results live under ignored `.ai/harness/results/`; they contain hashes and sanitized summaries, never raw transcripts or environment values.

The four generated-test cases use direct controller-resolved Jest/Playwright CLIs, never target package scripts. The target and dependencies stay read-only; Jest has no network, Playwright has loopback only, and the browser lane exposes only the exact installed headless-shell runtime. JSON reporters must attest at least one passed test and zero skipped, todo, focused, flaky, or expected-failure tests before review evidence can be created.

Generated-code review is a separate post-oracle lane, never a nested second-model call. The individual command is opt-in while developing one case; the once-per-release suite requires it for every writable case:

```text
yarn harness:validate --runner codex --review-writable-result /absolute/controller/.ai/harness/results/<writable-result>.json --writable-root /absolute/disposable/app
```

The source must be a passing one-shot implementation result from the current harness and its final whole-target fingerprint must still match. The controller copies changed regular text files as line-numbered inert snapshots, plus its pinned installed `om-code-review` skill and bounded trusted evidence, into a temporary read-only bundle. Target package scripts, dependencies, Git data, tracker state, original source files, and the target's absolute path are not copied or supplied to the reviewer; trace-verified out-of-bundle, environment, or process inspection and any bundle or target mutation fail closed. A separate sanitized artifact records source-result, target, policy, and installed-skill hashes plus the strict verdict, findings, and report. This supplemental review uses prior controller oracle evidence and does not claim the full repository validation gate or CI passed.

## OpenAI-compatible lane

`--runner oai` measures any model behind an OpenAI-compatible chat-completions endpoint: a gateway, a vendor API, or a local llama.cpp/LM Studio server. The lane owns its agent loop instead of delegating to a vendor CLI, so the model reaches app content only through the same `env -i` MCP tool server the other runners receive, and its trace, budgets, refused reads, and fail-closed gates are unchanged.

Configuration is environment-only; no endpoint, credential, or model identifier is committed:

| Variable | Meaning |
|---|---|
| `OM_OAI_API_KEY` | Required bearer credential. |
| `OM_OAI_BASE_URL` | Endpoint root, default `https://openrouter.ai/api/v1`. |
| `OM_OAI_MODEL` | Model id used when `--model` is absent. |
| `OM_OAI_PROVIDER_ORDER`, `OM_OAI_QUANTIZATIONS`, `OM_OAI_PROVIDER_SORT`, `OM_OAI_ALLOW_FALLBACKS` | Gateway routing pin. Setting any of them sends `allow_fallbacks: false` unless overridden. |
| `OM_OAI_TEMPERATURE`, `OM_OAI_TOP_P`, `OM_OAI_TOP_K`, `OM_OAI_MIN_P`, `OM_OAI_MAX_TOKENS`, `OM_OAI_SEED` | Decoding. Every unset key is omitted from the request rather than defaulted. |
| `OM_OAI_REASONING_EFFORT`, `OM_OAI_REASONING_MAX_TOKENS`, `OM_OAI_REASONING_EXCLUDE` | Thinking-mode controls for models that expose them. |
| `OM_OAI_MAX_STEPS` | Tool-call budget per case, default 40. |
| `OM_OAI_DISABLE_RESPONSE_FORMAT` | Skip `response_format` for an endpoint that cannot enforce a JSON schema. |
| `OM_OAI_USAGE_ACCOUNTING` | Request gateway token/cost accounting. Defaults on for OpenRouter hosts and off elsewhere, because a strict endpoint rejects the field. |

Two properties decide whether a sweep is comparable. First, a gateway that routes freely can serve different hosts and quantizations inside one matrix, so pin the provider and record which one served the run: the lane sends the pin on every call and each result stores the serving provider. Second, sampling that is left to gateway defaults varies by host, so set the decoding the model card prescribes rather than assuming a default. A structured-output downgrade, a truncated completion, and a step-budget exhaustion each fail their case loudly instead of degrading quietly.

Run exactly one sweep per lane at a time and keep a separate results directory per sweep. Concurrent sweeps of the same lane against one controller produce results that cannot be attributed to a harness version.

## Live-run security boundary

The trusted runner receives an explicit allowlist of runtime/authentication variables rather than the evaluator's complete environment. The model receives no general shell, process, environment, discovery, browser, or network tool. Codex and Claude are both restricted to one evaluator-owned MCP server launched through `env -i`; it exposes only exact-path `read` and, for writable cases, allowlisted atomic `write`. The server rejects absolute/traversal paths, symlink escapes, credentials, dependencies, Git state, build output, and harness internals. Every response-derived string is also recursively redacted before validation or persistence.

On macOS, Claude Code subscription credentials normally live in the login Keychain and cannot be copied into the isolated runner home. Run `claude setup-token`, export the resulting value as `CLAUDE_CODE_OAUTH_TOKEN`, and then start the Claude lane. Missing or exhausted provider authentication aborts the matrix as an environment failure instead of being counted as a case result.

The controller places routing and generated-code review inside a host filesystem sandbox: macOS uses `/usr/bin/sandbox-exec`; Linux uses Bubblewrap with user namespaces; native Windows is unsupported for live/review lanes. Only the trusted runner binary receives provider transport and isolated authentication state. Prompt-directed tools cannot open sockets or read runner state: the sole MCP subprocess has an empty environment, is rooted at the app or inert review bundle, and implements no process or network operation. The mandatory outer sandbox remains the filesystem authority; the narrow MCP contract is the model-tool authority. Tool-event traces are still mandatory release evidence: missing traces, out-of-root reads, `.env*`, `.git/**`, `.ai/harness/**`, and case-forbidden or arbitrary app-root reads fail closed. `actualContext` contains only traced MCP reads; `declaredContext` separately measures the model-reported selection. Writable runs additionally fingerprint normally ignored/protected roots before and after execution so writes under `.git`, `node_modules`, build output, or harness results cannot evade the allowlist check.
