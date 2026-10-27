# Notify — 2026-10-27-agent-platform-wave-3

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-27T07:37:13Z — run started
- Brief: agent platform roadmap wave 3 — MCP P4 + Identity P1 + Identity P5 (one release, ID-Q3), Integrity P1–P2, DocStructure P3; one PR to open-mercato/open-mercato `main`.
- External skill URLs: none

## 2026-10-27T07:37:13Z — decision: stacked base
- #7794 (wave 1) and #8011 (wave 2) are open and unmerged (#7794 still conflicts with `main`, failing `test` + CodeQL). Wave 3 depends on wave-2 code (`runId`, `AiAgentRunChannel`, §6, `runManifest.ts`), so it stacks on `feat/agent-platform-wave-2` @ `2d3734ed6`, as wave 2 stacked on wave 1.

## 2026-10-27T07:37:13Z — decision: spec deviations found during planning
- `runAiAgentObject` has no `mutationPolicyOverride`; `defineAgentTool` relies on the existing channel rule (`mcp` / `tools-api` → read-only unless `approval`).
- The chat route has no object branch; only `run-object` delegates.
- `emitCitations` does not exist (Chat P4); the document-sections tool returns `citation` / `locator` fields only.
- No attachment drawer exists; the structure panel becomes a lazy tab in `packages/ui` `AttachmentMetadataDialog` (ui cannot import core).
- `abstain_or_review` is Integrity P3 and is not added to the rule union in this wave.

## 2026-10-27T07:37:13Z — environment: no agent pushes to upstream
- Executors commit locally without pushing; the user pushes at checkpoints. The per-Step "push" rule is replaced by "local HEAD contains the commit".

## 2026-10-27T07:37:13Z — subagent delegation
- Two read-only Explore subagents surveyed the code (MCP/identity, integrity/doc-structure) before planning.

## 2026-10-27T08:12:10Z — draft PR opened
- https://github.com/open-mercato/open-mercato/pull/8018 (draft, claimed: assignee + in-progress + claim comment) after the user's first push.

## 2026-10-27T08:12:10Z — checkpoint 1 (Steps 1.1..1.5)
- ai-assistant jest 158/158 suites, shared ai 67 tests, typecheck, lint, i18n sync/usage, build:app --force: pass. UI browser check skipped (no dev server for this worktree); McpExposureSection covered by an RTL test.
- Subagent delegations: one executor per Step (1.1–1.5), sequential.
- Decisions from executors: `AgentToolError` lives in its own file (import cycle with tool-executor); agent-tool `requiredFeatures` are materialized by the tool loader after loading the agent registry; `outputSchema` is not advertised for mutation tools (pending-approval results would fail SDK output validation); `createDevMcpServer` keeps its sync signature with an optional pre-filtered tool list.

## 2026-10-27T08:45:29Z — checkpoint 2 (Steps 1.6, 2.1..2.4)
- AO jest 185 suites / 1715 tests, core workflows, cli agent-files, ai-assistant jest, i18n, typecheck, lint, build:app --force: pass. UI browser check skipped (no dev env; AO not registrable in the ephemeral app).
- Decisions from executors:
  - File agents never reach an ai-assistant definition (`registerFileAgent` skips `defineAiAgent`), so their `requiredFeatures` are enforced only by the AO runtime check.
  - The file-agent manifest is regenerated only with `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`. Unrelated generator drift in the two type-import lines of `file-agents.generated.ts` was reverted to the committed form, so the commit carries only the new key.
  - Invoker ACL loading fails closed (no grants on RBAC error or when the org restriction excludes the run's org); this only affects agents that declare `requiredFeatures`.
  - OpenCode `delegate_agent` runs in the MCP process without a run context, so the child is checked against the tool caller's user.
  - Core `workflows` `failInvokeAgentStep` now records the error's string `code` in `errorData.code` / `details.code` (additive; any coded agent error).
  - With `OM_AGENT_INVOKE_ENFORCEMENT=off`, `GET /agents` reports every agent `invocable: true`, matching the runtime.
- Review note for the final pass: the run/rerun 403 body carries an English `error` string, like the routes' other errors; the Playground translates the code.

## 2026-10-27T09:00:40Z — Step 3.2 decision: run-object input mapping for dispatched agents
- AO agents take a free-form input (no input schema; the native runner passes a string as-is and JSON-stringifies anything else into the prompt). `run-object` receives chat `messages`, so a dispatched run gets the content string when the body is a single `user` message, and the messages array otherwise. No typed-input mapping exists on this door; callers with a typed input use the AO run route.
- `agent_invoke_denied` from the dispatcher maps to `403 agent_features_denied` with a generic message (no feature names); `agent_principal_missing` (or a caller with no tenant/org/principal) maps to `409 agent_principal_missing`. Natively registered AO agents still go through `checkAgentPolicy` first, whose existing 403 message lists the agent's features (unchanged route behavior).
- Dispatcher runs use a 120 000 ms route timeout (same default as `defineAgentTool`).

## 2026-10-27T09:11:58Z — checkpoint 3 (Steps 2.5..3.3)
- AO jest 189 suites / 1751 tests, core workflows + module-decoupling, ai-assistant jest, i18n, typecheck, lint, build:app --force: pass. No UI in this window.
- Decisions from executors:
  - Workflow grant warnings check the definition's declared `grantedFeatures` (the principal role ACL is synced to exactly that grant) and are API-only (`warnings` on create/update/customize/publish responses); the editor has no warning surface.
  - `om.invoker` for `agent_token` maps the on-behalf-of user to `ownerUserId`; the grant id is not in the manifest.
  - The AO dispatcher runs API-key callers as the key (`api_key:<id>` subject, same as the AO run route), not as the key owner. "Disabled" is detected as "absent from the loaded ai-assistant registry" (no override helper exists); file agents are always available. The AO registry is not loaded at bootstrap, so ai-assistant callers use `resolveDispatchOwner` (owns() or, for ids unknown locally, awaited isAvailable()). Abort is raced, not propagated (runtime takes no signal).
  - run-object passes a single user message as its content string, else the messages array, to AO agents. Agents present in the ai-assistant registry still hit `checkAgentPolicy` first, whose existing 403 message lists the required features; dispatcher denials are generic.
  - Agent-token route uses `requireAuth: false` and the bucket `RATE_LIMIT_AGENT_ORCH_AGENT_API_RUN_*`; staff run-route helpers extracted to `lib/runtime/agentRunHttp.ts`.
- Finding (pre-existing, out of scope, follow-up): `api/identity/token/route.ts` and `api/identity/agent/auth/route.ts` declare `POST: {}`; the app dispatcher (`checkAuthorization`) requires auth unless `requireAuth === false`, so these OAuth endpoints are unreachable without a staff session. Verified in `apps/mercato/src/app/api/[...slug]/route.ts`.

## 2026-10-27T09:44:37Z — checkpoint 4 (Steps 3.4..3.6, Phase 3 close)
- ai-assistant + AO jest, lint, typecheck, agents budget, template sync, build:app --force: pass.
- Integration against the ephemeral app (AO enabled via enterprise flags): wave-3 specs 8 passed / 2 skipped (no real LLM provider; no deterministic unrunnable agent tool). TC-AI-RUN-TRACE-016 failed twice → fixed forward as Step 3.6 (resolver depth for nullable runId; providerOptions case contradicted the wave-2 HTTP schema — latent on #8011 too).
- Correction to the wave-2 handoff: AO does register in the ephemeral app when started with `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`.
- Decision: the 3.4 commit reached `upstream` before its amend, so local was reset to the pushed `d14cf1e1a` (code identical) and the 3.4 row is flipped in this checkpoint commit. Executor rule changed: no amend; `pending` SHAs filled at checkpoints.
- 3.4 decisions: tool name `agent_examples.triage_ticket` (FROZEN once published); `support.ticket_triage` declares `requiredFeatures: ['agent_orchestrator.agents.view']` (existing feature, granted to employee/admin/superadmin by default).

## 2026-10-27T09:45:26Z — safety checkpoint: paused for user review
- 18 code Steps landed (Phases 1–3: MCP P4 + Identity P1 + Identity P5, the ID-Q3 bundle). Paused at the phase boundary per the ~20-Step safety checkpoint before Integrity P1–P2 and DocStructure P3. Resume point: Step 4.1. Lock released; PR stays a draft with `Status: in-progress`.

## 2026-10-27T10:54:23Z — resumed after user review
- The user said "Continue"; lock reclaimed; Steps resume at 4.1.

## 2026-10-27T10:54:23Z — checkpoint 5 (Steps 4.1..4.5)
- AO jest 195 suites / 1899 tests, i18n, typecheck, lint, build:app --force: pass.
- Decisions from executors: integrity paths are relative to the whole result envelope (e.g. `data.findings[*]`); `onResolverMissing` accepts `block` (default) and `flag`; `tool_consulted` needs `returned` or `matchArgs`; `integrity` in AGENT.md frontmatter not supported (optional per spec); normalization works per grapheme cluster (partial-cluster matches widen outward; empty quotes never match); evidence_quote misses under `onViolation: 'repair'` are flagged; integrity agents' `tool_scope` uses the effective tool allowlist (own + skill + delegate tools) with `attemptedTools`; rule kinds without an evaluator block with `integrity_rule_unsupported` until Phase 5; tool-call errors keep only the code in memory; `integrityEvidenceSchema.rawOutput.key` is optional (omitted when storage is unavailable).

## 2026-10-27T11:12:45Z — Step 5.2 decisions (tool_consulted)
- `includeSubRuns` is in-process only: nested NATIVE `delegate_agent` runs forward their in-memory tool calls to the parent through the run context (`withRunContext` gains an optional `toolCallSink`). Sub-runs on OpenCode or another process are not visible, and persisted `agent_tool_calls` rows are NOT read (they hold redacted summaries, not full results); documented in the rule JSDoc.
- `enforce: 'prepare_step'`: additive ai-assistant change — `runAiAgentObject`'s `loop` type now accepts `prepareStep`, honoured on the `enableTools` tool-loop branch through `buildWrapperPrepareStep` (mutation gate intact); when tools fall back to the toolless path the caller `prepareStep` is dropped with a warning (without `enableTools` it still throws `loop_unsupported_in_object_mode`). AO `defineAgent` `loop` only carries `maxSteps`, so there is no agent `prepareStep` to compose with. Enforcement is skipped in shadow mode (`OM_AGENT_INTEGRITY=off`).
- Matching: cited arrays flattened; strings/numbers compared as strings; JSON-string tool results are parsed; `matchArgs` matches any string/number arg leaf when the result is non-empty; failed calls and `{ found: false }` never count.

## 2026-10-27T11:23:29Z — checkpoint 6 (Steps 4.6..5.3)
- AO jest 1994, ai-assistant jest 2159, shared ai 69, i18n, typecheck, lint, build:app --force: pass.
- Decision (4.6-review-fix, inline): `guardrailSetBodySchema` / `GuardrailSetBody` are public exports on `main`; 4.6 had turned the schema into the grounding|integrity union (a parse-type change for existing callers). Restored it as the grounding schema (alias of `groundingSetBodySchema`) and added `agentGuardrailSetBodySchema` for stored bodies. No UPGRADE_NOTES entry needed.
- Decisions from executors: integrity sets hash with key-order-independent JSON and keep rule order; the runner ensures the set row exists before each integrity run (fail-open on sync error); shadow mode records would-be blocks as `warn` with `{ shadow: true, wouldBlock: true }` and disables prepare-step enforcement; `reference_exists` drop removes the nearest enclosing array item, no org scope → `scope_missing` (fail closed), resolver errors fail closed via `onResolverMissing`; custom checkers are resolved at run time (missing → `checker_missing`, throwing/malformed → `checker_error`, both block), reasons coerced to codes, checkers get cloned inputs.

## 2026-10-27T11:52:46Z — checkpoint 7 (Steps 5.4..5.6, Phase 5 close)
- Integration against the AO-enabled ephemeral app found a pre-existing defect: `GET /api/agent_orchestrator/guardrail-checks` and `/context-bundles` returned 500 for every request (their `ENTITY_TYPE` named no registered entity, so the query engine read `guardrail_checks` / `context_bundles`, which do not exist). Fixed forward in Step 5.6 with a route entity-id guard test. After the fix: 21 passed, 4 skipped (model-dependent / no unrunnable tool).
- AO jest 1996, agent_examples jest 4, i18n, typecheck, lint, template sync, build:app --force: pass.
- Environment: a restarted ephemeral env reuses build artifacts younger than 600 s; use `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=0` after source changes.
- 5.4/5.5 decisions: `support.policy_check` uses a static in-code policy catalogue (no entities/migrations; resolver ignores scope, documented as global example data); its result `kind` is `'research'` (the two older example agents use `'researcher'` — pre-existing inconsistency, untouched); TC-AGENT-INT-001/002 seed run + check rows directly in the DB (no create API), like TC-AGENT-PERF; TC-AGENT-INT-004 is model-gated.
