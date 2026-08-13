# Analysis — Extending `INVOKE_AGENT` to External Agents

> **Status:** Analysis / design proposal · **Created:** 2026-08-12 · **Scope:** `packages/core/src/modules/workflows` + `packages/enterprise/src/modules/agent_orchestrator`
> **Driving case:** an inbound-signal → triage → **outbound voice call (ElevenLabs)** → action-planning → notify-humans process.
> **Related:** `next/2026-06-19-agent-dispatch.md` (NOT STARTED roadmap overlay), `next/gap-analysis/gap-15-dispatch-adapters-a2a.md`, `2026-07-07-lightweight-agent-runtime.md`

## TLDR

`INVOKE_AGENT` already has almost everything an external agent needs: it parks the workflow instance on a signal, runs the agent on its own queue/connection outside the workflow transaction, and resumes on an out-of-band event. The `user_task` branch — worker returns, step stays parked, a *later* actor fires `agent_orchestrator.proposal.ready` — is exactly the shape a 6-minute phone call needs.

**Three things are missing, and only one of them is hard:**

1. `AgentRuntime` already contains `'external'` (in the type union, both API enums, the cockpit filter and the i18n labels) but **`agentRuntime.run()` has no dispatch arm for it** — it silently falls through to `NativeAgentRunner`, which would try to run a nonexistent prompt on an LLM. Today `runtime: 'external'` is a label with no runner behind it.
2. There is no way to *suspend* an agent run. Every runner returns a settled `AgentResult`; the bridge always answers `researcher | auto_approved | user_task | none_proposed`. An agent that will answer in ten minutes has no vocabulary.
3. There is no connector seam (start the external run, verify its callback, normalize its payload) and no per-tenant place to keep the provider's credentials and agent id.

The recommended change is **one new outcome kind on the bridge (`suspended`), one new runner (`ExternalAgentRunner`), one connector registry, and one callback route** — plus provider packages. **The `INVOKE_AGENT` node config, the workflow schema, the five outcome handles and the output mapping envelope need no change at all**: to a workflow author an external agent is just another `agentId` in the picker.

---

## 1. The business case, as a graph

```
event trigger (customers.deal.updated · inbox_ops email ingested · attachment added)
        │
   [INVOKE_AGENT]  alerts.triage            native · researcher
        │          outputMapping { alert: "data" }
        ▼
   condition  {{context.alert.severity}} == "critical"
        │
   [INVOKE_AGENT]  voice.owner_call         EXTERNAL (ElevenLabs) · researcher
        │          input: { phone, brief: "{{context.alert.summary}}" }
        │          outputMapping { call: "data" }        ← run SUSPENDS here,
        │                                                  step stays parked,
        │                                                  worker slot released
        ▼          ← post-call webhook resumes the step
   [INVOKE_AGENT]  alerts.action_planner    native · proposal
        │          input: { alert: "{{context.alert}}", call: "{{context.call}}" }
        │          onResult: { autoApproveThreshold: 0.85, autoApproveMargin: 0.1 }
        │          review: { assignedToRoles: ["ops_lead"], deadline: … }
        ├─ approved ──▶ effector runs the proposed commands (tasks, emails, stage moves)
        ├─ rejected ──▶ [SEND_EMAIL] escalate
        └─ error / guardrailBlocked ──▶ [USER_TASK] triage
```

Everything above the voice node runs on the platform today. Everything below it runs on the platform today. The voice node is the whole delta.

Note where the value sits: the voice agent is a **researcher** — it talks to a human and comes back with facts (`reached`, `transcript`, `collectedFields`, `ownerDecision`). It does not propose actions. The *next* agent proposes, and the platform's existing proposal → disposition → effector path executes. That keeps propose-only intact without arguing about it.

---

## 2. What exists today (verified)

### 2.1 The `INVOKE_AGENT` chain

| Step | Where | Fact |
|---|---|---|
| Config | `workflows/data/activity-config-schemas.ts:153` | `invokeAgentConfigSchema` = `agentId` · `input` · `onResult` · `outputMapping?` · `subject?` · `review?` |
| Execute | `workflows/lib/activity-executor.ts:1398` `executeInvokeAgent` | Resolves the traceable principal, **enqueues** a `WorkflowActivityJobInvokeAgent` onto the dedicated `workflow-invoke-agent` queue and returns `__park: { signalName: 'agent_orchestrator.proposal.ready' }` |
| Park | `lib/step-handler.ts` | Instance goes `PAUSED` on that signal |
| Run | `workers/workflow-invoke-agent.worker.ts` → `lib/activity-worker-handler.ts:362` `handleInvokeAgentJob` | Awaits `agentWorkflowBridge.invokeAgentForWorkflow(...)` on its own connection |
| Resume | same handler, `lib/signal-handler.ts` | `researcher` / `auto_approved` / `none_proposed` → `sendSignal` merges the mapped payload **top-level into `instance.context`**; **`user_task` → returns and leaves the step parked** |
| Route | `lib/outcome-routing.ts` | Engine-owned `__agentOutcome` marker → the five fixed handles `approved · researcher · rejected · guardrailBlocked · error` |
| Type | `lib/agent-result-mapping.ts` | Envelope `{ kind, disposition, agentId, proposalId, proposalPayload, data }`; ledger types it from `listAgentOutcomeContracts()` |

The parallel-branch case (`context.branchInstanceId`) still runs the bridge inline — documented as a deliberate fallback in `activity-executor.ts`. **An external agent must not be authored inside a parallel branch** until that path also parks (see §7, Risk R4).

### 2.2 The bridge contract

`agent_orchestrator/lib/runtime/invokeAgentForWorkflow.ts:53`:

```ts
export type InvokeAgentForWorkflowOutcome =
  | { kind: 'researcher';    data: unknown }
  | { kind: 'auto_approved'; proposalId: string; payload: unknown }
  | { kind: 'user_task';     proposalId: string }
  | { kind: 'none_proposed'; proposalId: string; payload: unknown }
```

Core resolves it duck-typed via `tryResolve('agentWorkflowBridge')` and never imports the enterprise module. That is the extension point.

### 2.3 Runtime dispatch — the gap

`agent_orchestrator/lib/runtime/agentRuntime.ts:63`:

```ts
if (entry.runtime === 'opencode') { …OpenCodeAgentRunner… }
const runner = new NativeAgentRunner({ … })          // ← EVERYTHING else, including 'external'
```

while `lib/sdk/defineAgent.ts:27` declares `AgentRuntime = 'in-process' | 'native' | 'opencode' | 'external'`, and `'external'` is already accepted by `api/agents/route.ts:27`, `api/agents/[id]/route.ts:46`, `backend/agents/page.tsx:42`, `components/types.ts:576` and the four locale files. **This is a latent trap worth fixing regardless of this feature**: registering an external agent today produces a confusing LLM failure instead of a clear "no runner for this runtime".

### 2.4 The cross-process precedent already exists

`OpenCodeAgentRunner` runs the agent in a *different OS process* and correlates via `AgentRunSession` (`lib/runtime/agentRunSessionStore.ts`) — an opaque per-run session token, a single-shot `completeOutcome()` (`completed | not_found | already_completed`), and a poll loop. `AgentRun` already carries `runtime` + `externalRunId` with a unique index (`agent_runs_runtime_external_uq`) so external runs upsert cleanly, and `/api/agent_orchestrator/trace/ingest` already accepts HMAC-signed traces from external runtime adapters with no user session.

The one thing OpenCode does that an external agent must **not** do is hold the worker slot: `DEFAULT_RUN_TIMEOUT_MS = 5 * 60_000` with an SSE-idle + poll loop. A phone call is not a 5-minute LLM call — it is an appointment.

### 2.5 The registry is process-global, not tenant-scoped

Agents come from `defineAgent()` (code) or `registerFileAgent()` (generated manifest); `listAgentEntries()` returns one global map. There is **no DB-backed agent registry**. Per-tenant variability (which ElevenLabs agent id, which API key, which phone number) therefore has to live somewhere else — the `integrations` module credential store, exactly as every other external provider does.

---

## 3. The governance question, answered up front

> An agent that phones a human **has a side effect**. Does that break propose-only?

No — but only under one framing, and it is worth stating explicitly because it is the first objection a reviewer will raise.

`agent_orchestrator/AGENTS.md` rule 1 forbids **agent-chosen** effects: the model must not decide to act. It does not forbid **author-chosen** effects. `SEND_EMAIL` and `CALL_WEBHOOK` are workflow activities with real external side effects, and they are legitimate because a human placed that node on the canvas and wired what reaches it.

An external voice agent is the same class of thing: the *workflow author* decided that a critical alert triggers a call; the *model* only decides what to say inside a call it did not choose to make. The propose-only invariant is preserved by three rules, which should be normative for this feature:

1. **External agents are `resultKind: 'researcher'` only.** They report; they never carry a proposal envelope, and therefore never reach `dispositionService` or the effector. (An external *proposal* agent is a possible Phase 3, but it means trusting a third party's confidence score to auto-approve a domain write — do not ship it in Phase 1.)
2. **Outbound contact is a dedicated, default-off ACL feature**, following the explicit precedent set for web egress in `AGENTS.md` rule 10 (`agent_orchestrator.web_search`), not a reuse of `agents.run`.
3. **The returned transcript is untrusted input.** It is a third party's free text about what a human said, so it goes through the *same* input-guardrail path (`checkInput` / prompt-injection screening) that document and retrieval spans already go through before it can reach the planning agent's prompt.

---

## 4. Options

### Option 0 — No platform change: `CALL_WEBHOOK` + `WAIT_FOR_SIGNAL` (available today)

Author three nodes instead of one: `CALL_WEBHOOK` kicks off the ElevenLabs call, `WAIT_FOR_SIGNAL` parks, and an inbound webhook adapter (`webhooks` module, `registerWebhookEndpointAdapter()`) verifies the provider signature and posts to `POST /api/workflows/instances/[id]/signal`.

- **Cost:** zero platform code. This is the right way to *prove the business case this week*.
- **What you give up:** no `AgentRun` row, so nothing in the cockpit, no trace, no cost/latency KPI, no eval case, no guardrails on the transcript, no caseload/process projection, no `subject` binding, no ledger typing of the result. The signal payload lands as untyped context keys. And every workflow that wants a call re-implements the wiring.

That list is precisely the value `INVOKE_AGENT` adds — which is the argument for Option 2.

### Option 1 — Blocking external runner

Add `ExternalAgentRunner` that starts the call and *polls* to completion inside `handleInvokeAgentJob`, like `OpenCodeAgentRunner` does.

- **Cost:** smallest real change; no new suspend vocabulary.
- **Why not:** it pins a `workflow-invoke-agent` worker slot for the entire call. Ten concurrent alerts at the default concurrency stall the queue, and any deploy/restart mid-call loses the run with no way to recover it (the provider will still call back, into nothing). Acceptable only for sub-60s connectors.

### Option 2 — Suspend/resume external runner ✅ **recommended**

Add a **fifth bridge outcome, `suspended`**. The runner starts the external run, persists the correlation, and returns immediately; the worker treats `suspended` exactly as it already treats `user_task` (return, leave the step parked); the provider's callback completes the `AgentRun` and fires the same `agent_orchestrator.proposal.ready` signal that the human-dispose path already fires.

- **Cost:** ~6 files touched, ~4 new, 1 new table, 1 new route, plus a provider package.
- **Why:** it reuses the park/resume machinery that already exists and is already exercised by the `user_task` path in production. It scales to hours, survives restarts, and gives external agents the full cockpit/trace/eval overlay for free.

### Option 3 — Implement `next/2026-06-19-agent-dispatch.md` (`AgentTask` + `AgentBinding` + leases + A2A)

The roadmap spec already designs the general fleet: capability routing, DB-backed bindings, authoritative leases, a sweeper, pull workers, A2A push/server, OM as an A2A mesh node.

- **Why not now:** it is 7 phases, four new tables, and it hard-depends on the identity spec's net-new OAuth client-credentials server before its Phase 4. It answers "any agent on any runtime, discovered dynamically". The voice case needs "one known provider, called from a node".
- **Why it still matters:** Option 2 must not contradict it. §5.6 shows how the connector registry becomes the `a2a`/provider runtime-adapter layer that spec calls for, so Option 2 is a down-payment on Option 3 rather than a detour.

---

## 5. Recommended design (Option 2)

### 5.1 The bridge contract gains one arm

```ts
export type InvokeAgentForWorkflowOutcome =
  | { kind: 'researcher';    data: unknown }
  | { kind: 'auto_approved'; proposalId: string; payload: unknown }
  | { kind: 'user_task';     proposalId: string }
  | { kind: 'none_proposed'; proposalId: string; payload: unknown }
  | { kind: 'suspended';     runId: string; externalRunId?: string }   // ← NEW
```

**Ordering is a hard constraint.** Core must learn to handle `suspended` **before** any bridge can emit it. `handleInvokeAgentJob` currently narrows `outcome.kind === 'user_task'` and treats *everything else* as resumable — an unknown kind would resume the step down the `researcher` handle with an empty payload. Ship the core arm first, release it, then ship the enterprise emitter. (Old core + new enterprise is the broken combination; new core + old enterprise is fine.)

### 5.2 `ExternalAgentRunner` — what it must reuse, not reinvent

`NativeAgentRunner.run` is the template for the overlays. The external runner keeps the front half verbatim and replaces the model call:

| Phase | Native | External |
|---|---|---|
| Open run | `createRun(...)` with `runtime: 'native'`, `externalRunId: runId` | same, `runtime: 'external'`, `externalRunId: runId` — **corrected 2026-08-12, see below** |
| Context bundle | `agentContextResolver.assemble` → `AgentContextBundle` | unchanged |
| **Input guardrail** | `checkInput({ capability, untrustedSpans })` | unchanged — screens what we are about to send outward |
| Execute | `runAiAgentObject(...)` | `connector.start(...)` → returns `{ externalRunId, expectsCallback: true }` → **run stays `running`, runner returns `{ suspended: true, runId }`** |
| Output guardrail | `checkOutput(...)` against the OUTCOME schema | **runs in the callback**, not here |
| Complete | `completeRun(...)` | **runs in the callback** |

> **Correction (2026-08-12, found during implementation).** This table originally said the external run
> should stamp the *provider's* call id into `agent_runs.externalRunId`. That is wrong against the live
> schema: `agent_runs_runtime_external_uq` is unique on `(runtime, external_run_id)` with **no tenancy
> column**. A provider run id is unique per provider *account*, not globally, so two tenants on their own
> ElevenLabs workspaces can mint the same `conversation_id` and the second tenant's run would be rejected
> by a constraint that has nothing to do with it — the same collision `agent_external_runs` avoids by
> scoping its unique to `(organization_id, connector_id, external_run_id)`. The provider id therefore
> lives on the correlation row only, and `agent_runs` keeps the collision-free uuid we minted (which also
> preserves the trace-ingest idempotency key the native path relies on). Either the table or the
> constraint had to change; changing the table is the smaller, safer move.

The callback path is a second, short function in the same module: validate the normalized payload against the agent's OUTCOME zod, run `checkOutput`, `completeRun`, then resume the workflow. It resumes through the **same dynamic-import-in-try/catch** pattern `lib/disposition/resume.ts` already uses to reach core's `sendSignal`, so `workflows` stays an optional peer in both directions.

### 5.3 Connector registry (the new seam)

```ts
export interface ExternalAgentConnector {
  id: string                                     // 'elevenlabs.voice'
  /** Kick off the external run. MUST NOT block on completion. */
  start(args: {
    agentEntry: AgentRegistryEntry
    input: unknown
    callbackUrl: string
    callbackToken: string                        // opaque, single-shot
    scope: { tenantId: string; organizationId: string }
  }): Promise<{ externalRunId: string; expectsCallback: true }
           | { externalRunId: string; expectsCallback: false; result: unknown }>
  /** Verify the provider's callback signature. Verification lives HERE, never in the route. */
  verifyCallback(headers: Headers, rawBody: string): boolean
  /** Provider payload → the agent's declared OUTCOME shape. */
  normalize(rawPayload: unknown): unknown
  /** Optional: cancel/hang up when the step is cancelled or the deadline passes. */
  cancel?(externalRunId: string): Promise<void>
}
```

This mirrors `registerWebhookEndpointAdapter()` (`webhooks/lib/adapter-registry.ts`) deliberately — same shape, same "verify in the adapter, not the route" rule, so the two are learnable as one pattern.

> **Correction (2026-08-13, as shipped).** The sketch above is missing what a connector needs to
> reach *tenant* state, and the gap was wider than expected: `normalize` took no scope and was
> **synchronous**, so a connector whose mapping is per tenant was structurally impossible — exactly
> what the generic HTTP connector needs. The shipped interface therefore threads an optional
> container/scope through `start`, `verifyCallback` and `normalize`, and lets `normalize` return a
> promise; `verifyCallback` may also be async. Fewer-parameter and plain-value implementations stay
> assignable, so a connector written against the sketch still compiles. Three optional members were
> added that the design did not anticipate: `extractExternalRunId` (the opt-in to §5.5's static
> route), `mock` (dry-run/eval parity — see §9 Q2) and `fetchRecording` (stream-through operator
> access — see *What shipped*). `cancel` gained the run's scope as a second argument. All are
> additive and recorded in `BACKWARD_COMPATIBILITY.md`.
>
> One structural finding is worth keeping: **the callback half of the seam is addressed by TENANT,
> never by AGENT.** A callback resolves a *run*; the agent is known only to the correlation row. So
> verification and normalization config can only ever be per `(tenant, connector)` — which is why the
> generic connector fails closed on `defineExternalAgent({ profile })` instead of half-honouring it,
> and why anything wanting per-agent callback behaviour has to travel on the correlation row.

### 5.4 Authoring an external agent

```ts
// packages/agent-elevenlabs/src/modules/voice_agents/ai-agents.ts
defineExternalAgent({
  id: 'voice.owner_call',
  moduleId: 'voice_agents',
  label: 'Call the business owner',
  description: 'Places an outbound voice call, states the alert, and collects a decision.',
  connectorId: 'elevenlabs.voice',
  agentType: 'researcher',
  result: { kind: 'researcher', schema: ownerCallOutcomeSchema },
  timeout: '30m',                    // no callback by then → fail the run → `error` route
  sampleInput: { phone: '+48…', brief: 'Deal ACME at risk…' },
})
```

`defineExternalAgent` registers an ordinary `AgentRegistryEntry` with `runtime: 'external'` plus the connector fields, so **everything downstream works unchanged**: the agents cockpit lists it with an `external` tag (the label already exists), `listAgentOutcomeContracts()` projects its schema, and the workflows context ledger types `outputMapping: { call: 'data.transcript' }` in the Studio's variable picker.

Per-tenant credentials (API key, ElevenLabs agent id, caller number) go in the `integrations` module credential store — `secret`-typed fields, read with `findOneWithDecryption`, resolved by the connector at `start()`. Per repo convention the provider lives in its **own workspace package** (`packages/agent-elevenlabs`), never inside `packages/core/src/modules/`.

> **Addition (2026-08-13, as shipped).** `defineExternalAgent` also takes an optional `profile`, and
> `timeout` is **mandatory** rather than merely recommended. Profiles exist because one provider
> account usually serves several agents (owner call, satisfaction survey, payment chase): without
> them the ElevenLabs agent id has to be typed into every workflow node's `input`, which puts
> per-tenant configuration inside workflow definitions where it cannot be rotated centrally. The
> credential store holds a list of named profiles; `start()` resolves per-call override → the agent's
> named profile → `default`, and an agent naming an unconfigured profile fails **closed** before
> making contact. The five original flat credential fields *are* the `default` profile, so an
> already-configured tenant's next call is byte-identical.
>
> The store was never the constraint — the **admin write path** was: `CredentialFieldType` has no
> list/group/json member and `saveCredentialsSchema` types every credential value as
> `string | number | boolean | null`, so an array through `PUT /api/integrations/[id]/credentials` is
> a 422 whatever a package declares. Profiles therefore ride ONE `text` credential holding a JSON
> document, parsed in-package with a `.strict()` per-profile schema. A `text` field is not masked on
> read-back, so no secret may go in it. A `json`/`textarea` `CredentialFieldType` in `integrations`
> would remove that awkwardness for every provider — a platform follow-up, not in this scope.

### 5.5 Correlation + callback

New append-only-ish table `agent_external_runs` (a sibling of `AgentRunSession`, not a reuse — the OpenCode store is `dispose()`d in a `finally` and has no deadline, process or step columns):

| Column | Why |
|---|---|
| `id`, `tenant_id`, `organization_id` | two-column tenancy, as every row in this module |
| `run_id` | FK id → `agent_runs` |
| `agent_id`, `connector_id` | which agent/connector |
| `callback_token` (unique, hashed) | opaque single-shot bearer for the callback |
| `external_run_id` | provider's id — idempotency + cancel |
| `process_id`, `step_id`, `signal_name` | how to resume the parked workflow step |
| `status` (`pending → completed | failed | expired | cancelled`) | single-shot completion, like `completeOutcome` |
| `expires_at` | drives the deadline sweep |
| `created_at`, `updated_at` | editable row → optimistic locking |

Route: `POST /api/agent_orchestrator/external-runs/[token]/callback` with `metadata = { POST: { requireAuth: false } }`, exactly like `/trace/ingest` — **the verified provider signature establishes the scope, never the body**. The route rate-limits and dedupes; the connector verifies and normalizes; the command completes the run and resumes the step. Alternatively the same logic can ride the `webhooks` module's inbound receiver as a `WebhookEndpointAdapter`, which buys dedupe/rate-limiting/logging for free — worth choosing during implementation, not now.

**Deadline:** enqueue a delayed job at `start()` (the `workflow-invoke-agent` queue already takes `delayMs`). On fire, if the row is still `pending`: `connector.cancel?.()`, fail the run, and resume the step down the **`error` handle** via the existing `resumeInvokeAgentWithError` path. A call nobody answers must never leave a workflow parked forever.

> **Corrections (2026-08-13, as shipped).**
>
> - **The column is `callback_token_hash`**, a lowercase SHA-256 hex digest with a unique index; the
>   raw token is never stored. It is deliberately NOT encrypted — already one-way, and the lookup
>   must stay SQL-queryable. The table also gained `output_mapping` (jsonb, plaintext: it holds
>   Studio-authored context key names the definition already stores in plaintext) so the resume
>   applies the author's mapping; without it an external step landed on the LEGACY fixed context
>   keys, which defeats the whole point of §1's graph. `process_id`/`step_id`/`signal_name` are
>   all-or-nothing in the validator: a row naming a step but no process could never be resumed.
> - **`external_run_id` uniqueness is `(organization_id, connector_id, external_run_id)`**, not
>   global — a provider run id is unique within the provider *account*, so two tenants on their own
>   workspaces can legitimately mint the same id.
> - **A SECOND, static callback route ships beside the token one** —
>   `POST /api/agent_orchestrator/external-runs/connectors/[connectorId]/callback`. ElevenLabs
>   configures post-call webhooks at the workspace/agent level and its verified outbound-call body has
>   no webhook field, so the per-run URL can never be delivered to it; without this route no real call
>   could resume a workflow. The run is resolved by the provider's own id through the connector's
>   `extractExternalRunId`, and tenancy is settled by the SIGNATURE — every candidate row is verified
>   against its own tenant's secret and at most one can verify. It is deliberately the WEAKER of the
>   two (two proofs become one; it must parse before verifying) and the token route stays primary.
> - **Both deadline arms ship**, because their failure modes do not overlap: the delayed job is
>   precise but lost if the queue backend drops it and blind to rows written before it existed, while
>   the 60 s per-organization scheduler tick is self-healing but depends on the OPTIONAL
>   `@open-mercato/scheduler`. Running both is free — settlement is a single-shot conditional UPDATE,
>   so a double fire is a no-op. The sweep runs on its own queue, not `workflow-invoke-agent`.
> - The `webhooks`-module alternative in the paragraph below was **not** taken; §9 Q1 records why.

### 5.6 How this stays compatible with the dispatch roadmap

| Dispatch spec concept | This design |
|---|---|
| `AgentBinding.runtime` selects a runtime adapter | `ExternalAgentConnector` **is** that adapter, registered in code instead of a DB row |
| `AgentTask` as source of truth | `AgentRun` + `agent_external_runs` play the role for the single-binding case; `AgentTask` can later wrap them |
| A2A push transport + webhook callbacks | an `a2a` connector implementing the same interface |
| Lease + heartbeat | replaced by the workflow's own park + deadline sweep; needed only when *multiple* workers can claim the same unit of work — which is not the case here |

Phase 1 does not create anything the dispatch spec must undo.

---

## 6. Change list

### `packages/core/src/modules/workflows` — small, and must ship first

| File | Change |
|---|---|
| `lib/activity-executor.ts` (`AgentWorkflowBridgeLike`, ~L1361) | add `{ kind: 'suspended'; runId: string }` to the duck-typed outcome union (both the inline parallel-branch return and the type) |
| `lib/activity-worker-handler.ts` (`handleInvokeAgentJob`, L462) | treat `suspended` like `user_task`: log, return, leave the step parked |
| `lib/activity-executor.ts` (parallel branch, ~L1455) | **refuse** an external agent in a parallel branch with a clear error, rather than running it inline |
| `data/activity-config-schemas.ts` | *(optional, later)* `onNoResponse` for the deadline arm; not required for Phase 1 |
| `i18n/*.json` | any new refusal/status strings |

Everything else — `invokeAgentConfigSchema`, the five outcome handles, `mapAgentResultToContext`, the ledger, the Studio picker, `node-config-summary` — is untouched. That is the point.

### `packages/enterprise/src/modules/agent_orchestrator`

| File | Change |
|---|---|
| `lib/runtime/agentRuntime.ts` | dispatch `entry.runtime === 'external'` → `ExternalAgentRunner`; throw a typed error for an unknown runtime instead of falling through to native |
| `lib/runtime/externalAgentRunner.ts` | **new** — run open + context bundle + input guardrail + `connector.start`; and the `completeExternalRun` callback half (schema validation + output guardrail + `completeRun` + resume) |
| `lib/runtime/externalConnectorRegistry.ts` | **new** — `registerExternalAgentConnector` / `getExternalAgentConnector` |
| `lib/sdk/defineExternalAgent.ts` | **new** — registers an `AgentRegistryEntry` with `runtime: 'external'` + connector fields |
| `lib/runtime/invokeAgentForWorkflow.ts` | map a suspended runner result → `{ kind: 'suspended', runId }`; leave every other path byte-identical |
| `data/entities.ts` + `data/validators.ts` + `migrations/` | **new** `agent_external_runs` (+ `encryption.ts` map entry if the payload can carry PII — a transcript can) |
| `api/external-runs/[token]/callback/route.ts` | **new** — `requireAuth: false`, connector-verified, idempotent, exports `openApi` |
| `commands/` | **new** command for the completion write (Command path + mutation guard + optimistic lock) |
| `acl.ts` + `setup.ts` | **new** default-off `agent_orchestrator.external_agents.invoke`; sync with `yarn mercato auth sync-role-acls` |
| `events.ts` | `external_run.started` / `.completed` / `.failed` / `.expired` (`as const`) |
| `workers/` | deadline sweep job |
| `backend/agents/*`, `components/` | surface the transcript/recording as run artifacts; the `external` runtime tag already renders |

### New workspace package

`packages/agent-elevenlabs/` — connector + integration provider descriptor (credentials, health check), per the repo rule that every external provider lives in its own package.

---

## 7. Risks

| # | Risk | Sev | Mitigation | Residual |
|---|---|---|---|---|
| R1 | Version skew: enterprise emits `suspended` to a core that does not know it → step resumes down `researcher` with an empty payload, silently | **High** | Ship the core arm first and gate the emitter on its presence; contract test both directions | Low |
| R2 | Callback never arrives (no answer, provider outage) → workflow parked forever | **High** | Mandatory `timeout` on every external agent + deadline sweep → `error` route; surfaced in the failure queue | Low |
| R3 | Callback forgery → a fabricated "the owner approved" transcript reaches the planning agent | **High** | Connector-side signature verification, single-shot hashed token, tenant scope from the *verified* principal not the body; explicit cross-tenant denial test | Low |
| R4 | External agent authored inside a parallel branch → runs inline, blocks, cannot resume (instance-level signal does not reach a parked branch) | Med | Refuse at authoring time (Problems panel) **and** at execute time | Low |
| R5 | Transcript is untrusted third-party text injected into a downstream agent's prompt | Med | Route it through `checkInput` prompt-injection screening before the planning agent; never bypass because "it came from our own connector" | Low |
| R6 | Calling a human is regulated — consent, recording notice, quiet hours, do-not-call | **High** (legal, not technical) | Keep the outbound feature default-off; put the consent/eligibility check in the *workflow* (a condition node), never in the model's judgement; store the consent basis on the `subject` descriptor | Med — needs a legal/compliance owner, not a code fix |
| R7 | Per-tenant credentials leak into the agent registry (which is process-global) | Med | Registry holds a `connectorId` only; credentials resolve per call from the `integrations` credential store under the run's scope | Low |
| R8 | Cost blindness — voice minutes are not LLM tokens, so the existing pricing table reports nothing | Low | Extend the cost stamp with a connector-reported cost, or accept `null` (the UI already renders `—`) | Low |

---

## 8. Suggested sequencing

| Phase | Content | Ships value |
|---|---|---|
| **0** | Prove the business case with `CALL_WEBHOOK` + inbound webhook adapter + `WAIT_FOR_SIGNAL`. No platform change. | A working demo of the whole alert → call → plan → notify loop |
| **1** | Core `suspended` arm + parallel-branch refusal. Release. | Nothing user-visible; unblocks everything |
| **2** | `ExternalAgentRunner` + connector registry + `defineExternalAgent` + `agent_external_runs` + callback route + deadline sweep + ACL. Ship with **one** connector (`elevenlabs.voice`) in its own package. | The voice node becomes one node with full trace/cockpit/ledger |
| **3** | Cockpit polish: transcript/recording as run artifacts, call cost, eval cases from real calls, guardrail rules on transcripts | Operator + flywheel value |
| **4** | Second connector (a generic HTTP/A2A one) to prove the seam generalizes; feed the findings back into `2026-06-19-agent-dispatch.md` | The path to the fleet |

Phase 1+2 is the substantive work — a focused two to three week effort for one engineer, dominated by the callback security surface, the deadline/cancellation edges and the integration tests (cross-tenant denial on the callback route is mandatory).

---

## 9. Open questions for the maintainer

1. **Callback transport** — a dedicated `agent_orchestrator` route, or a `WebhookEndpointAdapter` on the existing `webhooks` inbound receiver (free dedupe/rate-limit/delivery log, at the cost of a cross-module hop)?
   **Answered (shipped): dedicated routes.** The rate-limit and bounded-body helpers everyone assumed lived in the `webhooks` module actually live in `@open-mercato/shared` (`lib/ratelimit/helpers`, `lib/webhooks`) — the `shipping_carriers` provider webhook is the precedent — so reuse cost no cross-module dependency, and riding `WebhookEndpointAdapter` would have *created* the coupling the question feared.
2. **`suspended` and the eval harness** — should a suspended run be replayable in an eval (mock connector) or excluded like a dry run? (Dry run already refuses: `INVOKE_AGENT`'s mock names the agent and fails closed to `human_review`, never fabricating an outcome — an external connector should refuse identically.)
   **Answered (shipped): replayable only when the connector supplies a `mock`, otherwise refused — and the guarantee lives in the RUNNER, not in the connector.** This was the single most dangerous finding of the build: `evalReplayService` calls `agentRuntime.run()` for real, so replaying 50 eval cases against a voice agent would have placed 50 real phone calls. The runner now inspects `ctx.source` before starting anything. A supplied mock's payload is nested under `wouldDo`, never spread, so a mock can never read as an outcome. The voice connector deliberately supplies none: a fabricated transcript is indistinguishable downstream from something a human actually said.
3. **External *proposal* agents** — worth allowing later, or a permanent boundary? Allowing one means a third party's `confidence` can auto-approve a domain write.
   **Answered (shipped): a hard boundary for now.** `defineExternalAgent` throws on any `result.kind` other than `researcher`. Lifting it is a deliberate future decision, not a gap.
4. **Tenant-configurable external agents** — is code-defined + integrations-credentials enough, or does this need the dispatch spec's DB-backed `AgentBinding` sooner than planned (e.g. so a tenant can point the node at *their own* ElevenLabs agent id without a deploy)?
   **Answered (shipped): enough, via named profiles.** A tenant edits its own provider agent ids in the credential store and an agent names a profile; no deploy, no `AgentBinding`. Still open: a per-NODE profile override, so one definition can name a rotatable profile per step.
5. **Consent/compliance ownership** — who signs off on outbound-call eligibility rules before Phase 2 ships?
   **Still open.** Unchanged: the platform keeps the capability default-off and puts eligibility in the author's hands (a condition node), which is a mitigation, not an owner.

---

## 10. What shipped (2026-08-13)

Phases 1–4 landed on `analysis/external-invoke-agent`; the implementation tracker with the full
decisions log is `.ai/runs/2026-08-12-external-agents/PLAN.md`. Developer documentation:
`apps/docs/docs/framework/ai-assistant/external-agents.mdx` (+ `elevenlabs-voice.mdx` for operators).

The design held: the `INVOKE_AGENT` node config, the workflow schema, the five outcome handles and
the output-mapping envelope are all unchanged, and Option 2 needed no walk-back. What the design did
**not** anticipate:

| Addition | Why it exists |
|---|---|
| **The static connector-addressed callback route** | ElevenLabs cannot accept a per-call webhook URL. Without it the two halves of the design never meet. §5.5 records the security trade. |
| **Named provider profiles** (`defineExternalAgent({ profile })`) | One provider account serves several agents; without profiles per-tenant configuration ends up inside workflow definitions. §5.4. |
| **The simulation gate in the runner** (`mock` / refuse) | `connector.mock` as designed was read by nothing; the eval replay path dialled for real. §9 Q2. |
| **A reserved `usage` sibling on the connector's payload** | Voice minutes are not LLM tokens (design R8). A connector reports `{ costMinor, currency, durationMs }` in platform units because only it knows which of its numbers is money; the completion path strips the key before the agent's schema sees it. Two traps: provider "credits" are not money, and the latency column carries the **provider-reported call duration**, not the wall clock — under wall clock the p50/p95 rollups and the `latency` eval scorer would measure how promptly the people we phone pick up. The wall clock needs no column: it is `completed_at − created_at`. |
| **`fetchRecording`, streaming and never stored** | R6/GDPR: a recording is the person's voice. Copying it makes us a second controller, doubling the erasure surface for content no downstream consumer reads — and `AgentRunArtifact` has no retention sweeper. |
| **`outputMapping` on the correlation row** | A suspended run returns before the worker applies the mapping, and the resume happens in a different process. Reading the mapping from the row (rather than projecting it at the call site) is why the brand-new static route honoured author mappings with zero changes on its side. |
| **`AgentOutcomeContractSnapshot.suspends`** | R4's authoring guard was browser-only: `listAgentOutcomeContracts()` was the only server-side seam and carried no runtime, so the AI draft agent could still author an external agent into a parallel branch. `suspends` rather than `runtime` keeps core from holding a list of the peer's runtime names. |
| **The 428 rerun gate and the 202 arms** | Re-running an external run repeats a real-world action. 428 (not 409 — that is the optimistic-lock status the client helpers key off), then 202, because an accepted call is not a finished one. |

Behaviour changes beyond external agents, both intended: `agentRuntime.run()` now **throws** for an
unknown runtime instead of falling through to `NativeAgentRunner` (§2.3's latent trap), and
`agent_orchestrator.external_agents.invoke` must be granted (`yarn mercato auth sync-role-acls`)
before any external step can run.

Risk outcomes: R1 (version skew) ordered as designed. R2 (parked forever) closed with two independent
sweep arms. R3 (forgery) closed on the token route and *mitigated* on the static one — its residual
is higher by construction. R4 refused at run time and warned at authoring time, browser and server.
R5 unchanged. R6 remains open on the compliance side. R7 closed (the registry holds a `connectorId`
only). R8 answered by the `usage` seam.

Known limitations are enumerated in the docs page's *Limitations and open follow-ups* section — the
load-bearing ones are: a late answer after the sweep wins is dropped, the audio-arrives-first hazard
is open, `AgentRunArtifact` has no retention sweeper, and a denied invocation leaves only a log line.

## Changelog

- **2026-08-13:** Implementation feedback. Corrected §5.3 (the connector interface gained scope/async
  on `verifyCallback`/`normalize` plus `extractExternalRunId`/`mock`/`fetchRecording`), §5.4 (mandatory
  `timeout`, optional `profile`, and why profiles ride one JSON `text` credential), §5.5 (the column
  is `callback_token_hash`; `output_mapping` added; org-scoped provider-id unique; the static
  connector-addressed route; both deadline arms). Answered §9 Q1–Q4 from what shipped and left Q5
  open. Added §10 *What shipped* recording the additions the design did not anticipate.
- **2026-08-12:** Initial analysis. Verified the current `INVOKE_AGENT` chain end to end, identified `runtime: 'external'` as a declared-but-undispatched value, and proposed the suspend/resume design (Option 2) as a compatible down-payment on `2026-06-19-agent-dispatch.md`.
