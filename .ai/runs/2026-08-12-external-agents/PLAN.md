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
| 2.5 | Bridge: `invokeAgentForWorkflow` returns `{ kind: 'suspended' }` | DONE | `5d0204bc6` |
| 2.6 | API: callback route + command (unauthenticated, connector-verified, idempotent, `openApi`) | DONE | `e3057ada1` |
| 2.7 | Deadline: delayed sweep job → cancel + fail + resume down the `error` route | DONE | `b3618aee1` |
| 2.8 | Wiring: ACL feature (default-off), `setup.ts`, events, DI, i18n (5 locales) | DONE | `17e444185` |
| 2.9 | Package: `@open-mercato/agent-elevenlabs` — integration provider + voice connector | DONE | `a89629580` |
| 2.10 | Tests: unit + cross-tenant denial + end-to-end suspend/resume | DONE | `dfec0fded` |
| — | Follow-up: fix the two policy-test violations 2.10 surfaced in this feature's files | DONE | `77ba223e1` |
| 2.11 | **Thread `outputMapping` to the external resume** (added 2026-08-12 — the driving use case needs it) | DONE | `1c9182ddd` |
| 2.12 | **Static connector-addressed callback route** (added 2026-08-12 — ElevenLabs cannot accept a per-run URL) | DONE | `59f15f105` |
| 2.13 | **Named provider profiles** (added 2026-08-12 — many agents from one provider) | DONE | `c6dbbe966` |
| **Phase 3 — operability** | | | |
| 3.1 | Artifacts: transcript captured as an `AgentRunArtifact` (audio deliberately not stored) | DONE | `4cf4c49cd` |
| 3.2 | Cost/latency: connector-reported cost + duration on the run row | DONE | `43301b37c` |
| 3.3 | Eval + dry run: mock/refuse parity for external connectors; external runs → eval cases | DONE | `c77f6eb01` |
| 3.4 | Cockpit: external-run surfacing + agents registry + **fetch-on-demand audio** + **rerun/Playground UX** | DONE | `ad4dd7a5f` |
| **Phase 4 — generalize the seam** | | | |
| 4.1 | Second connector: generic HTTP/webhook connector proving the interface | DONE | `5e545ff8d` |
| 4.2 | Authoring guard: Studio warns when an external agent sits in a parallel branch | DONE | `897782f18` |
| 4.3 | Docs: framework docs page + spec/AGENTS.md updates + dispatch-spec feedback | DONE | |
| 4.4 | **Server-side out-of-band flag** (added 2026-08-12 — the AI draft agent can still author T4.2's mistake) | DONE | `8b6c83ba6` |

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
- `di.ts` registration; i18n keys in all FIVE locales (`en`, `pl`, `de`, `es`, `ko` — see the
  2026-08-12 correction in the notes log).

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

**2.12 — static, connector-addressed callback route** *(added 2026-08-12 after T2.9 — BLOCKS the end-to-end demo)*

Found by T2.9 and confirmed against the live docs: **ElevenLabs post-call webhooks are configured at the
workspace and agent level, not per conversation.** The verified outbound-call body has no webhook field.
So the per-run single-use URL T2.3 mints and T2.6's `[token]` route resolves can never be delivered to
ElevenLabs — the two halves do not meet, and no real call can resume a workflow today.

The token route stays (it is right for any provider that accepts a per-call URL, and T4.1's generic
connector will use it). Add a SECOND, static entry point beside it:

- `POST /api/agent_orchestrator/external-runs/connectors/[connectorId]/callback` — one stable URL per
  connector, pasted once into the provider's workspace settings.
- Resolve the run by the provider's own id: `connector.extractExternalRunId(rawPayload)` (a new optional
  interface member — a connector that cannot self-address simply does not implement it) against the
  `(organization_id, connector_id, external_run_id)` index T2.1 already built.
- **Tenancy without a token.** That unique is per-org, so the same `conversation_id` could in principle
  exist in two orgs. Resolve ALL candidate rows, then let the SIGNATURE disambiguate: verify against each
  candidate tenant's own webhook secret and accept the one that verifies. Exactly one can, because the
  secret is per-tenant. Zero verifying candidates ⇒ 401 with no detail.
- Everything after resolution reuses `completeExternalRun` unchanged — single-shot claim, guardrails,
  resume. No second settlement path.
- Security note to write down: on this route the HMAC is the ONLY credential (there is no token), which
  is how every ordinary webhook integration works, but it means the per-run secret defence is gone and
  the per-tenant webhook secret carries the whole weight. Rate-limit per connector + per resolved org.
- Tests: two orgs holding the same `conversation_id` → only the correctly-signed one settles (the
  mandatory cross-tenant case for this route); unknown conversation id → 404, no detail; a payload the
  connector cannot self-address → 400.

**2.13 — named provider profiles** *(added 2026-08-12 — raised by the user after seeing the credential form)*

Today the ElevenLabs integration holds ONE `Agent ID` + `Phone Number ID` pair, so a tenant running several
voice agents (owner call, satisfaction survey, payment chase) must type the ElevenLabs agent id into each
workflow node's `input.agentId`. That works — the credential fields are defaults, not limits — but it puts
per-tenant configuration inside workflow definitions, where it cannot be rotated centrally.

Work:
- Credential shape becomes a LIST of named profiles (`{ name, agentId, phoneNumberId, telephonyProvider?,
  defaultCallerId?, callRecordingEnabled? }`), with the existing single pair migrated into a `default`
  profile so no configured tenant breaks.
- `defineExternalAgent` gains an optional `profile` naming which one it uses; `start()` resolves
  profile → per-call override → tenant default, in that precedence.
- An agent naming a profile the tenant has not configured fails CLOSED with a clear message, before dialling.
- The per-call `input.agentId` override stays — it is the escape hatch and is already tested.
- Keep the single static callback URL: it is per-CONNECTOR, so profiles never multiply webhook setup.
- Tests: profile resolution + precedence, the `default` migration path, and the fail-closed unknown-profile arm.

**2.10 — tests**
- Unit: HMAC verify (good/bad/stale), normalize, suspend→callback→resume, single-shot idempotency,
  deadline expiry, schema-invalid payload.
- **Cross-tenant denial on the callback route is mandatory.**

### Phase 3 — operability

**3.1** transcript + recording as `AgentRunArtifact`s (reuse `artifactCollector` / `artifactFileStore`).
**3.4 addition — fetch-on-demand audio** *(handed over by T3.1)*

T3.1 deliberately stores no audio (reasoning in the notes log). The operator affordance is a
**fetch-on-demand** path: a new optional `ExternalAgentConnector` member (T3.1 suggests
`extractArtifacts` / a `fetchRecording`), an ElevenLabs implementation over
`GET /v1/convai/conversations/{id}/audio`, and a run-detail control that streams it through WITHOUT
persisting bytes. Keeps operator access while leaving the provider as the single controller of the
recording.

The same connector member also closes T3.1's **audio-arrives-first** hazard: today, if `post_call_audio`
is delivered before `post_call_transcription`, `normalize()` throws, the run settles `failed` down the
`error` handle, and the real transcript arriving seconds later is discarded by the spent claim.

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

**4.4 — server-side out-of-band flag** *(added 2026-08-12 after T4.2)*

T4.2's guard is BROWSER-ONLY, by necessity: the agents REST endpoint already carries `runtime` per item, but
the only SERVER-side seam from core to the peer is `listAgentOutcomeContracts()`, which projects
`agentId` / `resultKind` / `schema` and no runtime. So `evaluateWorkflowDefinition` — used by the definitions
API, the `validate_workflow_definition` AI tool, and the in-Studio prompt-to-draft agent — cannot run the
check. **Consequence: the AI draft agent can still author the mistake, and only a human opening the Studio
sees it.**

Work: one ADDITIVE field on `AgentOutcomeContractSnapshot` (`suspends: boolean`, better than `runtime` —
it names the property that matters rather than the implementation), cached beside `agentOutcomeContracts`
in `lib/server-output-contract.ts`, and consumed by `evaluateWorkflowDefinition` so the server path raises
the same warning. Must stay optional on the interface so an older bridge implementation is still valid, and
must degrade to silence when absent — exactly as `listAgentOutcomeContracts` already does.

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
- 2026-08-12 — **T2.5 done. The end-to-end park/resume chain is now verified link by link**, not assumed:
  bridge `ctx.processId`/`ctx.stepId` → `AgentRunCtx` → `ExternalAgentRunner` writes the triple
  all-or-nothing → `EXTERNAL_RUN_RESUME_SIGNAL` is byte-identical to core's `INVOKE_AGENT_SIGNAL_NAME`
  (`'agent_orchestrator.proposal.ready'`), which is the signal the step actually parks on. The suspended
  arm also matches core's two duck-typed declarations field for field — nothing type-checks across that
  boundary, so a field-name drift would fail silently at runtime.
- 2026-08-12 — T2.5: `externalRunId` is spread conditionally, so the returned object never carries an
  explicit `undefined` across the duck-typed boundary. Asymmetry worth knowing: the enterprise runner
  declares it REQUIRED while the bridge and core declare it optional — assignable in that direction, so
  correct, just not symmetric.
- 2026-08-12 — T2.5: `run-as-propagation.test.ts` changed only to retarget its `agentRuntime` fake from
  `run` to `runOrSuspend`; assertions untouched. Not scope creep — a forced consequence of the switch.
- 2026-08-12 — **Housekeeping fact:** ~35 PRE-EXISTING type errors live in other `agent_orchestrator`
  test files, which is why the package `typecheck` excludes `**/__tests__/**`. Every task here typechecks
  its own test files through a temporary config instead; T2.3 and T2.5 both found real bugs that way.
- 2026-08-12 — **T2.6 done. Mutation guards are deliberately NOT wired on the callback route** — reported,
  not skipped. `trace/ingest` (the module's only other unauthenticated write) does not wire them either,
  and no route in `agent_orchestrator` calls `runMutationGuards`. With no user, `userFeatures` is `[]` so
  every feature-gated guard filters out, and `userId` would have to be fabricated. Worse, it would be
  ACTIVELY HARMFUL: guards read `input.requestHeaders`, which here are entirely third-party-supplied, and
  `customers`' `optimisticLockGuard` targets `'*'` — a provider's stray header could 409 a correctly signed
  settlement and park the workflow until the deadline sweep, turning a human-concurrency mechanism into a
  machine-path availability bug. The write path still runs through Commands, so interceptors, audit and
  column encryption all apply.
- 2026-08-12 — T2.6: rate-limit + bounded-body helpers live in `@open-mercato/shared`
  (`lib/ratelimit/helpers`, `lib/webhooks`), NOT in the webhooks module — `shipping_carriers`' provider
  webhook is the precedent. So reuse cost no cross-module dependency, and riding the webhooks module's
  `WebhookEndpointAdapter` (the design's open question) would have been the real coupling. Two buckets:
  per-IP and per-TOKEN-DIGEST (per-run granularity, so no run's budget is exhausted by traffic aimed at
  another). A null client IP SKIPS the IP bucket rather than sharing an `'unknown'` bucket, which would
  let one attacker lock out every legitimate provider.
- 2026-08-12 — T2.6: `hashCallbackToken` / `buildExternalRunCallbackPath` moved to a zero-dependency leaf
  `lib/runtime/callbackToken.ts` (re-exported from the runner for BC) so the PUBLIC route does not pull
  the whole start path — runPreflight, the TDCR bundle resolver, the input guardrail — into its module graph.
- 2026-08-12 — **T2.6 verification worth imitating: behavioural negative controls.** Deliberately breaking
  the route two ways proved the tests actually bind — deriving scope from request headers instead of the
  row failed 3 tests; passing `JSON.stringify(JSON.parse(rawBody))` to `verifyCallback` failed 7. Both
  reverted. The second is the single easiest way to silently break every signature check.
- 2026-08-12 — T2.6 decisions beyond the brief, both tested: a `normalize()` that THROWS settles as a
  connector failure with **200** (the payload is deterministic, so redelivery cannot help — wake the step
  down `error` now rather than parking for the full deadline); a MISSING connector returns **503** with the
  row untouched and still `pending`, so a redelivery after the deploy is fixed settles normally.
- 2026-08-12 — T2.6 new env var for T2.8/T4.3 to document:
  `OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES` (default 8 MiB — sized for ElevenLabs' base64-mp3
  `post_call_audio`, ~3.2 MB for a ten-minute call).
- 2026-08-12 — **T2.9 contract:** the route hands `verifyCallback` the exact received bytes (asserted
  byte-identical and cross-checked with an HMAC over those bytes), so ElevenLabs' `${timestamp}.${rawBody}`
  canonical string works as specified. The 1800 s replay window is the CONNECTOR's to enforce — the route
  does no timestamp check of its own, since only the provider's package knows its header format.
- 2026-08-12 — **T2.7 done. BOTH scheduling arms ship, because their failure modes do not overlap.** A
  delayed job is precise but is lost if the queue backend drops it (Redis eviction, wiped `.mercato/queue`,
  a strategy change) and cannot cover rows written before it existed. A periodic per-org tick is
  self-healing but depends on `@open-mercato/scheduler`, an OPTIONAL peer `setup.ts` no-ops without — a
  High-severity "must never happen" cannot rest on an optional package. Delayed-only also leaves a real
  hole: `connector.start()` has already dialled by the time the enqueue runs, so an enqueue failure must be
  swallowed, and without a second mechanism that run parks forever. Running both costs nothing: the
  settlement is single-shot in SQL, so a double fire is a no-op, and one queue with two payload shapes
  (the `task-run-executor` precedent) adds no concurrency lane.
- 2026-08-12 — **T2.7 race analysis: the CLAIM is the guarantee, the SELECT is only an optimisation.**
  Under READ COMMITTED two concurrent updates of one row serialise on the row lock and the loser
  re-evaluates its `status = 'pending'` predicate against the committed result (EvalPlanQual) — a mutex,
  not last-write-wins. The sweep introduces NO new decision point: it settles through the same
  `completeExternalRun` a redelivered webhook does. All six interleavings traced; the only one the status
  filter cannot cover (callback claims mid-sweep) is caught by the claim returning `claimed: false`.
- 2026-08-12 — **T2.7 product behaviour worth naming in the docs (T4.3): late answers are DROPPED.** When
  the sweep wins, a genuine correctly-signed callback arriving afterwards gets 200 and its transcript is
  NOT persisted — recording it would contradict the row's `expired` status, and the workflow has already
  branched down `error`.
- 2026-08-12 — T2.7: `connector.cancel` runs LAST, inside its own try/catch, and only for the claim winner.
  Cancelling first could hang up on a call whose answer already arrived; and the likeliest reason we are
  expiring is that the provider is unreachable, so its `cancel` is the call most likely to hang — it must
  never delay the resume. Three no-op arms log differently on purpose: no `cancel` implemented → info,
  no provider id → warn, **`cancel` threw → error** (a call may still be live, still billing, now unattributed).
- 2026-08-12 — T2.7: `callbackTimeoutMs` WARNS above 24 h rather than being capped — a cap would fail runs
  an author deliberately configured, and the runner is the wrong place to overrule the registry. 24 h is
  where the guarantee genuinely weakens (the delayed job would have to survive days and deploys, so the run
  leans entirely on the periodic sweep).
- 2026-08-12 — **T2.7 found a PRE-EXISTING defect, not ours to fix here:** all four existing workers in this
  module (`metric-rollup`, `task-run-executor`, `llm-judge`, `eval-suite-runner`) declare `metadata.queue`
  from an IMPORTED constant, but the generator's `buildVariableInitializerMap` walks only same-file
  `VariableDeclaration` nodes — so those four already emit `unresolved-static-contract` diagnostics. The new
  sweep worker uses a string literal per the documented rule. Follow-up for T4.3 or the harness.
- 2026-08-12 — **T2.7 touched `setup.ts`, which T2.8 owns** (per-org 60 s sweep schedule alongside the metric
  rollup). T2.8 keeps the schedule and adds ACL/events/i18n around it. The shared catch message is now
  plural; existing tenants need `seedDefaults` re-run to pick the schedule up. `external_run.expired` is NOT
  yet emitted — `expireExternalRun` in `lib/runtime/externalRunSweep.ts` is the emit point.
- 2026-08-12 — T2.7 tunables for T2.8/T4.3 to document: 60 s sweep interval,
  `EXTERNAL_RUN_EXPIRY_GRACE_MS` (5 s), `SWEEP_BATCH_LIMIT` (100 rows/tick/org), 24 h deadline warning.
- 2026-08-12 — **T2.8 done. The ACL gate IS genuinely enforceable** — the open question is answered. Core's
  `executeInvokeAgent` refuses to run a step without a traceable human (instance `initiatedBy`, else the
  definition author, no anonymous fallback), and that user id rides the queue job → bridge `ctx.userId` →
  `AgentRunCtx`, so `resolveCallerAcl` (which fails closed to `{ features: [], isSuperAdmin: false }`)
  gives the runner the caller's real grants. The gate runs in `ExternalAgentRunner.run()` before the run
  row opens and long before the connector dials. Core sets the same precedent for `UPDATE_ENTITY`.
- 2026-08-12 — T2.8: "default-off" is expressed in `setup.ts`, NOT `acl.ts` — `web_search`/`web_fetch`
  carry no flag; they are declared and then deliberately OMITTED from every persona list, reachable only
  via the `agent_orchestrator.*` wildcard. `external_agents.invoke` follows that literally, with a named
  block in `setup.ts` explaining why adding it to a persona would defeat the point.
- 2026-08-12 — **T2.8 security decision: all four `external_run.*` events are `clientBroadcast: false`.**
  The DOM event bridge forwards to every backoffice connection in the tenant + org WITHOUT evaluating ACL
  features (the documented reason task events stay off it), so a live org-wide feed of who is being phoned
  would undo the default-off gate. Payloads are built key by key from the exported
  `EXTERNAL_RUN_EVENT_PAYLOAD_KEYS`: ids and a classified cause only — never transcript, phone number or
  token. Turning broadcast on later must be a deliberate decision against that argument, not a default.
- 2026-08-12 — T2.8 deviation from T2.7's handover: `external_run.expired` is emitted from
  `completeExternalRun`'s settle path, NOT `expireExternalRun` — that side of the conditional claim is the
  only place all four facts are exactly-once, so a sweep that loses the race announces nothing.
- 2026-08-12 — T2.8: no i18n keys and no DI entry were added, deliberately. ACL feature titles are rendered
  RAW by `AclEditor.tsx` (features are not translated anywhere in the platform) and event labels are
  metadata, not UI copy; the one new error message is `[internal]`-prefixed. The external path resolves
  only already-registered services. Cockpit copy is T3.4's.
- 2026-08-12 — **T2.8 behaviour change T2.9's demo will hit first:** every external run now requires the
  grant, so on a tenant that has not granted it an `INVOKE_AGENT` step naming an external agent fails down
  the `error` handle instead of dialling. The demo tenant must run
  `yarn mercato auth sync-role-acls` and hold `agent_orchestrator.external_agents.invoke` (or be superadmin).
- 2026-08-12 — **T2.8 open governance question:** a DENIED invocation leaves no `AgentRun` row (matching
  the "nothing was attempted" precedent), so a WARN log line is a tenant's only record of an attempted
  outbound contact. If governance wants a durable audit trail of refusals, that needs a row, not a log —
  real follow-up, not in scope here.
- 2026-08-12 — **T2.9 done. THE GAP THAT BLOCKS THE END-TO-END DEMO (→ new task 2.12).** ElevenLabs
  post-call webhooks are a WORKSPACE/AGENT setting, not a per-call parameter — confirmed against the live
  docs — and the verified outbound-call body has no webhook field. So the per-run single-use URL T2.3 mints
  and T2.6's `[token]` route resolves **cannot be delivered to ElevenLabs**, and no real call can resume a
  workflow yet. The connector sends it as a reserved `om_callback_url` dynamic variable (inert, echoed back
  for correlation) but that does not make ElevenLabs post there. Fix is T2.12: a static per-connector route
  resolving the run by `conversation_id`, with the signature disambiguating tenancy.
- 2026-08-12 — **T2.9: `cancel` is genuinely NOT supported by the API and is deliberately omitted.** There
  is no hang-up/abort endpoint for a live conversation; the nearest thing (deleting the conversation record)
  would destroy the transcript and audit trail WITHOUT ending the call, leaving it connected, billing and
  unattributed. T2.7 already handles a connector without one — an honest "we stopped waiting" beats a false
  "we hung up". `mock` is omitted too, so dry runs and eval replays REFUSE rather than dial (T3.3's scope).
- 2026-08-12 — **T2.9 found a real leak the tests were written to catch:** ElevenLabs' `success: false`
  `message` was interpolated verbatim into a thrown error, and a provider error body can echo the API key
  back — into a string that gets PERSISTED on the run and rendered in the cockpit. Fixed with
  `redactSecrets`. Anything that interpolates a provider response into an error needs the same treatment.
- 2026-08-12 — **T2.9 seam gap worth fixing upstream before T4.1 re-solves it differently:**
  `ExternalAgentConnector` carries no container/EM on `start`, `verifyCallback` or `normalize`, so a
  connector cannot reach the tenant's credentials. Closing over the registration-time container is WRONG
  (it is a per-request container holding a forked `em` from a finished request → intermittent stale reads
  through a dead identity map), so the connector builds one on demand per credential read. The smallest
  honest fix is an additive optional `container`/`resolve` on `ExternalAgentConnectorStartArgs` and on
  `verifyCallback`'s third argument — both call sites already hold one.
- 2026-08-12 — T2.9 registry drift caught: a new workspace package is picked up automatically by the
  workspaces glob, `build:packages`, `typecheck` and `test`, but THREE hand-maintained lists would have
  silently drifted — the three `COPY packages/<x>/package.json` lines in `Dockerfile`, the alphabetical
  list in `.github/workflows/package-previews.yml`, and `scripts/check-version-alignment.sh` (version must
  equal `packages/shared`). First two updated; third satisfied by matching the version.
- 2026-08-12 — T2.9: `apps/mercato/src/modules.ts` was deliberately NOT touched — it is in
  `template-sync`'s `SYNC_ROOT_FILES`, so editing it drags in the create-app template mirror. To enable:
  push `{ id: 'agent_elevenlabs', from: '@open-mercato/agent-elevenlabs' }` inside the
  `enterpriseModulesEnabled && enterpriseAgentsEnabled` block, mirror into the template, and add the
  package to `scripts/template-sync.ts`. The integration also ships DISABLED by default from the env
  preset — dialling is never enabled just by deploying.
- 2026-08-12 — **T2.12 done. The end-to-end blocker is closed.** One STATIC url per connector, pasted into
  the provider's workspace settings, resolving the run by the provider's own id via the new optional
  `extractExternalRunId`. Tenancy without a token: all candidate rows for `(connector, external_run_id)` are
  fetched and each is verified against ITS OWN tenant's webhook secret — at most one can verify, because the
  secret is per-tenant, so the SIGNATURE is the disambiguator.
- 2026-08-12 — **T2.12 amplification bound.** ElevenLabs' `verifyCallback` builds a container and DECRYPTS
  the tenant credential before computing the HMAC, so verifying is not cheap. An attacker picks the id but
  CANNOT create rows, so the candidate set is bounded by genuine collisions; capped at 10 in SQL anyway so
  per-request work is fixed. Ten rather than one because truncating a real collision would leave a tenant's
  callback unresolvable until the sweep — nine spare HMACs is the cheaper failure. Hitting the cap logs ERROR.
- 2026-08-12 — **T2.12: this route is deliberately WEAKER than the `[token]` one, and says so in code.** Two
  proofs become one; a conversation id is guessable and visible in provider dashboards, so a leaked webhook
  secret lets an attacker settle any of THAT tenant's pending runs (only that tenant's). It also must PARSE
  BEFORE VERIFYING, which the token route refuses to do — bounded by the body cap, `JSON.parse` only, feeding
  a length-capped lookup key, and the raw string is never rebuilt from it. Unknown connector answers 404
  (not the token route's 503) so the route is not a probe for which packages a deployment runs.
- 2026-08-12 — T2.12 rate-limit buckets to document with T2.6's:
  `:external-connector-callback:ip` (60/min), `:connector` (600/min, deployment-wide), `:org` (60/min,
  charged only AFTER a signature verifies).
- 2026-08-12 — **T2.11 done. The driving use case now works end to end.** `outputMapping` travels bridge ctx
  → `AgentRunCtx` → `agent_external_runs.output_mapping`, and the callback applies it.
- 2026-08-12 — **T2.11 imported core's `mapAgentResultToContext` rather than reimplementing it**, extending
  T2.2's `parseDuration` precedent to a DYNAMIC import inside `completeExternalRun` (so the unauthenticated
  route does not require `workflows` at import time). It is not merely the same algorithm — it IS the contract
  the Studio's variable picker types `data.*` against, so a second implementation drifting would produce an
  `undefined` in a live process, invisible to both packages' typecheckers.
- 2026-08-12 — **T2.11 payoff confirmed: the Studio ledger ALREADY typed external `data.*` paths.**
  `resolveInvokeAgentOutputContract` builds the envelope from `listAgentOutcomeContracts()`, and
  `defineExternalAgent` registers a normal researcher entry — so the picker was already right and only the
  ENGINE was ignoring the mapping. That is the payoff for building the connector seam on top of the existing
  agent registry instead of beside it.
- 2026-08-12 — **T2.11 design rule to keep for T4.1:** the mapping is read from the ROW at resume time, not
  projected by callers. That is why T2.12's brand-new static route honours author mappings with ZERO changes
  on its side; the projection-widening alternative would have shipped a route that silently dropped them.
- 2026-08-12 — T2.11 semantics matched to core, not to the plan's phrasing: a DECLARED mapping that resolves
  nothing yields `{}`, NOT the legacy keys (core does `mappedPayload ?? legacy`, and the mapper returns null
  only for an absent/empty mapping) — falling back would make the two paths disagree about one definition.
  The mapping applies to the RESEARCHER arm only; letting it rewrite a failure payload would drop `__error`
  and leave the run branching on nothing.
- 2026-08-12 — T2.11: `output_mapping` is deliberately NOT encrypted — it holds Studio-authored context key
  names and dot-paths that `workflow_definitions.definition` already stores in plaintext. Encrypting a copy
  of public configuration buys nothing, adds a decrypt hop on the resume path, and adds one more column to
  T2.4's native-write plaintext trap. Guarded by an assertion.
- 2026-08-12 — **T4.2 done — and NOTHING had to be widened.** The agents REST endpoint already serves
  `runtime` per item and core's own `AgentSelector` already declares it, so the descriptor reaching the
  browser already carried what the check needs. The branch-region walk mirrors the ENGINE's `openFork`
  (seed from the fork's `auto` transitions, stop at the join, exclude non-normal routes) so the warning and
  the runtime agree by construction.
- 2026-08-12 — **T4.2 gap → new task 4.4.** The guard is BROWSER-ONLY: `listAgentOutcomeContracts()` is the
  only server-side seam to the peer and carries no runtime, so `evaluateWorkflowDefinition` (definitions API,
  the `validate_workflow_definition` AI tool, and the in-Studio draft agent) cannot run it. The AI draft
  agent can therefore still author the mistake.
- 2026-08-12 — **T2.13 done. The credential STORE is not the constraint — the ADMIN WRITE PATH is.**
  `integration_credentials.credentials` is jsonb typed `Record<string, unknown>` and would hold a nested
  list happily, but the operator path is flat-scalar-only twice over: `CredentialFieldType` has no
  list/group/json member, and `saveCredentialsSchema` types every credential VALUE as
  `string | number | boolean | null` — so an array through `PUT /api/integrations/[id]/credentials` is a 422
  whatever a package declares. `channel-gmail` DOES persist a real `string[]` into that jsonb, but via a
  server-side `credentialsService.save()` from its OAuth callback, never through the form. So the precedent
  is "structured value written server-side", not "structured value edited by an operator".
- 2026-08-12 — T2.13 shape: profiles ride ONE `text` credential holding a JSON document, parsed in-package
  (the parser also accepts an already-structured value, matching the gmail precedent). Per-profile schema is
  `.strict()` so a typo'd key is a named error, not a silently defaulted phone number. A `text` field is NOT
  masked on read-back, so no secret may ever go in it — documented in the field help.
- 2026-08-12 — **T2.13 migration guarantee: an already-configured tenant does NOTHING.** All five flat
  fields are read as the `default` profile and the shipped agent names `default`, so the next call is
  byte-identical (two tests assert it), and `configure-from-env` with the original four env vars produces a
  byte-identical credential record. `agentId`/`agentPhoneNumberId` became optional in the FORM so a
  profiles-only tenant can save; a tenant clearing both now fails at dial time with a clear message rather
  than at save time.
- 2026-08-12 — T2.13 fixed a PRE-EXISTING log defect on a line it touched: the placed-call log spread the
  credential descriptor over `agentId: args.agentEntry.id`, so it reported the ELEVENLABS agent under the key
  the platform reads as its own. Now `profileAgentId`/`profilePhoneNumberId` plus `dialledAgentId`/
  `dialledPhoneNumberId` (which differ under a per-call override).
- 2026-08-12 — **Temp-config gotcha, supersedes T2.12's note:** ~200 phantom `Cannot find name 'describe'`
  errors in a scoped test typecheck were a STALE `tsconfig.t213.tsbuildinfo`, not a types-resolution problem.
  `typeRoots` + `types: ["node","jest"]` works fine under TS 7.0.2 and T2.12's `/// <reference>` shim is
  unnecessary. The ENTERPRISE scoped config additionally needs `files: [...]` + an empty `exclude`, because
  its `**/__tests__/**` exclude beats `include`.
- 2026-08-12 — T2.13 deliberately did NOT add a per-call `input.profile` override (the spec had three
  precedence levels and it kept three). Natural follow-up: it would let a definition name a rotatable profile
  per NODE rather than per agent.
- 2026-08-12 — **Platform follow-up raised by T2.13, benefits every provider:** a `json` (or `textarea`)
  `CredentialFieldType` in `integrations` would remove the JSON-in-a-single-line-input awkwardness that
  forced the shape above.
- 2026-08-12 — **T3.1 done. Best-effort artifact capture is LOAD-BEARING here, not merely defensive.** By
  the time it runs the external run is already TERMINAL, so a propagating error could not fail it honestly —
  it would 500 the public callback route, the provider would redeliver, and the redelivery would hit the
  spent single-shot claim and report `already_settled` **without resuming the parked step**. A failed
  transcript upload would therefore have stranded a live workflow until the deadline sweep.
- 2026-08-12 — **T3.1 decision: audio is NOT stored, and the reason is controllership, not size.**
  Encryption was never the gap (artifact bytes ride the tenant DEK). The gap is erasure: a transcript is text
  about a person, a recording is the person's VOICE — biometric-grade — and copying it makes us a SECOND
  controller, doubling the DSAR/erasure surface (DB row + S3 object) for content **no downstream consumer
  reads** (the workflow branches on `data.collected.*`, the eval scorer reads the transcript, nothing reads
  audio). Size sharpens it: ~4.5 MB per ten-minute call, ~1.6 TB/year at 1,000 calls/day, and **there is no
  retention or purge sweeper for `AgentRunArtifact` anywhere in this module** — so it would be permanent by
  default. ElevenLabs already retains it behind `GET /v1/convai/conversations/{id}/audio`, so fetch-on-demand
  (folded into T3.4) preserves operator access with zero bytes stored.
- 2026-08-12 — **Governance follow-up inherited, not created, by T3.1:** `AgentRunArtifact` has no retention
  or erasure sweeper. That was already true for file-agent artifacts; the transcript now inherits it.
- 2026-08-12 — **T3.1 open hazard (needs the T3.4 connector member): audio-arrives-first.** If
  `post_call_audio` is delivered BEFORE `post_call_transcription`, `normalize()` throws, the run settles
  `failed` down the `error` handle, and the real transcript arriving seconds later is discarded by the spent
  claim. Today's behaviour is at least safe and pinned by tests (no re-settle, no second resume, idempotent
  under redelivery).
- 2026-08-12 — **T3.3 done — and it CORRECTS the T2.2 entry above.** That entry said a connector with no
  `mock` "refuses". **It did not.** `connector.mock` was declared on the interface and READ BY NOTHING (a
  repo-wide grep for `connector.mock` / `.mock?.()` returned zero product hits), and
  `ExternalAgentRunner.run` called `connector.start(...)` unconditionally without ever consulting
  `ctx.source`. An eval replay against ElevenLabs WOULD HAVE DIALLED; the run then returned `suspended`,
  `run()` threw, and the eval case recorded `error` *after the phone had already rung*. Omitting `mock`
  bought nothing. The guarantee now lives in the RUNNER, where a connector author cannot undo it.
- 2026-08-12 — T3.3: a supplied `mock`'s payload is nested under `wouldDo`, never spread, so even a mock
  returning `{ reached: true, transcript }` cannot read as an outcome. Simulated runs get `simulated://`
  placeholders instead of a real minted bearer, write no correlation row and no deadline job, and skip
  output-schema validation of a would-do.
- 2026-08-12 — **T3.3 full caller audit of `agentRuntime.run`/`runOrSuspend`** — every one of these can reach
  an external agent: `evalReplayService` (the hole, now closed), the Playground route, **`api/runs/[id]/rerun`
  (a re-run of a voice run places a SECOND real call — still open, see below)**, `workers/task-run-executor`,
  `delegate_agent` (correctly inherits `source`), and the workflow bridge (the intended path).
- 2026-08-12 — **T3.3 Playground decision: deliberately left dialling.** It is an explicit human action
  behind both `agents.run` and the default-off `external_agents.invoke` grant, and it is the only way to
  smoke-test a connector end to end; guarding it would push operators to test by triggering real workflows
  instead. It also will NOT silently simulate when a `mock` exists — a Playground that quietly faked its
  answer is worse than one that dials. Open UX gap for T3.4: the route rethrows `AgentRunSuspendedError` as
  an HTTP 500 while a real call is in flight; it wants a 202-with-runId arm.
- 2026-08-12 — **T3.3: the DRY-RUN guarantee rests entirely on CORE**, not on anything in enterprise.
  `activity-executor` short-circuits at the one place `entry.execute` is reached and `INVOKE_AGENT` declares
  `mock: buildInvokeAgentWouldDo`, so a dry run never reaches the bridge or the runner. A dry run that DID
  arrive at the runner would carry `source: 'runtime'` and dial.
- 2026-08-12 — T3.3: the "external runs → eval cases" half of this task needed NO code —
  `evalCases.createFromRun` is runtime-agnostic (reads `run.input`/`run.output` only). It also corrected a
  STALE comment in `evalReplayService` claiming nested delegations do not inherit `source`; they do, and that
  inheritance is now load-bearing for the guard.
- 2026-08-13 — **T3.2 done. `metadata.cost` is CREDITS, not money — never stamp it.** ElevenLabs reports
  BOTH `metadata.cost_fiat` (double, documented "total fiat cost … in USD") and `metadata.cost` (integer
  credits, no stated unit). The provider's own example pairs a 22-second call with `cost: 296`, so stamping
  that as cents would report $2.96 for a roughly five-cent call. T2.9's fixture carried `cost`, which is
  exactly how a plausible wrong number gets normalised into the KPI rollups.
- 2026-08-13 — **T3.2 latency decision: the column carries the PROVIDER-REPORTED CALL DURATION, not the
  wall clock.** (a) It is the only number comparable to what the column already holds — a native run's
  latency is `endedAt − modelStart`, deliberately excluding queue wait, the admission gate and context
  assembly; call duration is that same quantity for a remote effector, wall clock is that plus everything
  the native measurement excluded. (b) Under wall clock, `metricRollupService`'s p50/p95 and the `latency`
  eval scorer (default 30 s) would measure how promptly the people we phone PICK UP — a property of the
  contact list no change to the agent can improve. (c) Duration and `cost_minor` stay arithmetically
  consistent on one row for per-minute billing. **The wall clock needs no column:**
  `completed_at − created_at` IS the park duration, because the run row opens before `connector.start()`
  dials and `completed_at` is written once at the terminal transition.
- 2026-08-13 — T3.2 provider-agnostic seam (reuse this in T4.1's connector): a connector may return ONE
  reserved platform-owned sibling to `kind`/`data` — `usage: { costMinor, currency, durationMs }` in
  PLATFORM units (integer minor units, ISO-4217, ms). The connector converts, because only it knows which
  of its numbers is money. `completeExternalRun` STRIPS the key before the agent's schema sees the payload,
  so a `.strict()` envelope still validates and `outputMapping` / the transcript artifact / the guardrail
  see exactly what they saw before. No route changes; works on both callback routes, the sweep and the
  synchronous arm.
- 2026-08-13 — **T3.2 defect found: zod rejects `NaN`.** Without `.catch(null)` on the metering fields, a
  provider-side metering glitch would make the WHOLE `post_call_transcription` unparseable — the run would
  settle as a connector failure and a real conversation would be discarded over a number nothing branches
  on. Metering can now never cost us the transcript.
- 2026-08-13 — **T3.2 structural trap: the usage stamp is split across TWO files.** `persistence.ts`
  declares `RunUsageStamp`, but `commands/runs.ts` (`runUsageStampSchema` + `applyUsageStamp`) is what
  writes columns — a field added to only the first is silently stripped by the command's zod and the column
  is never written. Also: the stamp is applied INSIDE the audited command that closes the run, so a value
  rejected by that schema would throw after the claim — 500ing the callback and stranding the parked step
  (T3.1's finding). Hence the reader screens every value against exactly that schema first, so a bad
  provider report can only degrade to "no stamp".
- 2026-08-13 — T3.2: `failRun` is stamped too — a call that connected, cost money and was THEN
  guardrail-blocked still charged the tenant.
- 2026-08-13 — **T3.4 addition from T3.2:** nothing surfaces the wall clock in the cockpit yet. It is
  derivable as `completed_at − created_at`, and a "parked for 28m, talked for 74s" pair on the external-run
  detail would read very well.
- 2026-08-13 — **T4.1 done. The per-run `[token]` route WORKED FIRST TIME.** It is the route the design
  treats as primary, and until now no shipped connector exercised it end to end (ElevenLabs was forced onto
  the static route). A real end-to-end test — start → provider handed `callbackUrl` → token extracted from
  the body the provider actually received → signed POST → 200 → `completeExternalRun` — passed on the first
  execution. No rot, no unexercised bug in T2.6.
- 2026-08-13 — **T4.1 closed T2.9's container seam, and it was WIDER than T2.9 predicted.** Adding
  `container` to start args was not enough: **`normalize(rawPayload)` took no scope and was SYNCHRONOUS**,
  so a connector whose MAPPING is per tenant was structurally impossible — exactly what a generic connector
  needs. `normalize` now takes an optional context and may return a promise; both routes `await` it.
  Fewer-param / plain-value implementations stay assignable, so ElevenLabs compiles and passes UNTOUCHED
  (131/131). **BC:** this is an ADDITIVE change to a public type — record it in `BACKWARD_COMPATIBILITY.md`
  terms in T4.3.
- 2026-08-13 — **T4.1's deepest finding: the callback half of the seam is addressed by TENANT, never by
  AGENT.** A callback resolves a RUN; the agent is known only to the correlation row. So verification and
  normalization config can only ever be per `(tenant, connector)` — which is why the generic connector FAILS
  CLOSED on `defineExternalAgent({ profile })` instead of half-honouring it. Anything that wants per-agent
  callback behaviour has to travel on the correlation row, not on the connector.
- 2026-08-13 — T4.1 connector-member choices, each justified: it OMITS `extractExternalRunId` (that member
  is the opt-in to the weaker connector-addressed route, where the signature is the only credential), it
  IMPLEMENTS `mock` (a "would POST" is falsifiable; ElevenLabs omits it because a fabricated transcript is
  not), and it omits `cancel` (declared per CONNECTOR, so a configurable cancel URL would silently no-op for
  unconfigured tenants and make the sweep log "cancelled" for a run still executing).
- 2026-08-13 — **T4.1 SSRF stance: the node input carries NO url/header field, deliberately.** A workflow
  definition is authored material AND AI-draftable, so a per-call target would make this an aimable SSRF
  gadget carrying tenant credentials. The configured URL rides the same shared outbound guard `CALL_WEBHOOK`
  uses. New env var for T4.3 to document: `OM_AGENT_HTTP_ALLOW_PRIVATE_URLS` (dev only, ignored in
  production, mirrors the `CALL_WEBHOOK` precedent).
- 2026-08-13 — T4.1 residual asymmetry: `cancel(externalRunId, scope)` still receives no container. The
  sweep is its only caller and neither shipped connector implements `cancel`; close it the same way if one
  ever needs credentials to cancel.
- 2026-08-13 — **T4.4 done. `suspends`, not `runtime` — and the real reason is the MODULE BOUNDARY**, not
  (only) that it names the property that matters. A `runtime: string` flag would force CORE to hold a list of
  enterprise's runtime names and relearn it whenever the peer adds one — exactly the coupling the duck-typed
  optional-peer bridge exists to prevent. With `suspends` the peer classifies its own runtimes and core asks
  one question it can answer for itself.
- 2026-08-13 — T4.4: `evaluateWorkflowDefinition` has FIVE call sites, all now covered — the prompt-to-draft
  route, `validate_definition`, `validate_workflow_definition` (the in-Studio draft agent's own
  self-correction loop), `create_definition` and `update_definition`. Note the plan's "definitions API" was
  imprecise: `api/definitions/route.ts` and `[id]/route.ts` never call it (they use
  `normalizeDefinitionValidationIssues` directly), so nothing there changed.
- 2026-08-13 — T4.4 structural constraint that decided the design: `lib/definition-evaluation.ts` is imported
  by a CLIENT component, so it must not import `server-output-contract.ts` (which pulls the activity-registry
  bootstrap and endpoint catalog into the browser bundle). Hence an explicit `outOfBandAgentIds` option
  threaded by server callers rather than an implicit module read — and hence the two extra core files.
- 2026-08-13 — T4.4 cache honesty: `ensureWorkflowAgentOutcomeContracts` memoises per-process and is never
  invalidated. That is CORRECT here because the agent registry is CODE, not tenant state, so it cannot change
  while a process runs. A long-lived process predating a deploy that adds an external agent stays SILENT,
  never wrong — a false positive is impossible, since an id in the set was `runtime: 'external'` at boot.
- 2026-08-13 — **T4.4 open follow-up (T4.3 docs / a later task): ONE fact, TWO sources.** The browser derives
  out-of-band-ness from `runtime === 'external'` on the agents REST endpoint; the server now uses `suspends`.
  Harmless today (`external` is the only suspending runtime) and the anti-drift test pins the shared detection
  path, but a FUTURE suspending runtime would make the server warn while the browser stays silent. Collapse
  them by serving `suspends` from `api/agents/route.ts` and reading it in `useOutOfBandAgents.ts`.
- 2026-08-13 — **BC lines for T4.3:** `AgentOutcomeContractSnapshot.suspends` (T4.4) and the `normalize`
  context/async widening (T4.1) are both ADDITIVE optional changes to public types.
- 2026-08-13 — **T3.4 done. `fetchRecording` returns a STREAM, not bytes — and that is the design, not a
  detail.** T3.1's promise is that the platform holds no copy of a caller's voice. A member returning a
  materialised `Buffer` would make that promise depend on every future caller remembering not to persist it;
  with a stream, "no copy exists" is a property of the TYPE, and it is testable — the test asserts the route
  never takes a reader. `null` = nothing to play (404), a throw = integration fault (502), OMITTING the
  member = this provider has no recording concept, so no unusable control is ever rendered.
- 2026-08-13 — **T3.4 rerun gate: 428, deliberately NOT 409.** 409 is this codebase's optimistic-lock status
  and the client conflict helpers key off it, so reusing it would surface a "record changed" bar for
  something that is not a concurrency problem. The gate reads the SOURCE RUN's `runtime` column rather than
  the registry, so it stays truthful for an agent whose package was since undeployed, and it runs BEFORE the
  mutation guard so nothing has happened when it refuses. Native reruns are byte-identical.
- 2026-08-13 — T3.4: the Playground and a confirmed rerun both answer **202** with the run id. This is the
  other half of T3.3's decision to let the Playground dial — if it dials, it must say the call was ACCEPTED,
  not finished. Because 202 is 2xx it reaches the page's success path, so the suspended check runs BEFORE the
  result arm; otherwise it renders as a blank success while a phone is ringing.
- 2026-08-13 — T3.4: the park needed its OWN formatter. The shared `formatDurationMs` renders a half-hour as
  `1680.0s`, and widening it would have re-rendered the span timeline and duration tile for every native run.
  The pair is always shown together — latency alone makes a 28-minute park look like a 74ms-scale event;
  wall clock alone makes every agent look slow because someone took 20 minutes to answer.
- 2026-08-13 — **T3.4 correction to an assumption in this plan:** `fetchRecording` does NOT close T3.1's
  audio-arrives-first hazard. Now that audio is fetch-on-demand, a `post_call_audio` webhook body carries
  nothing we want at all; closing it needs a SECOND, different member — one letting a connector say "this
  payload is not a settlement" so the route can 200 without spending the single-shot claim. Reasoning is
  recorded in `agent-elevenlabs/.../lib/normalize.ts`.
- 2026-08-13 — T3.4 open follow-ups: (a) the recording route has **no rate limit** — each click is a live
  provider call, and the callback routes' `lib/ratelimit/helpers` precedent drops in cleanly; (b)
  `fetchRecording` is gated on `trace.view`, deliberately NOT `external_agents.invoke` — reading a call that
  happened is a lesser act than placing one, and reusing the dial grant would force review-only operators to
  hold it.
- 2026-08-13 — **T4.3 BC lines, now three:** `AgentOutcomeContractSnapshot.suspends` (T4.4), the `normalize`
  context/async widening (T4.1), and `ExternalAgentConnector.fetchRecording` + `ExternalAgentConnectorRecording`
  (T3.4) — all additive optional changes to public types. Plus new routes `GET /runs/:id/external` and
  `GET /runs/:id/recording`, and the behaviour change that `POST /agents/:id/run` and `POST /runs/:id/rerun`
  can now answer **202**, with rerun answering **428** unless an external call is confirmed.
- 2026-08-13 — **T2.10 done: 10 integration specs, all passing against a live app + DB.** The flagship
  (`TC-AGENT-EXT-001`) proves the whole feature at the HTTP boundary — park → signed callback → resume with
  the author's `outputMapping` keys in context. Also: redelivery advancing EXACTLY once (asserted on row
  state, not just the 200), both cross-tenant cases, the sweep dropping a late answer, the ACL gate proven
  by `start()` never running, the new read routes, and rerun's 428/202 arms.
- 2026-08-13 — **T2.10 ENVIRONMENT FINDING that undermines how earlier tasks verified routes:**
  `packages/enterprise/dist` was STALE, so every `agent_orchestrator` route 500'd with module-not-found
  until `yarn build:packages`. The dev server resolves `@open-mercato/enterprise` to `dist` — so any task
  that added an API route and ran only unit tests never saw its route actually served. Applies to T2.6,
  T2.12 and T3.4. Run `build:packages` before believing a route works.
- 2026-08-13 — **T2.10 found a whole suite that did not COMPILE:** `packages/shared/.../command-bus.test.ts`
  had a missing brace, so 8 tests silently never ran — including this branch's own `runAs` on-behalf-of
  audit tests. Pre-existing; fixed in `dfec0fded`.
- 2026-08-13 — **Two policy tests were RED because of this feature's own files; fixed in `77ba223e1`.**
  (1) Four bare `.sort()` calls — the repo forbids them because UTF-16 coercion is only accidentally correct
  and mis-orders on type drift. (2) `externalAgentRunner.ts` hand-rolled `isSuperAdmin` + `hasAllFeatures`
  from the LOW-LEVEL matcher; it now routes through `authorizeFeatures`, which owns the full ordering
  (scope → removed/disabled → unrestricted → wildcard-aware match). Two ordering differences, both strictly
  TIGHTENING and both the sanctioned policy: a super-admin no longer passes when the feature is nulled by an
  ACL override or the module is not enabled. Fail-closed behaviour unchanged.
- 2026-08-13 — T2.10: the probe module lives at `apps/mercato/src/modules/agent_probe/`, gated behind
  `OM_INTEGRATION_TEST` inside the enterprise-agents block, following the `ratelimit_probe` precedent.
  **Two open caveats:** root `AGENTS.md` forbids code under `apps/mercato/src/` outside generated
  registries, and `modules.ts` is template-synced — the create-app mirror needs the same lines or
  template-sync flags drift. Alternative if that is unacceptable: move the probe into `packages/enterprise`
  behind the same flag; the specs move unchanged.
- 2026-08-13 — T2.10 seam notes for T4.3 docs: a connector instance is process-global and sticky (`di.ts`
  guards on `getExternalAgentConnector`), so editing connector code needs a server RESTART, not HMR. And
  `drainIntegrationQueue` without `OM_TEST_APP_ROOT` runs app code in the TEST process with the test's cwd.
- 2026-08-13 — **Still open, NOT ours:** `optimistic-lock-command-coverage.test.ts` names a route deleted by
  `f78e533c5` ("task becomes process") and reds `@open-mercato/core`. Pre-existing on this branch.
- 2026-08-12 — **CORRECTION to this plan: the repo has FIVE locales, not four.** `i18n/ko.json` exists and
  `yarn i18n:check-sync` fails without it (it holds English placeholders throughout, so an English string is
  the correct fill). Every "4 locales" instruction in this file is wrong; **fixed by T4.3** (task row
  2.8 and the Phase 2 detail now say five and name them).
- 2026-08-12 — T4.2 scope limit, deliberate: step activities only. An INVOKE_AGENT hand-authored onto a
  TRANSITION also runs with the branch token, but its subject is a route, and naming the route's source step
  would be wrong for a fork's own branch-opening transitions.
- 2026-08-12 — **Recurring test hazard in this module:** a PARTIAL `jest.mock('../lib/runtime/persistence')`
  silently turns a NEW export into `undefined`, which surfaced as `resume: 'failed'` in three unrelated
  suites. Any task adding an export to a widely-mocked module must top up those mocks.
- 2026-08-13 — **T4.3 done. Two docs pages, not one:**
  `apps/docs/docs/framework/ai-assistant/external-agents.mdx` (developer: governance framing,
  `defineExternalAgent`, the connector contract, both callback routes and why the static one is
  weaker, the workflow author's view, operations, every env var and tunable, an honest limitations
  list) and `elevenlabs-voice.mdx` (operator: credentials, named profiles, where to paste the static
  callback URL, the `{{om_callback_url}}` prohibition, and that the integration ships disabled). Both
  registered in `apps/docs/sidebars.ts` under the AI Assistant category; `yarn workspace
  open-mercato-docs build` passes with no new broken links or anchors.
- 2026-08-13 — **T4.3 found the T2.9 note "modules.ts was deliberately NOT touched" is now STALE.**
  `dfec0fded` (T2.10) added the `agent_elevenlabs` push inside the enterprise-agents block, plus the
  `OM_INTEGRATION_TEST`-gated `agent_probe` push. The docs say so. `@open-mercato/agent-http` is
  still NOT wired into `apps/mercato/src/modules.ts` — documented as a one-line opt-in. Also worth
  recording: `scripts/template-sync.ts` lists `modules.ts` in `SYNC_ROOT_FILES`, but the create-app
  template has no `src/modules.ts`, so the existence filter skips it and nothing drifted.
- 2026-08-13 — **T4.3 budget note: the root `AGENTS.md` had FOUR bytes of headroom.** Adding a
  dedicated Task Router row (~170 B) was impossible, so the existing agent-orchestration row was
  extended instead ("file-defined OpenCode/external agents" + the docs page), paid for with 71 bytes
  of purely cosmetic normalization — `-   ` / `1.  ` list markers collapsed to one space, and the
  Key Commands comment column tightened by one. Net root size is UNCHANGED at 31228/31232. No rule,
  reference or section was removed. **The next task that needs root-file space cannot do this again**;
  it has to move long-form procedure into `.ai/docs/*` (the optimistic-locking bullet and the
  Documentation-and-Specifications subsection are the two obvious candidates).
