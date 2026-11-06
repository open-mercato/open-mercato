# Research — Integrity P3–P5, Identity P2–P4, Eval P3–P5 (verified on `2d407b96f`)

Paths are under `packages/enterprise/src/modules/agent_orchestrator/` (AO) unless fully qualified.

## Code facts

### Integrity
- Pipeline `lib/guardrails/integrity/pipeline.ts:158-247`: schema → integrity rules → re-validate → single `checkOutput` (grounding + tool_scope); shadow mode strips `holdsAutoApproval` (`:133-147`); no `abstain_or_review` evaluator (`:32-37`).
- `guardrailKind` lacks `abstain_or_review` (`data/validators.ts:649-660`); rule union has 4 arms (`:1095-1101`); `untrustedSpanSchema.sourceKind` = `document|retrieval` (`:727-735`); `integritySetBodySchema.untrustedInputs` exists but always synced as `[]` (`:1170-1175`, `integritySets.ts:44-51`).
- `holdsAutoApproval` is written by the rule files (`rules/*.ts`, e.g. `evidenceQuote.ts:144-161`) but `resolvePolicyEvidence` counts only `result='block'` (`lib/disposition/dispositionService.ts:145-149`); `guardrailsPassed=false` already maps to block reason `'guardrail'` (`autoApprovalPolicy.ts:135`).
- No `run.review_requested` in `events.ts`.
- Native runner sends `JSON.stringify(input)` to the model (`lib/runtime/nativeAgentRunner.ts:490`); `checkInput` sees context spans only (`:213`); pipeline call `:609-631`; `persistVerdict` `:655`, `:681`.
- `RunAiAgentObjectInput` has no per-run system-prompt suffix (`ai-assistant/.../agent-runtime.ts:2333-2440`).
- Run API success body `{...result, runId, proposalId}` (`lib/runtime/agentRunHttp.ts:245-263`); `GET /runs/:id` has no `integrity`/`rawOutputKey` (`api/runs/[id]/route.ts:48-82`).
- `GuardrailsCard` renders raw `check.kind` (`backend/traces/[id]/page.tsx:214-292`).
- `ScorerRunView` has no guardrail checks (`lib/eval/types.ts:18-37`, `projectRunView.ts`); registry has 22 scorers.
- OpenCode runner runs no guardrails, schema re-parse only (`lib/runtime/openCodeAgentRunner.ts:354-384`); captured tool calls `{toolName,args,result,status}` (`:50-58`).

### Identity
- `AgentRunCtx` has `invoker/entryPoint/channel/correlationId/callSettings/runAs` (`lib/runtime/persistence.ts:28-119`); `buildCommandContext` maps only `runAs` (`:121-148`) and is built before the run id exists (`nativeAgentRunner.ts:140-142`).
- Tool ACL is caller-only: `resolveCallerAcl(ctx.userId)` (`persistence.ts:150-169`, used `nativeAgentRunner.ts:239`).
- `AgentRuntimeService.run()` does the invoke check (`agentRuntime.ts:57`) and binds `withAgentActor` only when `ctx.runAs` is set (`:94-105`).
- `runAs` resolved in two places: workflow bridge (`invokeAgentForWorkflow.ts:261-275`) and eval replay, which also sets `userId = principal.userId` (`lib/eval/evalReplayService.ts:320-336`).
- `provisionAgentPrincipal` merges features, never narrows (`lib/identity/agentPrincipalService.ts:170-178`); `resolveAgentPrincipal` filters by org without tenant and ignores `enabled` (`:225-236`). Core `provisionExecutionPrincipal` replaces the ACL and documents naming knobs for this migration (`packages/core/src/modules/auth/lib/executionPrincipal.ts:20-25`, `:102-220`). No `defineAgent.principal`, no sync job.
- Disallowed tools are dropped before the model sees them (`ai-assistant/.../agent-tools.ts:440-450`).
- No `intersectFeatureGrants` in `packages/shared/src/security/features.ts`.
- Command bus merges only `runAs.source` into the log context (`packages/shared/src/lib/commands/command-bus.ts:964-969`); no `auditCorrelation` (`types.ts:111-121`).
- `action_logs.context_json` is encrypted (`packages/core/src/modules/audit_logs/encryption.ts`; stored as a jsonb string with encryption on, handled at `services/actionLogService.ts:498-503`); no index on it. Projection-column precedent: `source_key`, `changed_fields` (GIN) derived from the decrypted context + backfill (`lib/projections.ts:100-112`, `services/actionLogService.ts:320-346`, `:890-920`).
- No `executeApprovedProposal`; approved effects run in core workflows `UPDATE_ENTITY`/`EXECUTE_COMMAND` (`packages/core/src/modules/workflows/lib/activity-executor.ts:1119-1145`); workflow context carries `proposalId` (`context-ledger.ts:102`).
- OAuth identity routes declare `POST: {}` (`api/identity/token/route.ts:30-32`, `api/identity/agent/auth/route.ts:38-40`; both rate-limited). `verifyAgentToken` looks up the grant by `{id, organizationId}` without tenant (`lib/identity/agentTokenService.ts:268-272`).
- Latent bug: `ensureIntegritySetSynced` flushes `AgentGuardrailSet` in-run without the runtime-audit scope (`nativeAgentRunner.ts:764-778`) — would throw (swallowed) under a principal.
- Pre-existing: `by-instigator` reads encrypted `command_id`/`action_label` raw through Kysely.

### Eval
- `lib/eval/manifest.ts`: `source: 'db'|'file'` (`:64`), case `fixtures` (`:54-56`), UUIDv5 ids (`:131-137`), size cap.
- `evalRuns.start` takes snapshot/label pins only (`commands/evalRuns.ts:34-53`, `:105-137`); `EvalGateInput` lacks `cases`/`callSettings`/`replay` (`lib/eval/evalGate.ts:14-36`).
- Replay passes no call settings (`evalReplayService.ts:329-352`); progress event looks up an `AgentEvalCase` row (`:250`) — file cases have none; `replaySuiteRun` runs in-process (CLI, `api/eval-runs/route.ts:163`) and via `workers/eval-suite-runner.ts:62`.
- Native runner forwards `ctx.callSettings` (`nativeAgentRunner.ts:501`); ai-assistant merges over `modelSettings` (`agent-runtime.ts:2672`); AO `defineAgent` does not forward `modelSettings` (`lib/sdk/defineAgent.ts:303-323`).
- Report env hard-coded `modelSettings: {}`, `toolMode: 'live'` (`lib/eval/report/buildEvalReport.ts:417-424`); schema slots exist (`reportSchema.ts:107-119`).
- `gen_ai.request.seed`/`.temperature` recorded on llm spans when capture ≠ off (`lib/runtime/nativeTraceCapture.ts:148-158`).
- `yaml@2.9.0` is a root devDependency and pinned in `resolutions` (`package.json:211`, `:252`), not in `packages/enterprise/package.json` — EVAL-Q2 approved adding it.
- No scripted LLM provider exists (`__integration__/TC-AGENT-INT-002.spec.ts:35`); unit tests mock `runAiAgentObject`.
- Judge config has two arms, no `rubricRef` (`lib/eval/registry/judge.ts:20-37`).
- `agent_eval_case_runs.eval_case_id` has no FK (file-set case runs work without case rows).
- Any new command must be added to `packages/core/src/__tests__/optimistic-lock-command-coverage.test.ts`; any new ACL feature needs its title in core `auth/i18n/*.json` (`auth.acl.features.*`).

## Migration decision
No AO DDL. Audit correlation uses a core `audit_logs` migration + snapshot: `correlation_keys text[] null` + GIN `action_logs_correlation_keys_idx`, a plaintext projection derived from decrypted `context.correlation` (like `changed_fields`): `key:value` pairs, id-shaped values only, max 16. The full map stays in encrypted `context_json`.

## Steps — Integrity
- **I3.1 Declare `abstain_or_review`.** Rule arm in `data/validators.ts` (signals `output_empty`, `tool_returned_empty`, `retrieval_empty`, `confidence_below`, `violations_at_least`, `output_flag`, `integrity_dropped_all`; `notApplicable/needsReview.set`, `reasonsPath`, `route: flag|review`); `guardrailKind += 'abstain_or_review'`; `INTEGRITY_RULE_CHECK_KIND`; `declaration.ts`: last integrity rule, `set` paths vs schema + leaf `safeParse`, signal paths validated. Tests incl. unchanged set hash for existing agents.
- **I3.2 Evaluate after grounding.** `rules/abstainOrReview.ts`; `IntegrityRuleContext.priorChecks`; order: non-abstain rules → re-validate → `checkOutput` → abstain → re-validate; invalid `set` → block `integrity_repair_invalid`; not applicable → `pass` + `outcome`; needs review → `warn` + `holdsAutoApproval` + reason codes; shadow records outcome only; `OutputPipelineResult.reviewRequest`. Tests.
- **I3.3 Auto-approval honours `holdsAutoApproval`.** `resolvePolicyEvidence`: `guardrailsPassed = blocked === 0 && heldWarns === 0` (this run's `warn` rows with `evidence.holdsAutoApproval === true`); remove "honoured once Phase 3" comments. Tests (held warn → review with `'guardrail'`; legacy warns don't hold).
- **I3.4 `agent_orchestrator.run.review_requested`.** Additive event; emitted after `completeRun`/`createProposal` only for `route:'review'`, never in shadow; payload `{agentRunId, agentId, reasons, workflowInstanceId?, tenantId, organizationId}`; `yarn generate`. Test.
- **I4.1 Declare + screen `untrustedInputs`.** `untrustedInputDeclSchema`; `sourceKind += 'input'`; `defineAgent({untrustedInputs})` + registry; integrity set body carries declarations; `resolveIntegritySet` triggers on untrusted-only; `checkInput` adds a `prompt_injection` check for input spans (`warn` default, `block`, `off`); evidence holds pointers only. Tests (never the input text).
- **I4.2 Delimit untrusted fields + fixed instruction.** `lib/guardrails/integrity/untrustedInput.ts`: placeholder envelope + `<untrusted_input name nonce>` blocks, per-run nonce, escape `</untrusted_input`; runner uses it instead of `JSON.stringify`; fixed English instruction appended to the agent's system prompt in `defineAgent` when declared. Tests (stored input unchanged; undeclared agents byte-identical prompt + hash).
- **I5.1 Run API `integrity`, `rawOutputKey`, `ruleId`.** `lib/guardrails/integrity/summary.ts` derives the summary from check rows; success body `integrity` (null when none); 422 additive `ruleId`; `GET /runs/:id` `integrity` + `rawOutputKey`; `GET /guardrail-checks` items `ruleId`; `openApi`; route tests.
- **I5.2 Trace / Caseload / agent-detail UI.** `GuardrailsCard` i18n kind labels, rule id, "holds approval" badge, "Model vs returned output" `CollapsibleSection` fetching `artifact?kind=raw_output`; Caseload hold reason with rule ids from `guardResults`; agent detail "Integrity rules" (additive field on `GET /agents/:id`); i18n ×5; DS tokens.
- **I5.3 `guardrail_check` scorer.** `ScorerRunView.guardrailChecks`; three callers (`evalRuntimeService`, `evalReplayService`, `eval-assertions/preview`) load rows; `registry/agent.ts` `expect: pass|warn|block|not_block|outcome:<v>`; registry 22 → 23 (`eval-registry.test.ts`); i18n.
- **I5.4 Output pipeline in the OpenCode runner.** `runOutputPipeline` when the agent declares `integrity`, else schema-only `checkOutput`; no `attemptedTools` (avoid false tool_scope blocks); `persistVerdict`; block → `failRun` + `AgentGuardrailBlockedError`; final output → `completeRun`/`createProposal({guardResults})`; map captured tool calls to `IntegrityToolCall`. Tests.
- **I5.5 Integration + docs.** `TC-AGENT-INT-005` (`integrity: null` for rule-less agent; `?kind=abstain_or_review` filter org-scoped; `eval-scorers` lists `guardrail_check`; trace page labels); model-dependent cases skip. Spec changelog, `UPGRADE_NOTES.md`, AO `AGENTS.md`.

## Steps — Identity
- **D2.1 Close identity follow-ups.** OAuth routes `POST: { requireAuth: false }`; `verifyAgentToken` adds `tenantId: claims.tenantId`; `resolveAgentPrincipal` tenant filter (+ `enabled`). Route tests (reachable without staff session, still rate-limited). Security-relevant — flag in PR.
- **D2.2 Principal declaration + `syncAgentPrincipals`.** `defineAgent({principal})` + `agentPrincipalDeclarationSchema`; feature ids normalized, unknown dropped with warning, never super-admin; `lib/identity/syncAgentPrincipals.ts`: reuse an existing live principal for (tenant, org, agent), else `provisionExecutionPrincipal({principalKey:`${agentId}@${orgId}`, kind:'agent', namePrefix:'agent', mergeFeatures:false})` + `AgentPrincipal` row; idempotent, re-sync narrows; undeclare disables (never deletes) only declaratively named principals; `principal.registered` on creation only. Tests.
- **D2.3 Sync in setup + CLI; migrate legacy helper.** `seedDefaults` runs the sync best-effort; CLI `principals:sync [--tenant --org]`; `provisionAgentPrincipal` delegates to the core helper with `mergeFeatures:true`. Tests (emails/role names byte-identical).
- **D2.4 Bind `runAs` centrally.** `lib/identity/resolveRunAsForAgent.ts`; `AgentRuntimeService.run()` binds when `ctx.runAs` absent; `onBehalfOf` from the invoker's human; delegated child gets its own principal; `principal.required: true` → `AgentPrincipalMissingError` → `409 agent_principal_missing` (+ tool/workflow/eval mappings); workflow bridge and eval replay become thin callers; fix integrity-set sync (wrap in `withRuntimeAuditWrite`, allowlist `AgentGuardrailSet`). Extend `native-run-under-runas.test.ts`.
- **D2.5 Read-only Access section.** `GET /agents` items `principal: {provisioned, enabled, toolAcl} | null` (managers only); Access card on agent detail; i18n. "Sync principal" button deferred.
- **D3.1 `intersectFeatureGrants` (shared).** In `packages/shared/src/security/features.ts`, wildcard-correct. Tests (exact, `a.*`, `*`, super-admin, empty).
- **D3.2 `resolveEffectiveToolAcl` + mode flag.** `principal.toolAcl` → `OM_AGENT_TOOL_ACL_MODE` → `caller`; `intersect` = principal ∩ caller (super-admin caller collapses to principal grants); no principal → caller or refuse when `principal.required`; eval replay `userId = operator` with principal via `runAs`; env in `.env.example` + `yarn template:sync:fix`. Tests.
- **D3.3 Record principal-denied tools.** Compute allowlisted tools the caller may use but the intersection drops; manifest `om.tool_acl {mode, denied_by_principal}`; trace-page badge; i18n.
- **D4.1 `auditCorrelation` + correlation column (core).** `CommandRuntimeContext.auditCorrelation` merged into `context.correlation` in the command bus; audit_logs `correlation_keys text[]` + GIN, entity property, `deriveActionLogCorrelationKeys` in `projections.ts`, create path, backfill path; migration + snapshot. Tests.
- **D4.2 Stamp correlation on AO + effector writes.** Rebuild the command context after `createRun` with `{agentRunId, parentAgentRunId, workflowInstanceId, correlationId, apiKeyId, grantId}`; dispose paths add `{agentRunId, proposalId}`; core workflows `UPDATE_ENTITY`/`EXECUTE_COMMAND` stamp `{workflowInstanceId, proposalId}` from the workflow context (additive core change). Tests.
- **D4.3 `GET /runs/:id/actions` + Actions card + by-instigator.** `trace.view` + `audit_logs.view_tenant`; `pageSize ≤ 100`; 404 outside org; query `correlation_keys && [agentRunId:…, proposalId:…]`, decrypted via the action-log service; `openApi`; Actions `DataTable` on the trace page; by-instigator items `agentRunId`/`proposalId`; i18n.
- **D4.4 Integration + docs.** `TC-AGENT-ACC-004/005` (`principal` on `GET /agents`; `/actions` 403/404/empty for an ingested run; OAuth route reachable without session); model-dependent cases skip. `UPGRADE_NOTES.md` (attribution change, `create index concurrently` guidance), spec changelog.

## Steps — Eval
- **E3.1 Eval-set file format.** `lib/eval/evalSetFile.ts`: zod schema, unique keys, scorer exists + `parseScorerConfig`, judge assertions cannot be `gate`, deterministic ids, `manifestFromFile`/`fileFromManifest`. Test (export → import same hash).
- **E3.2 YAML support.** `yaml: "2.9.0"` in enterprise deps (`yarn npm audit`); `parseEvalSetText(text, format)` with bounded `maxAliasCount`; serializer. Tests.
- **E3.3 Start runs from a file manifest.** `evalRuns.start` accepts an `evalSet` manifest (size cap); `EvalGateInput.cases`; progress/report fall back to the suite's agent id when no case row; report `source:'file'`. Tests.
- **E3.4 CLI `--cases` + `eval-set export|validate`.** Exit 2 on invalid file; format by extension. Exit-code tests.
- **E3.5 Import/export API + command + badge.** `GET /eval-sets/[version]/export` (`current`, `?format=json|yaml`); `POST /eval-sets/import` with mutation guard → undoable `agent_orchestrator.evalSets.import`; `sourceType: 'file'`; optimistic-lock coverage registration; file-case badge; i18n.
- **E4.1 Tool replay seam (ai-assistant).** `lib/llm-adapters/tool-replay-context.ts` (AsyncLocalStorage); `agent-tools.ts` `runToolCall`: replay → recorded output, skip handler, refuse `isMutation`; record → sink after handler; package export. Tests (strict, ordered, miss, mutation refusal).
- **E4.2 `modelSettings` + eval `callSettings`.** `defineAgent` forwards `modelSettings`; `EvalGateInput.callSettings` + `POST /eval-runs` `callSettings` persisted as `summary.__evalRun`; replay passes them on the run ctx; CLI `--temperature`/`--seed`. Tests.
- **E4.3 Tool fixture record/replay.** `lib/eval/toolFixtures.ts`; `runCase` binds the replay context from CLI options or case `fixtures.tools`; CLI `--record`, `--replay`, `--on-fixture-miss`, `--fixtures-from-run` (`fidelity:'summary'`); miss → `tool_fixture_missing`; files carry `containsTenantData` + CLI warning; OpenCode → `unsupported_runtime`; scripted-model fixtures deferred.
- **E4.4 Report environment block.** `modelSettings` from `__evalRun`; `toolMode` (`live|replay|record|mixed`); seed `honored` (`yes` all llm spans in the run tree recorded the requested seed; `no` mismatch/missing; `unknown` no spans). Golden tests (Markdown, JUnit).
- **E5.1 Rubric library + `rubricRef`.** `lib/eval/rubrics/{builtins,index}.ts` (three built-ins); `resolveRubricRef` agent-first then built-ins; judge config third arm `{rubricRef}`; manifest freezing resolves the ref (edit changes hash); unknown → skipped `unknown_rubric`; `defineAgent.evalRubrics`; `rubrics` on `GET /eval-scorers`; picker field; i18n.
- **E5.2 CI recipe docs.** `apps/docs/docs/framework/ai-assistant/agent-eval-ci.mdx`: exit codes, `--cases` + `--replay`, data-handling warning, nightly live job; note no scripted provider.
- **E5.3 Integration + spec updates.** `TC-AGENT-EVAL-SET-001`: import draft/approved; `current` export round trip incl. YAML; 422 invalid scorer config; undo removes imported cases; `eval-scorers` lists `rubrics`; posted `callSettings` appear in the report environment. Spec changelog.

## Spec items that don't match the code
1. Expression index on `context_json` — encrypted column → projection column.
2. Scripted provider / `withScriptedLlmContext` / `OM_AI_PROVIDER=scripted` don't exist → scripted fixtures and the deterministic CI recipe are deferred.
3. `AgentToolCall.status='denied'` / `tool_features_denied` — denied tools never reach the model → manifest record instead.
4. `executeApprovedProposal` doesn't exist → effector correlation stamped by core workflows.
5. `buildCommandContext` before `createRun` → correlation attached after `createRun`.

## Defaults
- Model-run paths unit-tested with mocked `runAiAgentObject`; integration covers API contracts; model cases skip without a provider.
- Integrity summary derived from check rows; untrusted-input instruction baked into the system prompt at registration; OpenCode guardrails = schema + integrity, no tool_scope; review event only for `route:'review'`, never shadow.
- Principal key `agent:<agentId>@<orgId>`; disable-on-undeclare only for that naming; tool ACL mode default `caller`; principal-denied tools recorded in the manifest.
- Deferred: "Sync principal" button, file-agent frontmatter for `principal`/`integrity`/`untrustedInputs`/rubrics, scripted-model fixtures, per-entry-point traces filter.
- Eval-run settings persisted as `summary.__evalRun`.

## Contract changes / dependencies (flag in the PR)
New prod dependency `yaml` in `@open-mercato/enterprise` (EVAL-Q2); core audit_logs migration + entity column; core workflows executor stamps correlation; shared `CommandRuntimeContext.auditCorrelation`; ai-assistant tool-replay export + tool wrapper hook; new public event `run.review_requested`; OAuth routes become public (rate-limited).

## Risks
Attribution change for agents with principals (opt-in); tools that write under a principal may hit the no-bypass guard; eval replay tool surface moves from principal to operator in `caller` mode; GIN index build may lock `action_logs` on large installs; untrusted-input prompt section changes the definition hash for declaring agents; existing `flag` rules start holding proposals after I3.3; pre-existing `by-instigator` ciphertext labels.
