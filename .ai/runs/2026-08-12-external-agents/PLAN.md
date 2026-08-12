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
| 1.1 | Core: add `suspended` to the agent-bridge outcome union; park-and-return in `handleInvokeAgentJob` | TODO | |
| 1.2 | Core: refuse `suspended` on the inline parallel-branch path with a typed, non-retryable error | TODO | |
| **Phase 2 — external runner, connector seam, ElevenLabs** | | | |
| 2.1 | Data: `AgentExternalRun` entity + validators + migration + snapshot + encryption map | TODO | |
| 2.2 | SDK: `ExternalAgentConnector` registry + `defineExternalAgent` | TODO | |
| 2.3 | Runtime: `ExternalAgentRunner` (start half) + `agentRuntime` dispatch arm for `runtime: 'external'` | TODO | |
| 2.4 | Runtime: `completeExternalRun` (validate → output guardrail → complete run → resume workflow) | TODO | |
| 2.5 | Bridge: `invokeAgentForWorkflow` returns `{ kind: 'suspended' }` | TODO | |
| 2.6 | API: callback route + command (unauthenticated, connector-verified, idempotent, `openApi`) | TODO | |
| 2.7 | Deadline: delayed sweep job → cancel + fail + resume down the `error` route | TODO | |
| 2.8 | Wiring: ACL feature (default-off), `setup.ts`, events, DI, i18n (4 locales) | TODO | |
| 2.9 | Package: `@open-mercato/agent-elevenlabs` — integration provider + voice connector | TODO | |
| 2.10 | Tests: unit + cross-tenant denial + end-to-end suspend/resume | TODO | |
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
