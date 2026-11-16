# Queue payloads: ids where possible, sealed where not, bounded when failed

> **Program:** package B6 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Queue names, worker/producer contracts and the existing real-Redis test harness were read. No Redis server or application was run for this design revision.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Background jobs are stored in Redis, or in a JSON file on disk, exactly as they were enqueued. Most carry only ids. Some carry content: an inbound message as the provider sent it, a payment provider's event, an email address, a workflow's data. One of them is the queue behind persistent events, so a webhook body that the database stores encrypted sits in the queue in clear. BullMQ failed jobs are kept by count with no age limit. **Proposed (future):** in two parts that ship separately. First, failed jobs and quarantined files get an opt-in age cleanup, with a worker-independent command for retired queues; upgraded workers accept both address-job shapes. In the following minor, producers switch to ids and age cleanup defaults on. Second, queues whose content exists nowhere else seal their payload with a configured key before it is stored.

**Not in this spec:** removing fields from event payloads, which the compatibility rules forbid and which sealing makes unnecessary at rest; encrypting Redis or the disk; what a worker does with the content after reading it; the scheduler's stored payloads.

## 📝 Overview

> **Market reference.** Sidekiq Enterprise and Rails' Active Job both recommend "pass ids, not objects" and offer encryption of job arguments for the cases where that is impossible; Sidekiq encrypts the last argument with a configured key and keeps the rest readable for its dashboard. BullMQ's own guidance is to bound failed jobs by age as well as count. Adopted: ids first, sealed content with the wrapper id/time/metadata readable, and explicit age cleanup. Scope inside the payload is sealed too. Rejected: persisting every inbound payload in a table first just so a job can carry an id — a second copy to protect and expire.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | The original program said "ids, not content" for four jobs | Ids for the two where the content is already in a table; sealing for the rest | The program's wording was written before the jobs were read. Inbound messages, provider events and persistent events are not stored anywhere before the worker runs. |
| 2 | Key for sealing | An explicit valid `QUEUE_PAYLOAD_ENCRYPTION_KEY` in every environment. No derived development key | A key derived from another secret changes when that secret is first set or rotated, and an installation that keeps its keys in a key service has no such secret at all — sealing would then be silently off. A separate key has its own rotation lifecycle, and switching sealing on without it is a start-up error. |
| 3 | Rollout | Workers learn to open sealed payloads in one release; an operator switches sealing on when every worker has it; it becomes the default, where a key is configured, in the next | A producer that seals before every worker can open would fail jobs during a rolling deploy. |
| 4 | Which queues are sealed | Module-owned `ModuleInfo.sealedQueues` declarations populate one process-wide registry before sealing-on enqueue; both strategies consult it only when sealing is on (R5-5) | A queue is created in many places — the workflow queue in four, the events queue in three, and again by each worker. An option on creation would be forgotten in one of them and write in clear without a sound. |
| 5 | Removal by scope on a sealed queue | Not supported | Its only two callers cancel search reindexing, on queues that are not sealed; and sealed payloads keep their scope in different places. |
| 6 | Failed-job age | `QUEUE_FAILED_JOB_RETENTION_HOURS`: unset means 0 in the bridge minor and 168 in the next; explicit 0 preserves count-only retention. This spec is its only owner; the pruner spec refers here and defines no setting of its own | One-minor ordinary compatibility bridge, then a seven-day target while cleanup runs; this is not an unconditional wall-clock bound. |
| 7 | An abandoned job whose report was never acknowledged | Kept past the age until its report is acknowledged, still within the count cap | The failed set is the dead-letter queue for abandon reports. Removing such a job loses its report for good. |
| 8 | Queue copies after subject erasure | Disclose waiting, delayed, active, failed, parked and quarantined copies as temporarily retained; erasure does not purge them by subject | Program decision: queue copies left after an erasure are disclosed, not purged. The retained set states each copy's actual lifecycle and whether it was sealed when stored. Subject identity is not a common job contract, so a subject purge would need its own reviewed design; this spec supplies none. |

## 📝 Problem Statement

**Where jobs are stored**

| | Local | BullMQ |
|---|---|---|
| Storage | `.mercato/queue/<name>/queue.json`, readable JSON (`packages/queue/src/strategies/local.ts:83, 116, 478`) | Redis job data (`strategies/async.ts:402`) |
| Completed | Removed | Removed |
| Failed | Three attempts, then dropped | Kept: the last 1000, with no age limit (`async.ts:405`) |
| Other copies | An unreadable queue file is set aside as `queue.corrupted.*.json`, payloads included, and never cleaned (`local.ts:427`) | — |
| Encrypted | No | No |

Failure logs carry the job id and the error, never the payload. A delayed job — a workflow timer — holds its payload for the whole delay.

**Jobs that carry content**

| Queue | Content | Can it carry an id instead |
|---|---|---|
| `messages-email` | An outside email address (`messages/subscribers/message-notification.ts:200-206`) | Yes: the message row has it |
| `communication-channels-gmail-history-sync` | A mailbox address (`communication_channels/api/post/webhooks/gmail/route.ts:126-138`) | Yes: the channel id is already in the job |
| `events` | Every persistent event's payload (`packages/events/src/bus.ts:683`) | Not in general: events are stored nowhere else |
| `communication-channels-inbound`, `communication-channels-reactions` | The provider's message or reaction as received | No: not stored before the worker runs |
| `payment-gateways-webhook`, `shipping-carriers-webhook` | The provider's event data | No: only a key and a type are stored |
| `channel_discord_interactions` | The interaction, including its reply token | No |
| `workflow-activities` | Step configuration with values filled in, and the workflow's context | Partly: the context is on the instance; the filled-in configuration exists only in the job |
| `workflow-invoke-agent` | Resolved `input`, `subject` and `review`, declared in `workflows/lib/activity-queue-types.ts` and enqueued by `activity-executor.ts` | No safe id-only substitute for the resolved execution snapshot |
| Provider override such as `stripe-webhook` | Verified provider event routed by `registration.queue` in the payment webhook route | No; `gateway_stripe/di.ts` registers this exact queue |

**Persistent events that carry content**

| Event | Content |
|---|---|
| `messages.message.sent` | An outside email address |
| `inbox_ops.email.received` | The forwarding address and the subject |
| `webhooks.inbound.received` | The whole inbound body — which `webhook_ingestions` stores encrypted |
| Workflow milestone | A step's output data |

Wildcard subscribers use an event's payload as their content: the outbound webhook sends it as its body, and workflow triggers, business rules and the enterprise process triggers read it. The compatibility rules also forbid removing a field from an existing event's payload (`BACKWARD_COMPATIBILITY.md` §5). So events are protected by sealing their queue, not by thinning them.

**Facts the design must respect**

- **A queue has no single creation point.** `workflow-activities` is created in four files, `events` three times in `packages/events/src/bus.ts:384-397`, and each worker creates its own instance (`packages/queue/src/worker/runner.ts:177`). `createModuleQueue` forwards only a fixed set of options (`packages/queue/src/factory.ts:84-104`).
- **Stored payloads have other readers.** A job abandoned after its last attempt is handed to `onJobAbandoned` with its data (`strategies/async.ts:261-323`); the local strategy keeps a second copy for coalesced jobs (`local.ts:596-610`); two integration tests parse the events queue file (`warranty_claims/__integration__/TC-WC-020-sla-escalation.spec.ts:173-189`, `TC-WC-023-quarantine.spec.ts:57-73`).
- **Removal by scope** reads top-level `tenantId`, `organizationId` and `jobType` from a payload (`async.ts:134-145`; `local.ts:66-76`). It has two callers, both cancelling search reindexing.
- **The abandon sweep runs only where an abandon hook is declared.** Its timer is started only when the worker declares `onJobAbandoned` (`async.ts:517-525`), and only the two `data_sync` workers do (`packages/core/src/modules/data_sync/workers/sync-import.ts:33`, `sync-export.ts:33`). The queues that carry content — events, inbound messages, provider webhooks, workflows — have no sweep. The sweep reads the whole failed set in one call (`async.ts:308`).
- **The failed set is also a dead-letter queue.** The sweep re-delivers any abandoned job whose stored `metadata` lacks `abandonReportedAt`; that marker is the acknowledgement (`async.ts:98-106`).
- **A stored job is a wrapper.** BullMQ stores `{ id, payload, createdAt, metadata }` (`async.ts:395-400`). The abandon path de-duplicates on the wrapper's `id` (`:266`) and acknowledges by rewriting the stored data with `updateData({ ...job.data, metadata })` (`:253-259`); trace context lives in `metadata`. The local strategy stores the same wrapper, with a parked coalesced copy (`coalesceNext`) that has its own `payload`, and rewrites the whole job array through `writeQueue` (`local.ts:476`) on enqueue and coalescing (`:643-694`) and when it finalizes jobs and applies retries (`:790-810`).
- **The current shared encryption library has no purpose-key derivation**, and its AES helper takes a 32-byte base64 key (`packages/shared/src/lib/encryption/aes.ts:80-82`).
- **The integration environment runs workers automatically**, so a queued job is usually consumed before a test can look at the file.

## 📝 Proposed Solution

### Part 1 — Bounds and compatible id jobs

**Failed-job age.** `QUEUE_FAILED_JOB_RETENTION_HOURS` accepts a finite non-negative integer. Explicit `0` means existing count-only retention. Unset means `0` for the bridge minor, then `168` in the following minor. Invalid values use that release's default and log once. The bridge release logs a warning naming the next minor's default and the explicit `0` opt-out. Age cleanup deletes only with a positive effective age; no key is needed.

Every BullMQ worker runs a separate retention pass at start and hourly, even without an abandon hook. Unref the timer and clear it on `close()`. The shared pass uses `finishedOn`, not job creation or last retry time. Log per queue the examined, removed and spared counts and effective age; failures log and `reportError`, then leave jobs for the next pass.

- Without an abandon hook, call `queue.clean(ageMs, 1000, 'failed')` until fewer than 1000 ids return.
- With a hook, walk oldest-first pages of 100 using `getJobs(['failed'], start, end, true)`. Remove eligible jobs except an abandoned job whose stored metadata has no `abandonReportedAt`. Advance `start` by the number of jobs kept in that page, **not** the number fetched: removals shrink the set. Stop only after all older eligible candidates were inspected; do not assume a Redis failure-score order is exactly `finishedOn` order after manual moves. A missing/invalid `finishedOn` is spared and reported.
- Unacknowledged abandoned jobs stay until acknowledged or evicted by the existing 1000-job count cap. A module with no active worker descriptor but abandoned, unacknowledged jobs is treated conservatively by the maintenance command too.
- Keep the existing abandon-report sweep separate. Do not change worker retry, concurrency or abandoned-report delivery semantics.

**Worker-independent cleanup.** Add built-in `mercato queue prune-failed (--queue <name> | --all) [--apply]`. It reports by default; apply uses the same age and acknowledgement rules as workers without starting that queue's handler. `--all` unions enabled worker queues with actual queues discovered in the configured Redis prefix, so disabled/retired queues remain reachable. Use Redis `SCAN`, never `KEYS`, and bounded pages. An explicit queue need not belong to an enabled module. No hook descriptor means spare any unacknowledged abandoned job rather than assuming it has no report to deliver. Operators run `--all --apply` at least hourly from their existing operations scheduler when workers may be scaled to zero. This spec adds no new scheduler service: without a running worker or that operational command, old failures remain indefinitely. The docs and report state this residual.

**Quarantined local files.** Use the same effective positive age for `queue.corrupted.*.json`. Check on queue start, hourly in a live local queue, and when quarantining a new file; unref/clear the timer on close. The timestamp is the quarantine file's filesystem `mtime`, preserved after creation, not the malformed queue content. With age `0`, do not delete. Validate the expected basename, stay within the queue directory and do not follow symlinks. Log every deletion at warn level with basename, age and byte size; never log content or a sensitive absolute path. The independent prune command also covers quarantines under the configured local queue root, including retired queues. The recovery window is seven days after the default flip, subject to a cleanup pass running; preserve external recovery copies separately if required.

**Two id jobs, two releases.** In bridge minor N, change workers to accept both shapes and keep producers emitting the legacy shape. In minor N+1, after every worker is at least N, switch producers to ids. The bridge unions remain in N+1 so rolling deployment with N workers succeeds. Earliest removal is N+2, after documenting the deprecation and draining legacy delayed/failed jobs. If legacy jobs remain, retain the decoder longer. No new producer may feed an old pre-N worker.

- `messages-email` keeps message id/type/scope and drops external `email`; the owning messages service reads the address from its message using scoped decryption helpers. Keep the recipient-user variant unchanged.
- `communication-channels-gmail-history-sync` retains channel id, scope, history id and optional drain counter; the communication channel owner reads its mailbox address through its existing scoped decrypted channel lookup.
- Missing/deleted source records use the existing worker skip/failure behavior; do not widen tenant/org scope or replay old content into a new subject.

### Part 2 — Sealing

#### Queue-name inventory and ownership

Scan every first-party worker metadata, queue constant, creation call, webhook registration and scheduler target under `packages/*/src`, excluding test/demo queues from production claims. Registration lives with the module that owns the queue; `packages/queue` keeps **no provider or module queue-name defaults**. It supplies registry/codec mechanics only.

| Module / source | Exact queue names | Decision |
|---|---|---|
| `events` | `events` | Module declares sealed; persistent event payloads stay unchanged |
| `communication_channels` | `communication-channels-inbound`, `communication-channels-reactions` | Module declares sealed; original provider content |
| `payment_gateways`, `shipping_carriers` | `payment-gateways-webhook`, `shipping-carriers-webhook` | Owning modules declare sealed; provider event bodies |
| `workflows` | `workflow-activities`, `workflow-invoke-agent` | Module declares both sealed; resolved context/configuration and agent input/subject/review |
| `gateway_stripe` | `stripe-webhook` | Provider declares it and calls `registerSealedQueue('stripe-webhook')` through webhook registration; never preconfigure it in queue/core |
| `channel_discord` | `channel_discord_interactions` | Provider declares it and calls `registerSealedQueue('channel_discord_interactions')` during bootstrap; the queue package knows no Discord name |
| `catalog` bulk create | `catalog-product-bulk-create`, `catalog-category-bulk-create` | Producer payloads contain input rows (`items`), not ids alone; module declares sealed without claiming every title is PII |
| `messages`, Gmail history | `messages-email`, `communication-channels-gmail-history-sync` | Declare sealed during the bridge while old jobs carry addresses; id producer switch does not rewrite stored jobs |
| Communication control/outbound | `communication-channels-outbound`, `communication-channels-poll`, `communication-channels-poll-tick`, `communication-channels-import-history`, `communication-channels-gmail-renew-watch` | Inventory records reference/control payloads; verify every enqueue in plan step 2 before certifying no content |
| Query/search queues | `fulltext-indexing`, `vector-indexing` | Current types in `packages/search/src/queue/` carry record references even in batches; do not call those records decrypted documents |
| Notification/checkout | `notifications`, `checkout-email`, `checkout-transaction-expiry` | Notifications has content-capable create types but only cleanup is a confirmed in-repo producer; checkout email has optional error text but current notification producers enqueue ids. Verify producers separately; no unsupported claim that content is enqueued |
| Workflow control | `workflow-instance-bulk-replay`, `workflow-definition-metric-rollup` | Inventory: ids, action and control/scope payloads |
| Business bulk/control | `catalog-product-bulk-delete`, `customers-deals-bulk-update-stage`, `customers-deals-bulk-update-owner`, `staff-time-reapply-rounding`, `promotions-code-generate`, `promotions-code-reservation-sweep` | Inventory entries; plan step 2 verifies producer payloads and records any needed module-owned declaration |
| Cart/forms/push | `cart-mark-abandoned`, `cart-expire`, `cart-release-stale-locks`, `cart-purge-expired`, `forms-retention-purge`, `forms-pdf-snapshot`, `push-deliveries`, `push-stuck-reclaim` | Inventory entries; no blanket assertion that identifiers or control metadata are anonymous |
| Maintenance/provider control | `data-sync-import`, `data-sync-export`, `data-sync-scheduled`, `domain-verification`, `domain-tls-retry`, `customer-accounts-cleanup-sessions`, `customer-accounts-cleanup-tokens`, `attachments-quota-recovery`, `integration-health-probe`, `integration-log-pruner`, `payment-gateways-status-poller`, `payment-gateway-session-initialization-prune`, `shipping-carriers-status-poller`, `warranty_claims.sla_sweep`, `ai-pending-action-cleanup`, `ai-token-usage-prune`, `storage-s3-quota-recovery` | Inventory entries; preserve existing id/control contracts and audit dynamic payloads before acceptance |
| Optional providers/runtime | `tillio-pull`, `sync-akeneo-first-import`, `sync-akeneo-delete-products`, `channel_discord_gateway`, `scheduler-execution`, `scheduler-test` | Provider-owned declarations if content is found; scheduler/test echo is not a production content claim; arbitrary scheduler target names are inventoried separately |
| Enterprise agent orchestration | `agent-orchestrator-llm-judge`, `agent-orchestrator-metric-rollup`, `agent-process-executions`, `agent-orchestrator-eval-suite` | Existing queue types carry run/execution/suite ids and scope; enterprise ownership stays there, no enterprise implementation in OSS |

The exact inventory is versioned in this spec and rechecked at implementation. New content discovered in the listed review entries must be registered by its owner before sealing is called complete. A source test enumerates current producers and webhook registrations, compares them to the inventory, and fails for an unreviewed content queue. Dynamically chosen webhook queues are sealed by registration, never guessed from a prefix.

#### Registry lifetime

Add optional `sealedQueues?: readonly string[]` to `ModuleInfo` in `packages/shared/src/modules/registry.ts`. The generator already carries each module's `index.ts` metadata as `info`; preserve that behavior and validate the new member with zod. No new `privacy.ts` convention or generator redesign is needed. R3-2 remains the owner of the separate privacy-object registry contract.

Store names and readiness on `globalThis[Symbol.for('open-mercato.queue.sealed-queues.v1')]`, containing `{ names: Set<string>, state: 'loading' | 'ready' }`. Put this small dependency-free mechanism in new `packages/shared/src/lib/queue/sealedQueues.ts`; the queue package re-exports `registerSealedQueue`. Shared payment gateway registration can call that helper without a forbidden shared-to-queue dependency.

Under R5-5, effective sealing off means enqueue never waits for, consults readiness of, or refuses on the sealed-queue registry; it stores through the existing path even before full metadata bootstrap. This includes N's unset/off default, N+1's keyless unset mode and explicit off in either minor. Key validation and opening stored envelopes retain their independent rules below. Early queue construction remains allowed.

Before the first **sealing-on** enqueue in every web, CLI, worker and test process, initialize from the full enabled module metadata, run synchronous module registration hooks, validate declarations, then freeze additions and mark ready. An enqueue with effective sealing on and the registry still loading fails closed with R5-5's named error, before any payload is stored; it never waits or falls back to plaintext. The error is `SealedQueueRegistryNotReadyError`, defined next to the registry in `sealedQueues.ts` and re-exported by `@open-mercato/queue`. It carries `code: 'QUEUE_SEALED_REGISTRY_NOT_READY'` and the `queueName`, never payload data, and its message starts with `[internal]`. Like `AdvisoryLockUnavailableError`, it is branded with `Symbol.for('@open-mercato/shared:SealedQueueRegistryNotReadyError')` and a `Symbol.hasInstance` check, so `instanceof` holds across duplicate package copies. Callers branch on the class or the code, never the message. Runtime bootstrap reads `getModules()`; a module's `cli.ts` or `packages/cli/**` may supply CLI metadata explicitly. Never use the CLI registry from shared runtime code. Sealing-on tests explicitly bootstrap their fixture module metadata; off-mode direct factory tests need no registry bootstrap. An i18n-only registry is not full readiness.

The application container bootstrap finalizes this registry after module DI registration and before returning a usable container; the built-in queue CLI does the same before starting workers or maintenance. Finalization with the same metadata is idempotent for later request containers. No asynchronous listener or deferred side effect may mark it ready.

`registerSealedQueue(name)` is idempotent. A known name may be registered after readiness; a **new** late name throws instead of accepting a plaintext-producing registration. `registerWebhookHandler` in `packages/shared/src/modules/payment_gateways/types.ts` calls it for `options.queue ?? 'payment-gateways-webhook'` before storing the handler. Providers with overrides list the same name in their own metadata, so every producer process sees it even if it never invokes provider DI. Channel Discord registers its exact interaction queue in provider metadata and bootstrap. Duplicate package copies share the symbol; separate OS processes independently load the same metadata before sealing-on stores. Off-mode enqueues remain independent of registry readiness under R5-5. Module-set changes after ready require a process restart; never silently unseal a previously declared name.

#### Envelope and write paths

Only the wrapper's `payload` becomes `{ sealed: 1, keyId, data: <ciphertext> }`. Use the existing shared AES-GCM helper. Its authenticated plaintext is `{ queueName, jobId, payload }`; verify the inner queue name and job id against the current queue and readable wrapper id on open, **before** handing anything to a handler. This binds ciphertext to queue/job without changing the AES helper's exported signature or inventing crypto. A transplanted envelope fails closed with a sanitized context-mismatch error. Allocate the immutable wrapper id before sealing; local coalesced copies use their own eventual wrapper id and retain it on promotion.

`keyId` is the first 16 lower-case hex characters of SHA-256 over the **decoded 32 key bytes**, never a prefix of the base64 secret. Only the ciphertext, envelope version and that non-secret fingerprint are in the envelope. The wrapper's id, createdAt and metadata remain readable for de-duplication, tracing and abandon acknowledgement. Do not add payload-derived names/addresses to metadata or coalescing keys; existing readable metadata is not declared anonymous.

Open into a new object immediately before the handler and before `onJobAbandoned`, regardless of `QUEUE_SEAL_PAYLOADS`. Unsealed payloads remain readable for explicit-off/keyless operation and for historical-job compatibility; the address-shape deprecation is separate. A plaintext job read after sealing is enabled remains an unsafe legacy copy in status reports until consumed or removed. Never replace the stored payload with the opened object. The parked local `coalesceNext` copy stays sealed while parked or promoted.

Every write preserves stored envelopes: BullMQ abandon acknowledgement `updateData({ ...job.data, metadata })` spreads stored data; local `writeQueue` on enqueue, coalescing, retry, finalization and promotion works from the stored record; promotion copies the parked payload and its bound id. A test per path checks the persisted envelope and round-trips its bound context. Coalescing selection is computed before sealing as today.

#### Settings, keys and rollout

`QUEUE_SEAL_PAYLOADS` is `off`, `on` or unset. Parse it centrally. In minor N, unset is off; in N+1 unset is on only with a valid current key, otherwise off and reported. Explicit off remains available.

Validate **every supplied current and previous key at every producer/worker start**, even with sealing off: canonical base64 which round-trips exactly to 32 bytes after trimming surrounding whitespace. Reject malformed encoding, empty explicitly supplied values and wrong length without logging a secret. Explicit on requires a valid current key in all environments. There is no unnamed application-secret fallback and no development-derived key. `QUEUE_PAYLOAD_ENCRYPTION_KEY_PREVIOUS` is an opening key, never a write key; use the matching fingerprint, then authenticate, and report unknown keys without including payload data.

Sealing new jobs and opening existing jobs are independent. Turning sealing off stops new sealing but must keep current/previous keys available for every stored envelope. Before removing a key, run report-only `mercato queue payload-status (--queue <name> | --all)` against the actual storage, including waiting, active, prioritized, delayed, waiting-children, failed and retained completed BullMQ jobs and every local parked copy/quarantine. It reports per queue/state unsealed counts, sealed counts by keyId, unreadable/unknown counts and scan completeness, never content. An unreadable quarantine makes key-removal evidence incomplete. Stop writers/consumers for a final scan; live scans are explicitly non-atomic. Remove a key only after a complete scan says no remaining job needs it and no process still writes with it. An unavailable key at open fails before handler invocation; it never converts an envelope to plaintext.

The legacy drain is an operator enablement prerequisite, not a persisted startup gate. N+1 does not scan storage before choosing its default: a deployment with remaining plaintext must pin `QUEUE_SEAL_PAYLOADS=off` during that upgrade, even with a valid key, until the drain/status evidence is complete. If that prerequisite is ignored, startup follows the setting, seals new writes and continues to report the old copies unsafe; it never claims migration complete. Unit tests pin the explicit-off override through the N+1 default flip.

No automatic resealing batch is added. Before declaring a sealing transition complete, stop old producers, finish upgrading every worker, and **drain all legacy waiting, delayed, failed and parked jobs** in each declared queue. Delayed jobs must reach their due time and run, and failed jobs must be retried/resolved or become eligible for the explicit retention pass; do not silently discard them to satisfy the gate. Run payload-status from the beginning with writers paused and require zero unsealed stored payloads before enabling sealing and restarting new writers. Because readers accept legacy jobs, a premature toggle protects only new writes: it is not successful migration of the backlog. Old files/backups remain outside this gate.

### Doctor ownership

After C1 Phase 1/R3-2 and doctor Phase 3/DEC-I have delivered the whole-object registry, member validation and doctor collector, `packages/core/src/modules/configs/privacy.ts` declares `configs.queue_payloads_unsealed` through a full default object with `dataClasses: []` and `doctorChecks` (DEC-I and R3-2), preserving any other members, using exported `inspectQueuePrivacyConfig({ env, moduleIds })` from `@open-mercato/queue`. Define potential queue use conservatively: effective strategy is `local` or `async` and at least one enabled application module other than `configs`/`privacy` is present. This reports potential persistent content, never observed jobs or a running worker; it avoids a provider-name list in queue infrastructure. Warn when potential use and effective sealing is off, including unset without a key. Runtime-refused malformed/on-without-key configurations are errors. Output only mode/key-validity booleans and remediation, never key values.

The same host declares `configs.queue_failed_retention_default`: warning for unset in N naming N+1's 168-hour default and explicit `0` opt-out, info after the flip. These are module-owned checks in this spec and already appear in the doctor spec's known module-check list. R3-4 owns optional database checks; these checks remain configuration-only and do not claim stored jobs are sealed or expired.

### Design decisions

| Decision | Rationale |
|---|---|
| Module metadata plus frozen process-wide registration | Every sealing-on producer sees the same policy, including optional providers and duplicate package copies; off-mode enqueues preserve existing behavior under R5-5 |
| Only payload is sealed and inner queue/job identity is authenticated | Keep required wrapper readers working while refusing ciphertext transplantation |
| Explicit validated keys; opening independent of writing | Malformed settings fail before enqueue and rollback does not strand envelopes silently |
| Drain legacy backlog before the transition is complete | Switching a setting cannot rewrite stored payloads; delayed/failed copies need explicit evidence |
| Report-first independent maintenance command | A retired queue has no worker timer; keep the residual visible when operations does not schedule cleanup |
| One-minor off/default bridge and explicit zero opt-out | Ordinary compatibility protocol also covers deletion of failed history and recovery files |
| Existing event payloads unchanged | Frozen event fields remain available to subscribers; storage sealing protects the copy |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Per-creation `sealed` option | Multiple producers can forget it; metadata and registry cover all stores |
| Provider names hard-coded in `packages/queue` | Violates provider ownership and misses custom webhook overrides |
| First-use local-only registry | A producer/package copy may never load the registering module |
| Derived queue key | Secret changes can strand delayed work; explicit keys have a separate lifecycle |
| Seal whole wrapper | Breaks de-duplication/tracing/acknowledgement readers |
| Subject-scoped queue purge | Subject identity is not a common job contract; destructive cancellation requires a separate reviewed design |
| Block deployment acceptance until a subject purge exists | Holds back every other control for a residual that each job's own lifecycle governs and the erasure report discloses (assumption 8) |
| Readiness refusal as a plain `Error` with a message only | Callers and docs could only match message text; a branded class with a stable code survives duplicate package copies |
| Remove event payload fields | Violates frozen contracts and subscriber behavior |

### Known limits and retained copies

- A sealed job is readable to anyone who holds the key. Queue names, ids, times and wrapper metadata remain readable. Dashboard payload type/scope inside the envelope is unavailable.
- Waiting/delayed/active/failed/parked jobs stored **before** sealing was enabled remain plaintext until drained or removed by their normal lifecycle. No toggle, doctor check or successful new enqueue retroactively encrypts them.
- Erasure does not purge a queue by subject. Failed copies survive until a positive-age cleanup runs, normally up to 168 hours from failure plus the hourly interval. Age 0, a stopped worker without the independent command, or an unacknowledged abandon report can extend that indefinitely; the existing count cap still applies. Waiting/delayed copies survive their full delay/backlog and are **not** bounded by failed-job age. Sealing protects them only if it was on when they were stored.
- This is the temporarily retained queue set under resolved assumption 8. The erasure retained-set/completion text and the program's acceptance criteria cite it; draining the acceptance fixture before scanning does not prove production BullMQ has no retained copies. No claim of subject erasure completeness can hide this set.
- Keys must remain until all envelopes needing them are gone, including delayed/failed/parked work and unreadable quarantines. A second rotation before draining the previous key can strand work.
- A retired queue keeps failed jobs indefinitely unless a worker or `mercato queue prune-failed --queue <name> --apply`/`--all --apply` runs. A positive age is an eligibility rule, not an autonomous service.
- Sealed queues cannot be cleared by scope; event subscribers still receive plaintext content after opening. Worker logging and scheduler-stored content remain outside this spec.

## 📝 Delta

### Capability: queue-payload-protection

#### MODIFIED Requirement: Failed-job retention
With a positive effective age, a worker retention pass or independent prune command SHALL remove eligible failed jobs without requiring another job failure. Age 0 SHALL preserve count-only behavior. No pass means no wall-clock age guarantee.

##### Scenario: Bridge and flip
- WHEN the age is unset in N
- THEN no history/quarantine is age-deleted, and warning names N+1's 168-hour default and explicit 0 opt-out
- WHEN unset in N+1
- THEN each cleanup pass uses 168 hours; explicit 0 still keeps existing count-only retention

##### Scenario: Quiet or retired queue
- WHEN a quiet queue's worker starts or its timer runs, or an operator runs prune-failed apply without that worker
- THEN eligible failures are removed and counts logged without invoking a job handler

##### Scenario: Several pages and abandon reports
- WHEN removal shrinks several failed pages containing acknowledged and unacknowledged abandoned jobs
- THEN every eligible non-spared job is considered in that run, offsets advance only over kept jobs, and unacknowledged reports stay

##### Scenario: Long-lived local queue
- WHEN a quarantined file ages past the window without worker restart
- THEN the next hourly cleanup deletes it and warns with basename, age and size

Frozen by: `packages/queue/src/__tests__/failed-job-retention.characterization.test.ts` and `local-quarantine-retention.test.ts`.

#### MODIFIED Requirement: Address-job payloads
Workers SHALL accept both payload shapes in N; producers SHALL keep old shapes in N and switch to ids in N+1, after every worker can read them.

##### Scenario: Mixed fleet
- WHEN N producers reach pre-N workers during the bridge deploy
- THEN the job still includes the legacy address
- WHEN N+1 producers reach N workers
- THEN id-only jobs resolve the address from the scoped owning record and complete

Frozen by: worker job-shape characterization tests in the owning modules.

#### ADDED Requirement: Sealed payload persistence
When sealing is on, every store into a declared queue SHALL seal payloads, including provider overrides and `workflow-invoke-agent`. Every write path SHALL preserve envelopes, and handlers SHALL receive only authenticated opened copies.

##### Scenario: Provider and separate producer process
- WHEN Stripe registers its custom webhook queue and a different bootstrapped process/package copy enqueues to it
- THEN storage is sealed without per-call options; late unknown registration refuses instead of storing clear

##### Scenario: Enqueue before registry readiness
- WHEN effective sealing is off and a caller enqueues before registry readiness
- THEN enqueue stores as today without waiting for or refusing on the registry, including calls through either existing queue factory
- WHEN effective sealing is on and a caller enqueues before registry readiness
- THEN it throws `SealedQueueRegistryNotReadyError` (`QUEUE_SEALED_REGISTRY_NOT_READY`) before any payload is stored

##### Scenario: Acknowledgement, retry and coalescing
- WHEN a sealed payload is abandoned, acknowledged, retried, parked, promoted or finalized
- THEN every remaining stored payload is still an envelope bound to its own queue/job id

##### Scenario: Malformed or removed key
- WHEN any supplied key is malformed or on lacks a current key
- THEN producer/worker startup refuses before enqueue
- WHEN writing is off but an existing envelope needs a configured opening key
- THEN it is opened normally; a missing matching key fails before the handler

##### Scenario: Legacy backlog at toggle
- WHEN sealing is enabled with old delayed/failed jobs remaining
- THEN new writes are sealed, old copies are still reported unsealed, and migration remains incomplete until they drain

##### Scenario: Ciphertext copied to another queue/job
- WHEN a valid envelope is moved under a different queue name or wrapper id
- THEN authenticated inner identity validation refuses it before handler invocation

Frozen by: `packages/queue/src/__tests__/stored-payload.characterization.test.ts`.

## 📝 Architecture

- **Queue package:** strategy-level sealing/opening, context-bound codec, shared retention pass, worker timers, recurring quarantine cleanup, payload-status and prune service functions, test utilities. Existing `createQueue` and `createModuleQueue` both reach the guarded strategy store paths.
- **Shared infrastructure:** the global registry helper and optional `ModuleInfo.sealedQueues`, with existing metadata propagation; no import of queue/domain packages from shared. Payment webhook registration uses that helper.
- **Module owners:** declarations in their own `index.ts`; Discord and Stripe keep provider configuration inside their packages; messages/channel owners resolve ids through scoped services/decryption helpers. No cross-module ORM relation or raw business-table query is introduced.
- **CLI:** new built-in queue commands in `packages/cli/src/mercato.ts` call reusable queue services, preserving all existing queue worker commands. Retired queues do not require enabled business modules to inspect/clean storage.
- **Doctor:** configs-owned configuration checks via its `privacy.ts` default export under DEC-I/R3-2. Optional database tier remains R3-4's contract.

### Shared decisions and consumers

| Decision | Owning design |
|---|---|
| R3-2 — The registry carries the whole `privacy.ts` default export | [`privacy-data-class-contract`](2026-11-16-privacy-data-class-contract.md), “Export shape”; queue sealing uses separate existing `Module.info` metadata, not a new privacy convention |
| DEC-I — The doctor's extension point | [`privacy-doctor-cli`](2026-11-16-privacy-doctor-cli.md), API Contracts; configs owns the two configuration declarations |
| R3-4 — An opt-in database tier for the doctor | Same doctor spec, Architecture; these queue configuration checks need no database factories |
| R3-14 — The `eraseSubjects` entry point | [`privacy-subject-erasure`](2026-11-16-privacy-subject-erasure.md), API Contracts; retained queue copies stay in the private report, not an added erasure-result member |
| R5-5 | This spec, Registry lifetime and Migration & Backward Compatibility; off-mode enqueue bypasses readiness, sealing-on enqueue fails closed before storing |
| DEC-H — The counting-period bridge | [`operational-retention-pruners`](2026-11-16-operational-retention-pruners.md), history-counting bridge; it is distinct from B6's sole failed-job age setting |

[`2026-11-16-privacy-verification-suite.md`](2026-11-16-privacy-verification-suite.md), “Owner scan members”, owns optional `Queue.findValuesByScope(scope, { values })`: location-only local scanning with `sealed_job`/`unattributed_job` gaps and async unsupported. This spec preserves that honest limit; `payload-status` counts envelopes without opening or claiming subject attribution, and neither method becomes a subject-purge API. B6 owns `TC-QUEUE-ERASURE-001`; it supplies the dedicated BullMQ fixtures consumed by G6's `TC-PRIVACY-VERIFY-011` (“Integration Coverage”). Both keep delayed/failed plain/sealed copies parked for inspection, then check failed-age eligibility from `finishedOn`, missing/invalid timestamps, unacknowledged abandonment, bridge/explicit-zero behavior and worker-independent prune exceptions. Delayed/backlog time has no failed-age bound. The normal asynchronous-index drain barrier applies only to its owned indexing/cleanup work and never drains these retained-copy fixtures. G6 already assesses these non-table copies separately from table allowances; its production async/sealed scan remains explicitly not scanned.

[`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), “When a subject is complete”, owns completion. Its assumption 19 and “Queue copies after completion” now consume B6 assumption 8 through the private report's `retainedCopies`, bound by the report digest without adding a member to the R3-14 `PrivacyErasureRunResult`. Preserve actual delay/backlog, failed-age and stored plaintext/sealed/unknown state; current sealing settings never prove historical storage. This resolves the earlier owner handoff without implying that an erasure run removed a production queue copy.

## 📝 Data Models

No table or user-editable entity; optimistic locking is not applicable. Stored wrappers keep their existing id, createdAt, metadata and coalesced form. Only payload changes to the versioned envelope. Module metadata gains an optional declaration. Event payloads and existing HTTP route shapes do not change.

## 📝 API Contracts

| Surface | Contract |
|---|---|
| Queue exports | Additive `registerSealedQueue(name: string): void`, `SealedQueueRegistryNotReadyError`, `inspectQueuePrivacyConfig({ env, moduleIds })`, reusable prune/status services and test-only `openStoredJob` |
| Module metadata | Optional `ModuleInfo.sealedQueues?: readonly string[]`; zod validates non-empty unique names; duplicate declarations deduplicate; late unknown names refuse |
| Enqueue readiness (R5-5) | Factory signatures stay unchanged. Effective sealing off never waits for or refuses on registry readiness; sealing on refuses before storage while the registry is loading, throwing `SealedQueueRegistryNotReadyError` with `code: 'QUEUE_SEALED_REGISTRY_NOT_READY'` and `queueName`. The class and code are additive and frozen once shipped |
| New CLI | `mercato queue prune-failed (--queue <name> or --all) [--apply]`, report-only by default; `mercato queue payload-status (--queue <name> or --all)`, always read-only. Zod validates names/options; reports counts and scan completeness, no job values |
| Settings | `QUEUE_SEAL_PAYLOADS`, `QUEUE_PAYLOAD_ENCRYPTION_KEY`, `QUEUE_PAYLOAD_ENCRYPTION_KEY_PREVIOUS`, `QUEUE_FAILED_JOB_RETENTION_HOURS`; add to app/template environment examples in sync |
| `SendMessageEmailToExternalJob` | N/N+1 exported old-or-new union shown below; legacy address variant/email deprecated; recipient-user variant unchanged |
| `GmailHistorySyncJobPayload` | N/N+1 old-or-new notification union shown below; legacy address variant deprecated; retain scope nullability and drain counter |
| Removal release | Earliest N+2 after one full minor of id-only producers, upgrade note and legacy-backlog drain; delay removal if old jobs remain |
| Doctor | Configs declares `configs.queue_payloads_unsealed` and `configs.queue_failed_retention_default`; environment/module-derived only |
| Events and routes | No event payload, event id or HTTP contract changes; exported job types **do** change additively through bridge unions |

The bridge types are exact; annotate each legacy address variant with `@deprecated` naming the id-only replacement and N+2 as the earliest removal minor:

```ts
type SendMessageEmailToExternalJob = {
  type: 'external'
  messageId: string
  tenantId: string
  organizationId?: string | null
} & ({ email: string } | { email?: never })

type GmailHistorySyncJobPayload = {
  channelId: string
  scope: { tenantId: string; organizationId: string | null }
  notification: { emailAddress: string; historyId: string } | { emailAddress?: never; historyId: string }
  drainPage?: number
}
```

The merged program's Track B/B6 row, API Contracts and Phase 3 step 3 now preserve persistent event fields, use the N/N+1/N+2 address-job bridge and cite this expanded module-owned queue inventory. Its Known limits now records the actual failed-age lifecycle, and its final gate consumes G6's retained-copy evidence. Its carrier approval gate and closing step disclose assumption 8's retained queue copies, with no subject purge. Do not restore the earlier “three content queues” count or treat storage-time sealing as backlog migration.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Producer seals before old workers upgrade | Old workers fail; only enable after every worker can open and the legacy drain gate passes |
| N producer with pre-N worker | Address still present; mixed-version email/history jobs keep working |
| N+1 producer with N worker | Id shape accepted; address resolved in tenant/org scope |
| Key malformed or wrong length | Every producer/worker start refuses before any enqueue, even if new sealing is off |
| Key removed while envelopes remain | Existing jobs fail before handler; removal runbook requires complete zero-needed-key status evidence |
| Roll back to pre-N binary | Unsupported while envelopes remain; drain with N+ reader/key first, or keep the upgraded reader. Switching off only affects new writes |
| Key rotated twice before long delays drain | Older envelopes cannot open; preserve the old key and finish/drain its work before another rotation |
| Local parked copy promoted | Its own bound job id and sealed payload are preserved; only its handler opens it |
| Enqueue before registry readiness | Off stores as today without waiting or readiness refusal; on fails closed before storing with `SealedQueueRegistryNotReadyError` |
| Unknown or late provider queue | New registration after readiness refuses; declare in provider metadata and restart every process |
| No worker for a retired queue | Independent prune command can clean it; without worker/command there is no age bound |
| Age unset during bridge or explicit 0 | No age deletion of jobs or quarantines; count-only failed retention remains |
| Abandon report never succeeds | Spare past age within count cap; warn each sweep; command applies the same conservative rule |
| Corrupted file appears after startup | Recurring timer enforces eligibility on long-lived processes; deletion logs basename/age/bytes; unreadable envelopes prevent key-removal evidence |
| Erasure completes with queued subject content | Report temporarily retained copies under assumption 8; failed-age limits do not apply to full delayed/backlog lifetime |
| Removal by scope on sealed queue | Removes nothing and reports sealed scope unsupported; never return a false successful cancellation |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| Failed/quarantine age | N opt-in, unset 0 with next-minor warning; N+1 unset 168; explicit 0 remains count-only/no quarantine deletion |
| Address job types | N dual readers with old producers; N+1 id producers and dual readers; earliest N+2 decoder/type removal after backlog gate |
| Sealing | N readers/registry/codec, explicit opt-in after all readers upgrade and legacy drain; N+1 default on only with a valid key; explicit off honored |
| Existing stored plaintext | Never retroactively sealed; drain delayed/failed/parked work and prove zero unsealed copies before calling migration complete |
| Key removal/rollback | Keep opening keys/readers until complete scans show no envelopes need them; off is not key retirement |
| Sealing-on readiness (R5-5) | Opting into sealing requires full registry finalization before enqueue; otherwise enqueue now refuses before storage. Off-mode direct `createQueue`/`createModuleQueue` callers retain existing enqueue behavior without bootstrap; the refusal throws `SealedQueueRegistryNotReadyError` (`QUEUE_SEALED_REGISTRY_NOT_READY`) |
| Public contracts | Optional metadata and new exports/CLI; preserve factory signatures and frozen event fields; sealing-on readiness refusal is the disclosed behavior change above |

`UPGRADE_NOTES.md` and queue docs disclose R5-5's sealing-on readiness refusal, naming `SealedQueueRegistryNotReadyError` and its code, and the requirement to finalize full module metadata before enqueue, including direct factory callers opting into sealing; off-mode callers need no registry migration. They state the full N/N+1/N+2 ordering, defaults and explicit zero opt-out, exact prune/status commands, current/previous key validation and retention, required legacy-backlog drain, rollback limit, readable wrapper fields, quarantine recovery window and per-file warning, and the erasure retained-copy residual. Operations that scale workers to zero must schedule the independent prune command at least hourly or explicitly accept indefinite failed copies. The operational-pruners spec references this owner and must cite the bridge default rather than unconditional 168 (DEC-H remains that spec's separate history bridge; it is not redefined here).

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1, minor N | Report/apply retention with unset 0, quarantine timer/logs, independent maintenance/status commands; dual address-job readers and unchanged producers |
| 2, minor N | Frozen module-owned registry, validated keys, codec and all write/read paths; off by default; opt-in requires upgraded readers and legacy drain |
| 3, minor N+1 | Id-only producers after fleet prerequisite; age default 168 with explicit 0; sealing default on only where a valid key exists |
| 4, earliest N+2 | Remove deprecated address variants only after backlog evidence; keep envelope readers and required keys until every envelope is gone |

## 📋 Implementation Plan

### Phase 1 — Bounds and id-job bridge
1. **Characterize** current failed retention and both address job payloads in owning worker tests; capture wrapper/abandon acknowledgement behavior.
2. Re-inventory every queue name and producer/registration under `packages/*/src` against the table above; inspect every review entry's payload and record seal/exempt reasons. `sealed-queue-inventory.test.ts` fails for unreviewed producer names and any webhook registration whose queue is absent from module metadata. It explicitly covers `workflow-invoke-agent`, `stripe-webhook` and `channel_discord_interactions`. Preserve enterprise/provider ownership.
3. Add central age parsing/bridge warning, shared retention pass, every async worker's timer and independent report/apply command. `failed-job-retention.test.ts` tests unset/0/invalid under N and N+1, finishedOn eligibility, no-hook cleanup, multiple shrinking pages with kept offsets, invalid timestamps, conservative unknown retired-queue hooks, startup/close and removal/spared logs.
4. Add recurring local quarantine cleanup and command coverage. `local-quarantine-retention.test.ts` uses controlled mtime/clock for files created after start, 0/no-delete, restart-free expiration, warning fields, symlink refusal and timer close.
5. Add dual readers while keeping producers legacy in N; workers read their own records through scoped decrypted services. Worker tests characterize pre-N shape, N producer to pre-N reader and N+1 id shape to N reader, missing records and cross-scope refusal. Add bridge union types/deprecations and N+2 removal gate.
6. After C1 Phase 1/R3-2 and doctor Phase 3/DEC-I, add configs-owned doctor checks and tests for potential strategy/module use, on/off/unset, invalid current/previous key and both retention-default releases; update both env examples, docs and compatibility notes. Run template sync at implementation.

### Phase 2 — Sealing
1. **Characterize** raw stored payloads in both strategies. Add registry metadata/global symbol/readiness mechanism and owner declarations. `sealed-queues.bootstrap.test.ts` covers full versus i18n-only metadata, duplicate imports/package copies, a fresh child producer process with no worker DI side effects, sealing-on first-enqueue refusal before readiness without a storage write and late-name refusal. Test direct `createQueue` and `createModuleQueue` enqueues with effective sealing off and an unready registry under N unset, N+1 keyless unset and explicit off: they complete without metadata bootstrap, a registry-readiness wait or refusal. Assert the sealing-on refusal is `SealedQueueRegistryNotReadyError` with code `QUEUE_SEALED_REGISTRY_NOT_READY` and the queue name, that `instanceof` holds across a duplicate package copy, and that the message carries no payload data; then prove both strategies store sealed payloads after readiness. Finalize after DI registration in `packages/shared/src/lib/di/container.ts` and before worker/maintenance operations in the built-in queue CLI; test repeated request-container finalization with identical metadata. Register every provider override via the shared webhook hook without shared-to-queue imports.
2. Add codec and strict key validation. `envelope.test.ts` tests round-trip, fingerprint shape/known digest, no base64-key prefix leakage, bad base64/length, missing on-key, previous key, off-mode opening, unknown key and envelope transplantation between queue/job ids. No development derivation exists.
3. Seal in both strategy store paths and open copies before handler/abandon hooks. `stored-payload.test.ts` asserts persisted envelopes after acknowledgement, local retry, coalesced enqueue, promotion and finalization, including correct parked wrapper identity. Never persist opened objects.
4. Implement payload-status over every job state, local parked/quarantined copies and actual queue namespaces. Test zero-needed-key evidence, unreadable quarantine incompleteness, old delayed jobs staying plaintext after toggle, and no claim of atomicity while writers run. Update warranty queue-reading tests through `openStoredJob`.
5. Add real-Redis tests below using the existing queue harness, then module integration tests with fixtures and cleanup. Tests stop/park consumers before asserting storage and release a barrier before asserting processing; absence after auto-consumption is never evidence of sealing.
6. Update upgrade notes, docs and release tasks. Preserve the now-aligned program B6/API row, erasure `retainedCopies`, G6 `TC-PRIVACY-VERIFY-011` and doctor known-check list without redefining their owner contracts. Run `yarn generate` for module discovery metadata, never edit generated files.

### Phase 3/4 — Release gates
1. Verify every worker is at least N; then switch the two producers in N+1 and keep bridge unions/readers.
2. Flip only centralized age/sealing defaults, preserve explicit opt-outs, document existing plaintext backlog and require payload-status/key evidence per deployment.
3. Remove legacy job decoders no earlier than N+2 and only after all legacy copies drain. Archive this Delta if adopted.

### File manifest

| File | Action |
|---|---|
| `packages/queue/src/{sealed-queues.ts,lib/envelope.ts,lib/failed-job-retention.ts,lib/payload-status.ts,strategies/local.ts,strategies/async.ts,testing/*,index.ts}` | Create / modify reusable services, codec and guarded write/read paths |
| `packages/shared/src/{lib/queue/sealedQueues.ts,lib/di/container.ts,modules/registry.ts,modules/payment_gateways/types.ts}` | Create helper and `SealedQueueRegistryNotReadyError`; add optional metadata; webhook registration hook without domain imports |
| Owning module `index.ts` files listed in the inventory; provider `gateway_stripe/di.ts`, `channel_discord` bootstrap | Declare own sealed queues and idempotent registration; no provider names in queue package |
| `packages/cli/src/mercato.ts` and CLI queue tests | Add built-in prune/status subcommands; preserve worker commands |
| `packages/core/src/modules/messages/{subscribers/message-notification.ts,workers/send-email.worker.ts}`, communication channel Gmail route/worker | Dual job types/readers in N; producer switch in N+1 |
| `packages/core/src/modules/configs/privacy.ts`, module-owned locale files | Add doctor declarations to the existing/default privacy object without replacing its other members (R3-2); localized messages |
| Queue unit and Redis tests named below; owning module integration tests; `TC-WC-020`, `TC-WC-023` | Create / update with test storage-opening helper |
| App/template `.env.example`, `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, queue docs | Update bridge, drain/key/rollback and retained-copy requirements |

## 🧪 Integration Coverage

All tests own unique queue names/prefixes or temporary roots and fixture records; close clients/workers, release blocked handlers, obliterate only owned queues, delete created records/files and restore env/DI in `finally`. No seeded/demo data is required. Existing production ACL/scoping applies; no new UI or HTTP route is added.

| Test | Runner / paths | Assertions |
|---|---|---|
| `async.failed-job-retention.redis.test.ts` | Existing `QUEUE_TEST_REDIS_URL` harness, `yarn workspace @open-mercato/queue test:redis` | Real BullMQ/Redis: no-hook cleanup on quiet failures; over 300 failed jobs across shrinking pages; mixed acknowledged/unacknowledged abandoned jobs; finishedOn eligibility; no worker running when prune command applies; own queue teardown |
| `async.sealed-payload.redis.test.ts` | Same harness, real Redis stored job data and `updateData` | Park handler on a barrier, inspect envelope, release handler; abandon callback gets opened copy, acknowledgement leaves Redis payload sealed; off still opens; key/context mismatch refuses; actual delayed legacy copy remains plaintext and status sees it |
| `sealed-queues.cross-process.test.ts` and local store tests | Child process/package-copy bootstrap and temporary local root | Direct factory off-mode enqueue before readiness succeeds under both defaults/explicit off without waiting; on-mode enqueue before readiness refuses without storing; declarations loaded without producer DI side effects; provider custom queues and invoke-agent seal; all local write paths/parked identity preserve envelopes; quarantine expires after startup with logged recovery loss |
| TC-QUEUE-EMAIL-001 | Existing message create/send API and `messages-email` worker; Gmail webhook and history worker | Create owned message/channel fixtures with fake email/Gmail adapters; old and id jobs resolve the same scoped address; mixed-version bridge works; another scope cannot supply an address; cleanup records and work |
| TC-QUEUE-CONTENT-001 | Existing inbound channel/provider webhook routes, workflow invoke-agent path, persistent event dispatch | Own provider/channel/workflow fixtures with deterministic adapters; pause or barrier consumers, inspect storage for envelopes, then process and verify effects. Include registered `stripe-webhook` and `workflow-invoke-agent`; no live external provider |
| TC-QUEUE-ERASURE-001 | Existing privacy erase command, delayed/failed queue fixtures, payload-status/prune commands; G6 TC-PRIVACY-VERIFY-011 | Own marker-bearing delayed/failed plain/sealed jobs and a control tenant, park consumers before erasure and inspect surviving retained copies before cleanup. Assert `finishedOn` positive-age eligibility, missing/invalid timestamp and unacknowledged-abandonment exceptions, N/N+1 and explicit 0, worker-independent prune and no failed-age bound on delay/backlog. Keep normal async-index drains separate; production async/sealed scans remain not scanned; clean fixtures only after evidence |
| `TC-WC-020`, `TC-WC-023` | Existing warranty flows with stored events helper | Assert at least one owned queued envelope exists before opening it, then verify event fields through helper; no vacuous empty-file success |

The real-Redis harness already exists in `packages/queue/src/__tests__/async.coalescing.redis.test.ts`; CI supplies its URL on the shared test job. Fake BullMQ unit tests supplement these tests; they cannot replace them. Module tests use local strategy too, while Redis tests prove failed-job paging, finishedOn and acknowledgement storage behavior.

## 📝 Risks & Impact Review

#### Mixed versions break jobs
- **Scenario**: Sealed or id-only new jobs reach workers that cannot read them.
- **Severity**: High
- **Affected area**: Content queues, message email and Gmail sync.
- **Mitigation**: N dual readers with legacy producers; N+1 id producers; sealing only after upgraded readers and legacy drain. Mixed-version tests cover both directions.
- **Residual risk**: Operator ignores fleet prerequisite or rolls back before draining envelopes; keep N readers/keys until storage is clear.

#### Key changes strand delayed work
- **Scenario**: Key is malformed, removed with sealing off, or rotated twice while older jobs remain.
- **Severity**: High
- **Affected area**: Every sealed waiting/delayed/failed/parked job.
- **Mitigation**: Strict startup validation of both keys, independent open policy, previous key, complete per-key storage scan before removal and explicit rollback gate.
- **Residual risk**: Lost keys cannot be reconstructed; unreadable quarantines prevent proof of safe key removal.

#### Sealing is believed complete while content is clear
- **Scenario**: Registry not loaded, provider override omitted, or old jobs remain after toggle.
- **Severity**: High
- **Affected area**: Redis/local payloads.
- **Mitigation**: Under R5-5, sealing-on enqueues fail closed before storage until frozen full-metadata bootstrap, while off-mode enqueues keep existing behavior without registry waits/refusals. Late-name refusal, provider-owned declarations, inventory/cross-process tests, status/drain gate and configs-owned configuration check remain required.
- **Residual risk**: Unregistered third-party content, deliberately off mode, provider backups and operators who skip backlog evidence remain; doctor alone proves none of it.

#### Opened content is stored again or transplanted
- **Scenario**: Acknowledgement/retry writes an opened object, or valid ciphertext is moved to another queue/job.
- **Severity**: High
- **Affected area**: Content confidentiality and dispatch integrity.
- **Mitigation**: Copy-on-open, stored-form writes, authenticated inner queue/job identity, per-path local/real-Redis tests.
- **Residual risk**: New write paths must join the same tests; access to both storage and keys is outside this protection.

#### Failures or quarantines remain past the target age
- **Scenario**: No worker/operational command runs, age is 0, or an abandon report cannot be acknowledged.
- **Severity**: Medium
- **Affected area**: Failed queues and local recovery files.
- **Mitigation**: Every worker timer, independent command for actual retired queues, hourly operations runbook, recurring local timer and warning counts/deletion logs.
- **Residual risk**: Without a pass there is no age bound; unacknowledged jobs can survive within count cap. Deletion after the window permanently ends local recovery.

#### Erasure leaves queued copies
- **Scenario**: Production delayed/failed work still contains an erased subject after the database run.
- **Severity**: High
- **Affected area**: Erasure completion claims and retained data.
- **Mitigation**: Declare this retained set and actual lifecycle, test without draining evidence, and disclose it in the erasure report and the program's acceptance gate under assumption 8.
- **Residual risk**: No subject-scoped purge; delayed/backlog copies have no failed-age bound and legacy copies can be plaintext. Deployment acceptance must not call them absent.

#### Operators lose dashboard content
- **Scenario**: Investigating a stuck content job after sealing.
- **Severity**: Low
- **Affected area**: Operations.
- **Mitigation**: Queue name, wrapper job id, timestamps and existing trace/acknowledgement metadata stay readable; type and scope **inside the payload do not**. Status reports lifecycle and key counts without disclosing content.
- **Residual risk**: Content inspection requires existing authorized tooling or a separately reviewed follow-up; this spec adds no plaintext-show command.

## Final Compliance Report — 2026-11-16

Reviewed root/spec rules, queue/worker contract, shared module and dependency boundaries, events and frozen event contracts. No code was implemented and no application/Redis test was run; all named tests are delivery requirements.

| Rule | Status | Notes |
|---|---|---|
| Worker contract and retries preserved | Specified | Existing strategy timers plus operator maintenance; no new queue service or changed retry semantics |
| Encryption helpers | Specified | Existing shared AES-GCM; context checked inside authenticated plaintext; strict 32-byte key validation |
| Provider/module isolation | Specified | Module-owned metadata, shared dependency-free registry and provider-local declarations |
| Event payloads frozen | Compliant | No field removed; program row handed to its owner |
| Exported job-type bridge | Specified | Old/new unions and N/N+1/N+2 fleet/drain gates |
| Behavior-default bridge | Specified | Age deletion off for N, on by default N+1; explicit 0/off remain |
| R5-5 enqueue compatibility | Specified | Off-mode factories enqueue without registry waits/refusals; sealing-on readiness refusal throws `SealedQueueRegistryNotReadyError` and is disclosed and tested in both strategies |
| Tenant/org and editable entities | Specified | Id resolution stays scoped through owners; no new editable entity, so no optimistic-lock opt-out |
| Doctor ownership | Specified | Configs module declarations through DEC-I/R3-2; R3-4 remains owned elsewhere |
| Integration coverage | Specified | Self-contained real Redis, local/cross-process and affected module paths; no fake-only justification |
| Retained queue copies | Specified | Assumption 8 discloses them with no subject purge; accurate residual, carried by the erasure report and the program's acceptance gate |

**Verdict:** design settled. Sealing uses an explicit, validated `QUEUE_PAYLOAD_ENCRYPTION_KEY` (assumption 2); queue copies left after an erasure are disclosed, not purged (assumption 8); a sealing-on enqueue before readiness throws `SealedQueueRegistryNotReadyError` (R5-5). The merged program, erasure and verification specs carry the inventory/rollout and retained-copy evidence. Implementation requires the distinct stored-copy and index-drain evidence.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions. Departs from the program's one-line description, which assumed every job could carry an id; the required program correction is an owner handoff, not an edit made in this file.
- Revised after independent review. A `sealed` option at creation would have been missed in one of a queue's several creation points, so the initial revision used a list; council round two moves declarations into module metadata and freezes a shared bootstrap registry. The key is explicit, and switching sealing on without it is a start-up error: a derived key would have changed when another secret did, and been absent on installations that use a key service. Scope is no longer kept in the envelope. Event fields are not removed, which the compatibility rules forbid. Failed jobs are cleaned on a timer. Opening covers the abandon path and the coalesced copy. The new Playwright test is dropped because it could not fail. Bounds and ids ship first, with no key.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g6-04 and g5-07 — failed-job retention runs on a timer of its own in every async worker (at start, then hourly), with `queue.clean` where no abandon hook exists and a paged walk that spares unacknowledged abandoned jobs where one does; this spec is the single owner of the setting and default, and the pruner spec refers here; g6-09 — only `QueuedJob.payload` is sealed, the wrapper's id, creation time and metadata stay readable, opening produces a copy, and every write path keeps the sealed payload, with scenarios, unit tests and a risk.
- Council round two fixes (GPT-6.1 Sol workers): r2iqa-01 — complete invoke-agent/provider queue inventory and owner declarations; r2iqa-12 — real Redis retention/envelope tests; r2iqa-21 — legacy backlog drain and status gate; r2iqa-22 — strict keys and key-removal/rollback lifecycle; r2iqa-23 — retired-queue cleanup command and honest bound; r2iqa-24 — retained-copy default and erasure/program handoff; r2iqa-25 — configs-owned doctor checks; r2iqa-26 — frozen global bootstrap registry; r2iqa-35 — recurring quarantine cleanup; r2iqa-36 — exported job unions; r2iqa-41 — remove false program-edit claim and specify unowned row correction; g6-17 — age opt-in bridge/zero opt-out/logs; g6-27 — two-release producer/worker order; g6-32 — readable wrapper only; g6-40 — warn per quarantine deletion; g6-41 — authenticated queue/job identity; g6-42 — provider-local names; g6-43 — exact SHA-256 fingerprint. Nits: shrinking-page offsets advance over kept jobs; unnamed development derivation removed.

- Council round two fixes, pass two (GPT-6.1 Sol workers): Reconcile the merged program's now-preserved events and identify remaining inventory/rollout corrections; use exact ModuleInfo.sealedQueues and R3-2/DEC-I/R3-4/DEC-H names; preserve C1's full default object; align verifier-owned queue scanning with retained delayed/failed-copy evidence and erasure completion handoffs.

- Council round two fixes, pass three (GPT-6.1 Sol workers): Gate configs-owned declarations on C1 Phase 1/R3-2 and doctor Phase 3/DEC-I; link B6 TC-QUEUE-ERASURE-001 to G6 TC-PRIVACY-VERIFY-011 with parked plain/sealed copies, finishedOn/acknowledgement/zero exceptions and a separate index drain; reconcile the merged program and erasure retainedCopies handoffs.

- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): Apply R5-5 to preserve off-mode enqueue without registry readiness waits or refusals; disclose and test the sealing-on refusal across factories and strategies, with its exact named-error identifier recorded as an open design dependency.
