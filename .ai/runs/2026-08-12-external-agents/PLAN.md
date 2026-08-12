# External Agent Invocation — Implementation Tracker

**Branch:** `analysis/external-invoke-agent` · **Worktree:** `.claude/worktrees/external-agent-analysis`
**Design:** [`.ai/specs/enterprise/agent-orchestrator/next/2026-08-12-external-agent-invocation-analysis.md`](../../specs/enterprise/agent-orchestrator/next/2026-08-12-external-agent-invocation-analysis.md)
**Scope:** Phases 1 → 4 (Phase 0 skipped by request — no `CALL_WEBHOOK` proof-of-concept)

## Goal

Make `INVOKE_AGENT` able to call an **external** agent that answers minutes later, with the workflow
step parked and no worker slot held. Ship a real **ElevenLabs Conversational AI** voice connector on
top of that seam.

## Status legend

`TODO` · `WIP` · `DONE` · `BLOCKED`

## Progress

| # | Task | Status | Commit |
|---|---|---|---|
| **Phase 1 — core workflow engine learns "answer later"** | | | |
| 1.1 | Core: add `suspended` to the agent-bridge outcome union; park-and-return in `handleInvokeAgentJob` | DONE | `9ed5a3ad4` |
| 1.2 | Core: refuse `suspended` on the inline parallel-branch path with a typed, non-retryable error | DONE | `70514a5ae` |
| **Phase 2 — external runner, connector seam, ElevenLabs** | | | |
| 2.1 | Data: `AgentExternalRun` entity + validators + migration + snapshot + encryption map | DONE | `a8e8aba9a` |
| 2.2 | SDK: `ExternalAgentConnector` registry + `defineExternalAgent` | DONE | `a99804cf2` |
| 2.3 | Runtime: `ExternalAgentRunner` (start half) + `agentRuntime` dispatch arm for `runtime: 'external'` | DONE | `b1281e472` |
| 2.4 | Runtime: `completeExternalRun` (validate → output guardrail → complete run → resume workflow) | DONE | `5abf31a3f` |
| 2.5 | Bridge: `invokeAgentForWorkflow` returns `{ kind: 'suspended' }` | TODO | |
| 2.6 | API: callback route + command (unauthenticated, connector-verified, idempotent, `openApi`) | TODO | |
| 2.7 | Deadline: delayed sweep job → cancel + fail + resume down the `error` route | TODO | |
| 2.8 | Wiring: ACL feature (default-off), `setup.ts`, events, DI, i18n (4 locales) | TODO | |
| 2.9 | Package: `@open-mercato/agent-elevenlabs` — integration provider + voice connector | TODO | |
| 2.10 | Tests: unit + cross-tenant denial + end-to-end suspend/resume | TODO | |
| 2.11 | **Thread `outputMapping` to the external resume** (added 2026-08-12 — the driving use case needs it) | TODO | |
| **Phase 3 — operability** | | | |
| 3.1 | Artifacts: transcript + recording captured as `AgentRunArtifact`s | TODO | |
| 3.2 | Cost/latency: connector-reported cost + duration on the run row | TODO | |
| 3.3 | Eval + dry run: mock/refuse parity for external connectors; external runs → eval cases | TODO | |
| 3.4 | Cockpit: external-run surfacing on the run detail + agents registry | TODO | |
| **Phase 4 — generalize the seam** | | | |
| 4.1 | Second connector: generic HTTP/webhook connector proving the interface | TODO | |
| 4.2 | Authoring guard: Studio warns when an external agent sits in a parallel branch | TODO | |
| 4.3 | Docs: framework docs page + spec/AGENTS.md updates + dispatch-spec feedback | TODO | |

---

## Task detail

Each task is implemented by one subagent. Every subagent MUST first analyse what actually needs to
change (code + DB) against the live code, then implement, then run the smallest relevant validation
commands. One commit per task.

### Phase 1 — core workflow engine

Core (`packages/core`, OSS) must understand the new outcome **before** enterprise can emit it.
Old-core + new-enterprise is the broken combination; new-core + old-enterprise is fine.

**1.1 — `suspended` outcome arm**
- `workflows/lib/activity-executor.ts` — `AgentWorkflowBridgeLike` outcome union gains
  `{ kind: 'suspended'; runId: string; externalRunId?: string }`.
- `workflows/lib/activity-worker-handler.ts` `handleInvokeAgentJob` — treat `suspended` exactly like
  `user_task`: log, return, leave the step parked on `agent_orchestrator.proposal.ready`.
- No config-schema change, no DB, no migration.
- Tests: a bridge returning `suspended` leaves the instance `PAUSED` and fires no signal.

**1.2 — parallel-branch refusal**
- `workflows/lib/activity-executor.ts` inline branch path (`context.branchInstanceId`) resolves the
  bridge synchronously and cannot park a branch. A `suspended` outcome there must throw a typed,
  **non-retryable** error naming the reason, not hang or resume with empty data.
- Tests: inline branch + `suspended` → throws, and the error is not marked retryable.

### Phase 2 — external runner, connector seam, ElevenLabs

**2.1 — `AgentExternalRun`**
- New table `agent_external_runs`, two-column tenancy, UUID PK `gen_random_uuid()`.
- Columns: `run_id`, `agent_id`, `connector_id`, `callback_token_hash` (unique), `external_run_id`,
  `process_id`, `step_id`, `signal_name`, `status` (`pending|completed|failed|expired|cancelled`),
  `expires_at`, `request_payload`, `result_payload`, `failure_reason`, `created_at`, `updated_at`.
- Editable row ⇒ `updated_at` (optimistic locking).
- `encryption.ts` `defaultEncryptionMaps` entry — a transcript is free text and can carry PII.
- New migration file + regenerate `.snapshot-open-mercato.json`. Never run `db:migrate`.

**2.2 — connector registry + `defineExternalAgent`**
- `lib/runtime/externalConnectorRegistry.ts`: `registerExternalAgentConnector` / `getExternalAgentConnector`.
  Interface: `start()` (must not block), `verifyCallback(headers, rawBody)`, `normalize(raw)`,
  optional `cancel(externalRunId)`, optional `mock` for dry runs.
- `lib/sdk/defineExternalAgent.ts`: registers a normal `AgentRegistryEntry` with `runtime: 'external'`
  plus `connectorId` + `callbackTimeout`, so the agents cockpit, `listAgentOutcomeContracts()` and the
  workflows context ledger all keep working unchanged. Researcher result kind only in this phase.

**2.3 — `ExternalAgentRunner` (start half) + dispatch**
- Reuse the `NativeAgentRunner` front half: `createRun` (`runtime: 'external'`, `externalRunId` =
  provider id), context bundle, **input guardrail**.
- Replace the model call with `connector.start(...)`; persist `AgentExternalRun`; return a suspended
  marker. A connector answering synchronously (`expectsCallback: false`) completes inline.
- `lib/runtime/agentRuntime.ts`: dispatch `entry.runtime === 'external'`; throw a typed error for an
  unknown runtime instead of silently falling through to `NativeAgentRunner` (today's latent trap).

**2.4 — `completeExternalRun` (completion half)**
- Single-shot: validate the normalized payload against the agent's OUTCOME zod → run `checkOutput`
  guardrails → `completeRun` → resume the parked workflow step through the same
  dynamic-import-in-try/catch pattern `lib/disposition/resume.ts` uses to reach core's `sendSignal`.
- Failure arms: schema-invalid, guardrail block, connector-reported failure → fail the run and resume
  down the `error` (or `guardrailBlocked`) handle.

**2.5 — bridge arm**
- `lib/runtime/invokeAgentForWorkflow.ts` maps a suspended runner result to
  `{ kind: 'suspended', runId, externalRunId? }`. Every existing path stays byte-identical.

**2.6 — callback route + command**
- `POST /api/agent_orchestrator/external-runs/[token]/callback`, `metadata = { POST: { requireAuth: false } }`
  (the verified provider signature establishes the scope — never the body), like `/trace/ingest`.
- Route reads the raw body, resolves the row by hashed token, hands verification to the connector,
  normalizes, then runs the completion **through a Command** with the mutation-guard contract.
- Idempotent: a second callback for a completed row returns 200 without re-resuming.
- Exports `openApi`.

**2.7 — deadline sweep**
- On `start()`, enqueue a delayed job at `expires_at` (the queue already supports `delayMs`).
- On fire, if still `pending`: `connector.cancel?.()`, mark `expired`, fail the run, resume the step
  down the `error` handle. A call nobody answers must never park a workflow forever.

**2.8 — wiring**
- `acl.ts`: `agent_orchestrator.external_agents.invoke`, **default off** (the `web_search` precedent).
- `setup.ts` `defaultRoleFeatures` + note that existing tenants need `yarn mercato auth sync-role-acls`.
- `events.ts`: `external_run.started` / `.completed` / `.failed` / `.expired`, `as const`.
- `di.ts` registration; i18n keys in all four locales.

**2.9 — `@open-mercato/agent-elevenlabs`**
Verified against the live ElevenLabs docs (2026-08-12):
- Start: `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call` (SIP sibling:
  `/v1/convai/sip-trunk/outbound-call`), auth header `xi-api-key`.
  Body: `agent_id`, `agent_phone_number_id`, `to_number`,
  `conversation_initiation_client_data.dynamic_variables` (how the brief travels),
  optional `conversation_config_override`, `call_recording_enabled`.
  Response: `{ success, message, conversation_id, callSid }` → `conversation_id` is our `external_run_id`.
- Callback: post-call webhook `type: "post_call_transcription"`, `event_timestamp`, and `data` with
  `agent_id`, `conversation_id`, `status`, `transcript[]`, `metadata`, and
  `analysis.{ transcript_summary, call_successful, data_collection_results, evaluation_criteria_results }`.
  Also `post_call_audio` (base64 mp3) and `call_initiation_failure`.
- Verify: header `ElevenLabs-Signature: t=<unix>,v0=<hex>`; HMAC-SHA256 over the exact string
  `` `${timestamp}.${rawBody}` `` with the webhook secret; hex digest; strip `v0=`; timing-safe compare;
  reject a timestamp older than **1800 s**. Never JSON-parse before verifying.
- Poll/backfill: `GET /v1/convai/conversations/{conversation_id}` (`status`: `initiated`,
  `in-progress`, `processing`, `done`, `failed`); audio via
  `GET /v1/convai/conversations/{conversation_id}/audio`.
- Credentials via the `integrations` module (`secret`-typed API key + webhook secret, plus agent id and
  phone-number id), per-tenant, read with `findOneWithDecryption`. Provider lives in its own workspace
  package — never inside `packages/core/src/modules/`.

**2.11 — thread `outputMapping` to the external resume** *(added 2026-08-12 after T2.4)*

Found by T2.4: an external step currently lands on the LEGACY fixed context keys (`disposition`,
`agentId`, `<stepId>_agent`), because `outputMapping` never reaches the callback.

Why it happens: on the normal parked path the mapping rides the `invoke_agent` QUEUE JOB, and the worker
applies `mapAgentResultToContext` itself after the bridge returns. A suspended run returns before that,
and the resume happens in a different process (the callback) from a correlation row that carries no
mapping.

Why it matters: the driving use case is `outputMapping: { call: 'data.transcript' }` on the voice node —
the whole point of §1's graph is that the next agent reads `{{context.call}}`. Without this the author
falls back to `{{context.<stepId>_agent}}`, which the Studio ledger types as `unknown`.

Work:
- core `workflows`: the bridge ctx (`AgentWorkflowBridgeLike` in BOTH declaring files) gains an optional
  `outputMapping`; `handleInvokeAgentJob` passes `payload.outputMapping` it already holds. Additive.
- enterprise: new `output_mapping` jsonb column on `agent_external_runs` (+ migration + snapshot),
  persisted by the runner, applied by `completeExternalRun` before `sendSignal` using the SAME envelope
  contract `mapAgentResultToContext` implements.
- The envelope for an external researcher answer is `{ kind: 'researcher', data: <outcome> }`, so
  `data.*` paths must resolve exactly as they do for a native researcher agent.
- Tests: an external run with a declared mapping lands the mapped keys; with none, the legacy keys —
  byte-identical to today.

**2.10 — tests**
- Unit: HMAC verify (good/bad/stale), normalize, suspend→callback→resume, single-shot idempotency,
  deadline expiry, schema-invalid payload.
- **Cross-tenant denial on the callback route is mandatory.**

### Phase 3 — operability

**3.1** transcript + recording as `AgentRunArtifact`s (reuse `artifactCollector` / `artifactFileStore`).
**3.2** connector-reported cost + call duration stamped on the run (voice minutes are not LLM tokens;
`null` is acceptable and the UI already renders `—`).
**3.3** dry-run/eval parity: a connector `mock` that names the call it *would* place and never dials;
external runs promotable to eval cases.
**3.4** cockpit: run detail renders the external status, transcript and artifacts; registry shows the
already-existing `external` runtime tag.

### Phase 4 — generalize

**4.1** a generic HTTP connector (`http.generic`) — start via POST, HMAC-verified callback, JSON-path
normalization — proving the interface is not ElevenLabs-shaped.
**4.2** authoring guard: surface "external agent inside a parallel branch" as a Studio Problems-panel
issue, so 1.2's runtime refusal is caught before a run.
**4.3** docs: a framework docs page, `AGENTS.md` updates for both modules, and a changelog entry on
`next/2026-06-19-agent-dispatch.md` recording what the connector seam settles for its runtime-adapter layer.

---

## Notes / decisions log

Append one entry per task as it lands — decisions made, surprises found, deviations from this plan.

- 2026-08-12 — Phase 0 skipped by request. Phase 1 must still ship before Phase 2 for the version-skew
  reason recorded in the design doc.
- 2026-08-12 — External agents are `researcher`-kind only in this pass. An external *proposal* agent
  would let a third party's confidence auto-approve a domain write; deliberately out of scope.
- 2026-08-12 — ElevenLabs API surface verified against the live docs (endpoints, payload shape, HMAC
  rule, 1800 s tolerance) before any code was written.
- 2026-08-12 — **T1.1 done.** The bridge type is declared TWICE — `lib/activity-executor.ts` and
  `lib/activity-worker-handler.ts` each keep their own copy so core never imports the enterprise peer —
  so both needed the new arm. The plan named only the executor; corrected here.
- 2026-08-12 — **T1.1 design point worth keeping.** `AgentResultEnvelope` in `lib/agent-result-mapping.ts`
  deliberately keeps only the four *settled* kinds. That is what makes a missing `suspended` early-return
  a COMPILE error instead of a silent resume with an empty payload. Do not widen it.
- 2026-08-12 — **T1.1 spilled into T1.2's lines.** Widening the union made the executor's inline
  parallel-branch fallthrough a type error, so a plain `throw` was added there as a placeholder. It is
  NOT yet marked non-retryable, so the queue still retries it — T1.2 must replace it with the typed
  non-retryable error and cover it with tests.
- 2026-08-12 — **Worktree hazard: `yarn generate` is destructive here.** In this worktree it deleted 9
  committed files (`docker/opencode/agents/*.md`, `docker/opencode/skills/*/SKILL.md`) and blanked
  `packages/enterprise/.../generated/file-agents.generated.ts`. Restored with `git checkout`. Every task
  that runs `yarn generate` MUST re-check `git status` afterwards and restore unrelated deletions before
  committing. The worktree also needed `yarn install` + `yarn build:packages` before typecheck was
  meaningful.
- 2026-08-12 — **T1.2 done. The real retry hazard was NOT the queue.** The inline branch path never
  reaches the queue worker — it is wrapped by `executeActivity`'s own in-process `retryPolicy` loop. With
  the default `maxAttempts: 3` the placeholder would have called the bridge three times, and since a
  `suspended` outcome means the external run ALREADY STARTED, that is three real phone calls. The fix
  therefore carries TWO structural markers: `retryable = false` (read by `isRetryableError`, closes the
  queue path) and `agentSuspensionUnsupported` (breaks the in-process loop, mirroring the
  `isDryRunRefusal` break one line above). Any future side-effecting refusal needs both.
- 2026-08-12 — **T1.2 decision: the refusal is deliberately ABSORBABLE** by an `error` route,
  `continueOnActivityFailure` and `errorDirective` — unlike `WorkflowDryRunRefusalError`, which is a
  non-absorbable STOP. The maintainer's criterion for that STOP is "nothing was attempted"; here the
  effector genuinely ran, so it is an ordinary activity failure and the author's declared failure
  handling should apply. Accepted tradeoff: `continueWithFallback` can advance a branch while a real
  external run is still live and orphaned — the same property any side-effecting activity already has
  (a `CALL_WEBHOOK` that times out after the remote acted). T4.2's Studio guard is where this gets
  caught before a run.
- 2026-08-12 — T1.2: `isRetryableError` is now exported from `lib/activity-worker-handler.ts` (additive)
  so tests assert the real downstream check instead of reading a raw property.
- 2026-08-12 — **T2.1 done.** `yarn db:generate` cannot SEE enterprise modules by default; it needs
  `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`. With those set it
  reproduced the hand-written migration byte-for-byte (negative-control: table removed from the snapshot,
  regenerated, compared) and then reported `no changes`. It ALSO emits unrelated `wms` drift on every
  run, which must be discarded per the coding-agent exception.
- 2026-08-12 — **T2.1 constraint decision.** `external_run_id` uniqueness is scoped
  `(organization_id, connector_id, external_run_id)`, not global: a provider run id is unique within the
  provider ACCOUNT, so two tenants on their own ElevenLabs workspaces can legitimately mint the same
  `conversation_id` and a global unique would reject the second. Nullable columns give partial-unique
  behaviour for free (Postgres treats NULLs as distinct) — same precedent as `agent_runs_runtime_external_uq`.
- 2026-08-12 — **T2.1 downstream contract for T2.3 / T2.6.** The runner MUST hash the callback token with
  SHA-256 and persist only the LOWERCASE hex digest — `agentExternalRunSchema` rejects anything else,
  uppercase hex included. The callback route hashes what it received and looks the row up by that digest.
  `callback_token_hash` is deliberately NOT encrypted: already one-way, and the lookup must stay SQL-queryable.
- 2026-08-12 — **T2.1 added an invariant the plan did not ask for:** `processId` / `stepId` / `signalName`
  are all-or-nothing in the validator. A row naming a step but no process could never be resumed and would
  park the instance forever — risk R2 by another route. A synchronous connector (`expectsCallback: false`)
  legitimately writes a row with none of the three.
- 2026-08-12 — **T2.2 done. SAFETY FINDING that changes T3.3's scope.** A workflow dry run never reaches
  the bridge — `INVOKE_AGENT` already carries an activity-level `mock`, so it short-circuits earlier. The
  path that actually matters is **`lib/eval/evalReplayService.ts` (~L165), which calls `agentRuntime.run()`
  FOR REAL**. Replaying 50 eval cases against a voice agent would place 50 real phone calls. Hence: a
  connector with no `mock` REFUSES, and the platform never synthesises a would-do on a connector's behalf
  (a fabricated transcript is indistinguishable downstream from something a human actually said, so an
  eval scorer would grade a fiction). T3.3 must verify the eval path is genuinely closed.
- 2026-08-12 — **T2.2 registration split.** A provider registers its CONNECTOR in `di.ts` (runs in every
  process that builds a container — the Next server serving the callback route AND the queue worker) and
  its AGENT in `ai-agents.ts` (needs `ensureAgentsLoaded`). Deliberately independent: the callback route
  needs the connector without needing the agent registry. Consequence: `connectorId` CANNOT be validated
  at registration (no ordering guarantee between the two), so **T2.3 must resolve
  `getExternalAgentConnector(entry.connectorId)` at run time and throw a typed error when missing.**
- 2026-08-12 — T2.2: `parseDuration` from `packages/core/.../workflows/lib/duration.ts` is reused for the
  deadline (a zero-import, side-effect-free leaf; core is a hard dependency of enterprise, and the
  optional-peer rule targets the RUNTIME bridge, not pure helpers). So `timeout: '30m'` uses the same
  grammar workflow authors already type. `callbackTimeoutMs` has no upper bound — T2.7 should consider
  warning on a multi-day deadline.
- 2026-08-12 — T2.2: `entry.schema` must be the ENVELOPE (`z.object({ kind: literal('researcher'), data })`),
  not the inner shape — `resolveAgentOutcomeZod` needs it to project the contract, and an agent passing the
  inner shape would silently vanish from the workflows ledger. Registration warns rather than throws,
  matching `agentOutcomeContract`'s "degrade honestly rather than guess" rule.
- 2026-08-12 — **T2.3 still owes the pre-existing `'external'` trap fix**: `agentRuntime.run()` falls
  through to `NativeAgentRunner` for any runtime that is not `'opencode'`, so an external agent registered
  today would try to run an empty prompt on an LLM.
- 2026-08-12 — **T2.3 done. SPEC CORRECTION (design §5.2 amended in place).** The design said stamp the
  provider's call id into `agent_runs.externalRunId`. Wrong against the live schema:
  `agent_runs_runtime_external_uq` is unique on `(runtime, external_run_id)` with NO tenancy column, so two
  tenants on their own provider workspaces minting the same `conversation_id` would collide. External runs
  therefore stamp `externalRunId = runId` like the native path (which also keeps the trace-ingest
  idempotency key intact); the provider id lives only on `agent_external_runs` under its org-scoped unique.
- 2026-08-12 — **T2.3 admission-gate decision: RELEASE the slot when `start()` returns.** The gate models
  this process's DB pool, the LLM provider and the single OpenCode container — a parked call consumes none
  of them. It also could not be released correctly: it is a process-local semaphore, while the callback
  arrives at whichever replica the provider reached, and a deploy mid-call forgets the count. Holding it
  would let a handful of parked half-hour calls block ALL of that tenant's agent runs, native included —
  the same stall the design rejects when it forbids a polling connector. Accepted cost: nothing bounds
  in-flight external runs; that ceiling belongs to the provider's own limits and to T2.7's sweep.
- 2026-08-12 — T2.3 extracted the shared front half to `lib/runtime/runPreflight.ts` (context assembly +
  input guardrail), used by BOTH runners. Rationale: the external path is the one that ships the brief
  OUTWARD, so a future tightening of the input guardrail landing only in a copied native version would
  leave the outward-facing path screening less than the in-process one.
- 2026-08-12 — **T2.3: the correlation row MUST be written through a Command.**
  `AgentKindNoBypassSubscriber` throws on any flush under `withAgentActor` not nested in
  `withAuditedCommand`, and its docstring names "the token-bearing external case" as its reason. Hence
  `agent_orchestrator.external_runs.create`. Corollary for T2.4/T2.6: the CALLBACK half runs with no
  agent-actor scope (different process, unauthenticated route), so the guard will NOT fire there — those
  writes must route through Commands by discipline, not because anything forces them.
- 2026-08-12 — **T2.5 shape is now fixed:** the bridge must call `agentRuntime.runOrSuspend()`, not
  `run()`. `run()` keeps its settled-`AgentResult` signature and throws the non-retryable
  `AgentRunSuspendedError` on a suspension, so calling it from the bridge would fail the step instead of
  parking it.
- 2026-08-12 — T2.3: callback base URL reuses `APP_URL` / `NEXT_PUBLIC_APP_URL` (no new env var) but
  **refuses in production when unset**, rather than falling back to localhost like core's `buildApiUrl` —
  that fallback is right for a call back into this process and catastrophic for a URL handed to a third
  party. Resolved BEFORE the run row opens, so a misconfigured deployment never dials.
- 2026-08-12 — **T2.3 behaviour change beyond external agents:** an entry whose `runtime` is none of
  `opencode` / `external` / `native` / `in-process` now throws instead of quietly running on the native
  runner. Intended (it is the trap fix) and regression-tested, but it is a real change for any hand-built
  registry entry with a typo'd runtime.
- 2026-08-12 — **Still open after T2.3:** a connector answering synchronously (`expectsCallback: false`)
  is schema-checked but NOT output-guardrail screened; T2.4 must route that arm through the same
  completion function. No connector ships until T2.9, so nothing takes that path yet.
- 2026-08-12 — **T2.4 done. A subtle data-safety trap avoided: `em.nativeUpdate` bypasses the encryption
  subscriber's `beforeUpdate`.** The atomic single-shot claim has to be a native conditional UPDATE, but
  `result_payload` / `failure_reason` are in `defaultEncryptionMaps` — writing a transcript that way would
  persist PII in PLAINTEXT, in green CI. Hence TWO commands: `external_runs.claim` (native, atomic, status
  only) and `external_runs.settle` (managed write, encrypted columns). Anyone adding a native write to an
  encrypted column anywhere in this module hits the same trap.
- 2026-08-12 — T2.4 followed `closeAgentDispositionTask`'s conditional-UPDATE precedent, NOT
  `AgentRunSessionStore.completeOutcome` — the latter is read-then-write through the identity map with a
  race between the two statements, and its single-shot guarantee holds only because the OpenCode store is
  single-process. A webhook redelivery is not.
- 2026-08-12 — **T2.4 arm split (divergence from the native runner, deliberate).** Native collapses
  schema-invalid into the guardrail-block error. Here they are separate: a payload that does not match the
  declared envelope means the connector's `normalize()` is wrong — an integration defect, `error` handle —
  while a block is a well-formed answer refused on content, `guardrailBlocked` handle. Collapsing them
  would route every connector bug to the human escalation path.
- 2026-08-12 — **T2.4: grounding is deliberately SKIPPED for external answers.**
  `resolveCurrentGroundingSet`'s cite-or-abstain check scores claims against the run's citable sources,
  assembled in another process half an hour earlier and not reconstructible in the callback. Running it
  would block every external answer for citing nothing. Screening the transcript as untrusted text is the
  DOWNSTREAM agent's input guardrail (design §7 R5), which already happens.
- 2026-08-12 — T2.4: if `sendSignal` fails after a completed run, the run stays terminal and truthful and
  the instance stays PAUSED — it surfaces in the workflows attention/parked views and is recoverable with
  a manual signal. Not re-failed, not retried (the row is claimed, so a redelivery reports
  `already_settled`). Mirrors core's own `handleInvokeAgentJob` resume-failure intent.
- 2026-08-12 — **T2.7 note from T2.4:** the sweep should claim with `status: 'expired'`; add a third
  `settlement` kind (`{ kind: 'expired'; reason }`) that claims `expired` and otherwise reuses the
  connector-failure arm verbatim.
