# Queue payloads: ids where possible, sealed where not, bounded when failed

> **Program:** package B6 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. About 25 of the 50 or more places that emit persistent events were read. What BullMQ itself stores about a failed job was not checked.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Background jobs are stored in Redis, or in a JSON file on disk, exactly as they were enqueued. Most carry only ids. Some carry content: an inbound message as the provider sent it, a payment provider's event, an email address, a workflow's data. One of them is the queue behind persistent events, so a webhook body that the database stores encrypted sits in the queue in clear. Failed jobs are kept by count with no age limit. **Proposed (future):** in two parts that ship separately. First, failed jobs and quarantined queue files get an age limit, and the two jobs that can carry an id instead of an address do so. Second, queues whose content exists nowhere else seal their payload with a configured key before it is stored.

**Not in this spec:** removing fields from event payloads, which the compatibility rules forbid and which sealing makes unnecessary at rest; encrypting Redis or the disk; what a worker does with the content after reading it; the scheduler's stored payloads.

## 📝 Overview

> **Market reference.** Sidekiq Enterprise and Rails' Active Job both recommend "pass ids, not objects" and offer encryption of job arguments for the cases where that is impossible; Sidekiq encrypts the last argument with a configured key and keeps the rest readable for its dashboard. BullMQ's own guidance is to bound failed jobs by age as well as count. Adopted: ids first, a sealed payload beside a readable scope, an age bound. Rejected: persisting every inbound payload in a table first just so a job can carry an id — a second copy to protect and expire.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | The program says "ids, not content" for four jobs | Ids for the two where the content is already in a table; sealing for the rest | The program's wording was written before the jobs were read. Inbound messages, provider events and persistent events are not stored anywhere before the worker runs. |
| 2 | Key for sealing | An explicit `QUEUE_PAYLOAD_ENCRYPTION_KEY`. Sealing switched on without it is a start-up error. A derived key is allowed outside production only | ⚠ NEEDS HUMAN CONFIRMATION. A key derived from another secret changes when that secret is first set or rotated, and an installation that keeps its keys in a key service has no such secret at all — sealing would then be silently off. |
| 3 | Rollout | Workers learn to open sealed payloads in one release; an operator switches sealing on when every worker has it; it becomes the default, where a key is configured, in the next | A producer that seals before every worker can open would fail jobs during a rolling deploy. |
| 4 | Which queues are sealed | A list of names kept in the queue package, which both strategies consult | A queue is created in many places — the workflow queue in four, the events queue in three, and again by each worker. An option on creation would be forgotten in one of them and write in clear without a sound. |
| 5 | Removal by scope on a sealed queue | Not supported | Its only two callers cancel search reindexing, on queues that are not sealed; and sealed payloads keep their scope in different places. |
| 6 | Failed-job age | Seven days | Long enough to investigate, short enough to mean something. |

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
| `communication-channels-inbound`, `…-reactions` | The provider's message or reaction as received | No: not stored before the worker runs |
| `payment-gateways-webhook`, `shipping-carriers-webhook` | The provider's event data | No: only a key and a type are stored |
| Discord interaction dispatch | The interaction, including its reply token | No |
| `workflow-activities` | Step configuration with values filled in, and the workflow's context | Partly: the context is on the instance; the filled-in configuration exists only in the job |

**Persistent events that carry content**

| Event | Content |
|---|---|
| `messages.message.sent` | An outside email address |
| `inbox_ops.email.received` | The forwarding address and the subject |
| `webhooks.inbound.received` | The whole inbound body — which `webhook_ingestions` stores encrypted |
| Workflow milestone | A step's output data |

Wildcard subscribers use an event's payload as their content: the outbound webhook sends it as its body, and workflow triggers, business rules and the enterprise process triggers read it. The compatibility rules also forbid removing a field from an existing event's payload (`BACKWARD_COMPATIBILITY.md:165`). So events are protected by sealing their queue, not by thinning them.

**Facts the design must respect**

- **A queue has no single creation point.** `workflow-activities` is created in four files, `events` three times in `packages/events/src/bus.ts:384-397`, and each worker creates its own instance (`packages/queue/src/worker/runner.ts:177`). `createModuleQueue` forwards only a fixed set of options (`packages/queue/src/factory.ts:84-104`).
- **Stored payloads have other readers.** A job abandoned after its last attempt is handed to `onJobAbandoned` with its data (`strategies/async.ts:261-323`); the local strategy keeps a second copy for coalesced jobs (`local.ts:596-610`); two integration tests parse the events queue file (`warranty_claims/__integration__/TC-WC-020-sla-escalation.spec.ts:173-189`, `TC-WC-023-quarantine.spec.ts:57-73`).
- **Removal by scope** reads top-level `tenantId`, `organizationId` and `jobType` from a payload (`async.ts:134-145`; `local.ts:66-76`). It has two callers, both cancelling search reindexing.
- **The shared encryption library has no key derivation**, and its AES helper takes a 32-byte base64 key (`packages/shared/src/lib/encryption/aes.ts:80-82`).
- **The integration environment runs workers automatically**, so a queued job is usually consumed before a test can look at the file.

## 📝 Proposed Solution

### Part 1 — Bounds and ids (no key needed)

- **Failed jobs.** The BullMQ strategy removes failed jobs older than `QUEUE_FAILED_JOB_RETENTION_HOURS` (default 168) on the sweep timer it already runs, as well as keeping at most the existing count. Trimming only when another job fails would leave a quiet queue untouched.
- **Quarantined files.** Local queue files set aside as corrupted are deleted after the same age when the queue starts.
- **`messages-email`** carries the message id; the worker reads the outside address from the message.
- **The Gmail history job** drops the mailbox address; the worker reads it from the channel.

Both workers accept the old shape for one release, so jobs queued before an upgrade still run.

### Part 2 — Sealing

**Which queues.** The queue package keeps the list of sealed queue names: `events`, the two inbound channel queues, the two provider webhook queues, the Discord interaction queue and `workflow-activities`. A third-party package adds its own with `registerSealedQueue(name)`. Both strategies look the name up when a job is stored; no call site passes anything. A unit test fails if a first-party module creates one of those names through anything but the queue factory.

**The envelope.** Before a job in a sealed queue is stored, its data is replaced by `{ sealed: 1, keyId, data: <ciphertext> }`, encrypted with the shared AES helper. `keyId` is a short fingerprint of the key.

**Opening.** A sealed job is opened wherever stored data is handed to code: before the handler, before `onJobAbandoned`, and in the local strategy's coalesced copy. A worker opens a sealed job whatever the setting, and passes an unsealed one through.

**The setting.** `QUEUE_SEAL_PAYLOADS` is `off`, `on` or unset.

| Release | Unset means | `on` without a key |
|---|---|---|
| First | Off | A start-up error for every process that enqueues or works |
| Next | On when a key is configured, off otherwise | The same |

**The key.** `QUEUE_PAYLOAD_ENCRYPTION_KEY`, 32 bytes in base64. `QUEUE_PAYLOAD_ENCRYPTION_KEY_PREVIOUS` is tried when a job's `keyId` does not match the current key, so that delayed jobs survive a rotation. Outside production, and only there, a missing key is derived from the application secret so that development needs no setup.

**Tests.** A helper in the queue package's test utilities opens stored jobs, for the tests that read queue files.

### Design decisions

| Decision | Rationale |
|---|---|
| Sealed queues are a list of names | See assumption 4. |
| Nothing but the ciphertext, a version and a key fingerprint in the envelope | Scope lives in different places in different payloads, and nothing needs it on these queues. |
| A key fingerprint | A job sealed under a key that has since changed fails with a message that says so, instead of a parse error. |
| An explicit key, and an error when it is missing | See assumption 2. |
| Events are sealed as a queue, not thinned one by one | Their payloads are what subscribers deliver, and their fields may not be removed. |
| Age-based cleanup on a timer | A bound that depends on another failure happening is not a bound. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A `sealed` option where a queue is created | See assumption 4. |
| A key derived from the lookup secret | See assumption 2. |
| Store inbound payloads in a table and enqueue the id | A second copy with its own retention, for every provider. |
| Per-tenant keys | A job may have no tenant, and a key-service call on every enqueue. |
| Seal every queue | Most carry only ids; sealing them hides nothing and blinds the dashboard for all of them. |
| Remove the address from `messages.message.sent` and `inbox_ops.email.received` | Forbidden for an existing event; another module reads one of them; and the same worker re-emits the address in two further events. |
| Rely on Redis encryption at rest | A deployment decision the product cannot check; the local strategy has no equivalent. |

### Known limits

- A sealed job is readable by anyone who also holds the key.
- Job ids, timing and queue names remain visible.
- The BullMQ dashboard shows an envelope for sealed queues.
- Sealed queues cannot be cleared by scope.
- Event payloads still carry what they carry; anything that receives an event — an outbound webhook, a trigger — receives it in clear.

## 📝 Delta

### Capability: queue-payload-protection

#### MODIFIED Requirement: Failed-job retention
The system SHALL remove failed jobs older than the configured age, whether or not another job fails.

##### Scenario: Old failure on a quiet queue
- WHEN a job failed longer ago than the configured age and nothing else has failed since
- THEN it is no longer in the failed set after the next sweep

Frozen by: `packages/queue/src/__tests__/failed-job-retention.characterization.test.ts`

#### MODIFIED Requirement: Content in the two address-carrying jobs
The system SHALL carry an id instead of an address in the message email job and the Gmail history job.

##### Scenario: Message email
- WHEN a message to an outside address is queued for sending
- THEN the job holds the message id and no address, and the email is sent

##### Scenario: A job queued before the upgrade
- WHEN a job in the old shape is processed
- THEN it is processed

#### ADDED Requirement: Sealed queues
The system SHALL NOT store a job's content in readable form in a sealed queue when sealing is on.

##### Scenario: Inbound message
- WHEN an inbound channel message is enqueued with sealing on
- THEN the stored job is an envelope containing no part of the message text, and the worker processes it as before

##### Scenario: Every creation point
- WHEN any code enqueues to a queue whose name is on the sealed list
- THEN the stored job is an envelope

##### Scenario: Mixed versions
- WHEN a worker that can open sealed jobs meets an unsealed one
- THEN it processes it

##### Scenario: Key changed
- WHEN a job was sealed under a key that is neither the current nor the previous one
- THEN it fails with an error naming the key mismatch

##### Scenario: On without a key
- WHEN sealing is switched on and no key is configured, in production
- THEN the process refuses to start and names the variable

Frozen by: `packages/queue/src/__tests__/stored-payload.characterization.test.ts`

## 📝 Architecture

- **`packages/queue`**: the sealed-name list and `registerSealedQueue`; the envelope codec; seal-on-store and open-on-read in both strategies, including the abandon path and the coalesced copy; the timed cleanup of failed jobs; quarantine cleanup; a test helper that opens stored jobs.
- **`packages/shared/src/lib/encryption`**: nothing new; the existing AES helper is used with the configured key.
- **`messages`**, **`communication_channels`**: the two thinner jobs.
- **Start-up check**: sealing on without a key is refused where the key guard already checks service start.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Queue → key | Environment | Sealing off: stored as today |
| Third-party queues | `registerSealedQueue` | Unchanged |
| Tests that read queue files | The opening helper | — |

## 📝 Data Models

No table. The stored shape of a job in a sealed queue changes to the envelope. No event payload changes.

## 📝 API Contracts

- **`@open-mercato/queue`** exports `registerSealedQueue(name)` and, under its test utilities, `openStoredJob`. Additive.
- **Settings**: `QUEUE_SEAL_PAYLOADS`, `QUEUE_PAYLOAD_ENCRYPTION_KEY`, `QUEUE_PAYLOAD_ENCRYPTION_KEY_PREVIOUS`, `QUEUE_FAILED_JOB_RETENTION_HOURS`, in both `.env.example` files.
- **Doctor check**: content-carrying queues in use with sealing off.
- No event, route or type changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Producer seals, an old worker cannot open | The job fails and is retried; avoided by switching on only after every worker is upgraded |
| Key rotated with jobs in the queue | Opened with the previous key. A job older than two rotations fails with the mismatch error |
| A key service holds every other secret | The queue key is still an environment variable; the docs say so |
| A sealed job abandoned after its last attempt | The abandon handler receives the opened data, as it does today |
| A corrupted local queue file | Still quarantined; deleted after the age bound |
| A handler that logs its payload | Out of scope; the logger redaction package covers logs |
| Removal by scope called on a sealed queue | Removes nothing and reports that the queue is sealed |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| Failed-job age bound | Behaviour change for BullMQ: failed jobs older than seven days disappear. Dated entry |
| Two job payloads carry ids | Internal; the worker accepts both shapes for one release |
| Sealed list, envelope, settings | Additive; off unless switched on, for one release |
| Sealing on by default where a key is configured | Ordinary protocol: announced in the first release, default in the next, `off` still honoured |

## 📋 Phasing

| Phase | Outcome | Ships alone |
|---|---|---|
| 1 | Failed-job age, quarantine cleanup, ids for the two jobs | Yes |
| 2 | Envelope and opening everywhere; the sealed list; nothing sealed unless switched on | Yes |
| 3 | The default, one release later | Release task |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** that an old failed job stays in the failed set. Commit alone.
2. Timed cleanup of failed jobs by age; quarantine cleanup. Unit tests, including a queue where nothing else fails.
3. `messages-email` and the Gmail history job: ids; workers accept the old shape. Unit tests for both shapes.
4. Both `.env.example` files; the dated entry.

### Phase 2
1. **Characterize** that a stored job contains its payload as given, in both strategies. Commit alone.
2. The envelope codec with unit tests: round trip, wrong key, previous key.
3. The sealed-name list and seal-on-store in both strategies; opening before the handler, in the abandon path and in the coalesced copy. Unit tests for each, and for a queue holding both forms.
4. The start-up check; the guard test for creation points; the test helper. Update the two warranty tests to use it.
5. The doctor check; `UPGRADE_NOTES.md`; the queue docs page; the tracking issue for the default.
6. Archive this Delta into `.ai/specs/capabilities/queue-payload-protection.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/queue/src/{sealed-queues.ts,lib/envelope.ts,strategies/local.ts,strategies/async.ts,testing/*}` and tests | Create / modify |
| `packages/core/src/modules/messages/{subscribers/message-notification.ts,workers/send-email.worker.ts}`; the Gmail webhook route and worker | Modify |
| `packages/core/src/modules/warranty_claims/__integration__/TC-WC-02{0,3}-*.spec.ts` | Modify |
| The service-start check beside the key guard's | Modify |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| The existing integration suite, run with sealing on | Inbound channel messages, provider webhooks, workflows and persistent events all still work. The integration environment sets the setting and a key for every run |
| `TC-WC-020`, `TC-WC-023` (existing, updated) | Read the events queue file through the opening helper, and so also assert that what is stored is an envelope |

No new Playwright test is added for the stored form. Workers run automatically in the integration environment, so a test that looked for the absence of a marker in the queue file would pass whether or not sealing worked. The stored form is asserted in the queue package's own tests against a temporary directory, and in the two tests above.

## 📝 Risks & Impact Review

#### Jobs fail during a rolling deploy
- **Scenario**: New producers seal while old workers are still running.
- **Severity**: High
- **Affected area**: every sealed queue
- **Mitigation**: Opening ships a release before sealing is the default; the setting is explicit.
- **Residual risk**: An operator who turns it on early across a mixed fleet.

#### A key change strands delayed jobs
- **Scenario**: Workflow timers sealed weeks ago meet a new key.
- **Severity**: High
- **Affected area**: workflows
- **Mitigation**: The previous-key setting; the mismatch error names the cause.
- **Residual risk**: A key replaced twice within one delay.

#### Sealing is believed to be on and is not
- **Scenario**: An operator sets a key and never switches the setting on in the first release, or a third-party queue with content is not on the list.
- **Severity**: Medium
- **Affected area**: content at rest in the queue
- **Mitigation**: The doctor check; the default in the following release.
- **Residual risk**: Third-party queues their authors did not register.

#### Operators lose sight of job contents
- **Scenario**: Debugging a stuck inbound message through the BullMQ dashboard.
- **Severity**: Low
- **Affected area**: operations
- **Mitigation**: Type and scope stay readable; a `mercato queue show <queue> <job>` command that opens one job for an operator is left for a follow-up if asked for.
- **Residual risk**: Accepted.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/events/AGENTS.md` (through the research), `BACKWARD_COMPATIBILITY.md` for event payloads.

| Rule | Status | Notes |
|---|---|---|
| Background work through the worker contract; no custom queues | Compliant | An option on the existing queue |
| Never hand-roll crypto | Compliant | The shared encryption library |
| Event payloads unchanged | Compliant | No field is removed |
| Behaviour-changing default follows the protocol | Compliant | Two releases |
| Template sync for env vars | Compliant | Named |
| Ask before touching multiple modules | Needs approval | The queue package, two modules for the job ids, two test files |
| Integration coverage | Partly | One test; the rest unit-tested for the reason given |

**Verdict:** approved for Phase 1. Phase 2 is subject to assumption 2.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions. Departs from the program's one-line description of this package, which assumed every job could carry an id; the program is corrected with it.
- Revised after independent review. A `sealed` option at creation would have been missed in one of a queue's several creation points, so sealed queues are a list of names in the queue package. The key is explicit, and switching sealing on without it is a start-up error: a derived key would have changed when another secret did, and been absent on installations that use a key service. Scope is no longer kept in the envelope. Event fields are not removed, which the compatibility rules forbid. Failed jobs are cleaned on a timer. Opening covers the abandon path and the coalesced copy. The new Playwright test is dropped because it could not fail. Bounds and ids ship first, with no key.
