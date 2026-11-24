# Enterprise queue providers

Extends: .ai/specs/2026-09-08-queue-job-coalescing.md
Extends: .ai/specs/implemented/2026-05-07-lazy-auto-spawn-queue-workers.md

## 📝 TLDR

Enterprise deployments can currently run background jobs on local files or Redis-backed BullMQ. This proposal adds RabbitMQ, Amazon SQS Standard, Azure Queue Storage, and Google Cloud Pub/Sub as opt-in transports for qualified queues. The shared queue package provides routing and worker lifecycle, and the Enterprise package owns all four adapters and their dependencies.

## Resolved assumptions (autonomous defaults)

| # | Question | Default and rationale |
| --- | --- | --- |
| Q1 | Separate specs or one design? | Use one spec for the shared contract and four independently gated driver phases. A deployment can adopt any qualified driver on its own. |
| Q2 | Which Azure and Google services? | Use Azure Queue Storage and Pub/Sub pull subscriptions. Queue Storage matches the Azure request and Pub/Sub matches the existing feature request and pull-worker model. |
| Q3 | Which queues switch? | Use one explicitly selected Enterprise provider and an allowlist of qualified queue names per deployment. This makes gradual adoption and rollback possible and limits exposure to provider differences. |
| Q4 | Emulate missing broker features? | Use broker capabilities where supported and reject incompatible routing or operations explicitly. Defer a general-purpose delay store, cross-provider job inspection, and recurring scheduler changes. |
| Q5 | What qualifies a driver? | Require a real containerized RabbitMQ broker, and local emulator coverage plus hosted sandbox acceptance for SQS, Azure, and Pub/Sub. Require explicit authorization for hosted test resources. |

## 📝 Overview

Deployments that already operate a supported broker can use it for qualified job queues while retaining the existing transport for the rest. The first release supports one Enterprise transport per deployment, with a documented list of qualified queue/provider pairs. The example module's existing todo bulk-complete flow (`example-todos-bulk-complete`) is the first in-app qualification case. Custom module workers can opt in through the same contract after checking their producer, lifecycle, and payload requirements.

[Enterprise queue feature request #9343](https://github.com/open-mercato/open-mercato/issues/9343) covers three brokers, dead-letter handling, scheduler changes, and SSE replay. This spec covers the transport and dead-letter work, adds Azure Queue Storage, and leaves recurring scheduler redesign and SSE replay with that broader request. All four drivers live in `packages/enterprise` as requested for this work. Existing queue status UI, tenant-level queue inspection, and a unified purge or cross-broker migration tool are outside this release.

## 📝 Problem Statement

| Area | Current code | Consequence for a new transport |
| --- | --- | --- |
| Producer and public types | [Queue types](../../../packages/queue/src/types.ts), [factory](../../../packages/queue/src/factory.ts) | `QueueStrategyType`, `Queue.strategy`, and explicit factory overloads describe local/BullMQ. The module factory's transport options are borrowed from BullMQ. A new string alone falls through to local. |
| Worker lifecycle | [Worker runner](../../../packages/queue/src/worker/runner.ts), [CLI](../../../packages/cli/src/mercato.ts), [worker supervisor](../../../packages/cli/src/lib/queue-worker-supervisor.ts), [pending probe](../../../packages/queue/src/pending-probe.ts) | Runner, probes, and CLI branch independently on the built-ins. A producer can publish successfully while the worker consumes from the wrong backend. Direct CLI clear/status also assume a built-in. |
| Producers outside the module factory | [Webhook dispatch](../../../packages/webhooks/src/modules/webhooks/lib/queue.ts), [checkout emails](../../../packages/checkout/src/modules/checkout/lib/emailQueue.ts), [payment webhook](../../../packages/core/src/modules/payment_gateways/api/webhook/%5Bprovider%5D/route.ts) | Some producers start local processing inline or build queues explicitly. These paths need deliberate qualification before external routing, even if their worker is auto-discovered. |
| Events and scheduler | [Event bus](../../../packages/events/src/bus.ts), [core bootstrap](../../../packages/core/src/bootstrap.ts), [scheduler DI](../../../packages/scheduler/src/modules/scheduler/di.ts) | Persistent subscriber delivery has its own selection and fallback. Scheduler repeatables and execution inspection depend on BullMQ. Treat these as reserved routes. |
| Workload-specific semantics | [Queue types](../../../packages/queue/src/types.ts), [data-sync worker](../../../packages/core/src/modules/data_sync/workers/sync-import.ts), [coalescing spec](../2026-09-08-queue-job-coalescing.md) | Callers may require delay, scoped job removal, or abandonment reconciliation. Native deduplication can discard work that must run again after an active job. |

The built-in lazy worker design probes for ready work before spawning. The existing probe and supervisor still implement that for local and BullMQ. Enterprise queues need an eager worker because approximate counts can report zero while jobs are available. The coalescing contract already permits executing every trigger on a backend without lossless coalescing, so Enterprise can preserve correctness by enqueueing each request.

## 📝 Proposed Solution

Add an internal transport seam with capabilities for publishing, consuming, and releasing resources. Route named queues through it from module producers, workers, and CLI operations. Register a single Enterprise driver through the active Enterprise application composition, using process-level configuration and an immutable route map.

Celery illustrates why worker delivery, monitoring, and remote control need separate capabilities. Its brokers support different subsets of operations. This proposal adopts explicit capabilities and provider runbooks. A result store and remote worker control would add infrastructure that job delivery does not require. [Celery broker support](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/index.html)

## 📝 Delta

### Capability: enterprise-queue-providers

#### ADDED Requirement: Explicit Enterprise queue routing

An activated Enterprise deployment SHALL route each explicitly configured and qualified queue to the same selected transport in its producer and worker processes.

##### Scenario: Mixed deployment

- WHEN the example todo bulk-complete queue is qualified and assigned to an Enterprise provider and the events queue uses BullMQ
- THEN a bulk job reaches its Enterprise worker and the events worker continues consuming its own BullMQ queue

##### Scenario: Invalid or unavailable provider

- WHEN a named queue requests a missing, unqualified, or unreachable Enterprise transport
- THEN invalid configuration or failed broker readiness is surfaced for that path and the producer and worker avoid local or BullMQ fallback

#### ADDED Requirement: Safe settlement and dead-letter recovery

Enterprise adapters SHALL acknowledge successful jobs, permit redelivery after interrupted work, and expose a documented path to isolate and redrive failed jobs.

##### Scenario: Worker loss and poison handling

- WHEN a worker is stopped before settlement or a payload repeatedly fails
- THEN interrupted work can be processed again and poison work reaches the provider's configured dead-letter destination without blocking healthy messages

##### Scenario: Operator redrive

- WHEN an operator redrives a recoverable job after correcting the failure
- THEN the job returns to its associated source queue with its original Mercato job ID and a fresh delivery budget

#### ADDED Requirement: Explicit limitations

Enterprise routing SHALL reject incompatible queue requirements and surface unsupported administrative operations.

##### Scenario: Unsupported delayed workload

- WHEN a queue requiring future delivery is assigned to a transport without a compatible delay
- THEN startup rejects the assignment, and an unexpected delayed enqueue also fails before publication

##### Scenario: Unsupported counts or clear

- WHEN an operator requests complete counts or clear on an Enterprise queue without that capability
- THEN the CLI reports the unavailable operation or fields for the selected provider and avoids a destructive fallback

## 📝 Architecture

### Selection and composition

- Keep `QUEUE_STRATEGY` as the built-in baseline. Add two server-only Enterprise settings: `OM_ENTERPRISE_QUEUE_PROVIDER` selects the provider and `OM_ENTERPRISE_QUEUE_ROUTES` is a JSON object keyed by exact logical queue name. Each route names its source and dead-letter resources. Pub/Sub also needs the work and DLQ subscription names, and SQS needs a separate quarantine queue. Provider-specific topology and credentials are validated by the selected driver. Use a secret reference or SDK credential chain for credentials and keep them out of the route map. Proposed provider IDs are `rabbitmq`, `sqs`, `azure-queue-storage`, and `gcp-pubsub`. Enterprise settings supplied without Enterprise activation fail validation. Detect a new provider ID mistakenly entered in `QUEUE_STRATEGY` and report the Enterprise setting to use. Keep the baseline behavior for legacy values. Unset Enterprise settings use the existing startup and resolution paths.
- Keep `Queue<T>`, `QueueStrategyType`, the explicit `createQueue(name, 'local' | 'async', …)` overloads, worker metadata, and handler contracts stable. Introduce a separate internal resolved transport and a routed factory for managed callers. Keep the legacy built-in constructor and strategy getter available. Keep the routed transport identity separate from the legacy `Queue.strategy` field so external deliveries are never reported as a built-in strategy. Move the supported producer path and `runWorker` to the same routed factory. Preserve explicit built-in worker overrides and reject overrides that conflict with an opted-in queue route. Any generic queue seam belongs in `@open-mercato/queue`. Provider code and SDKs belong under `packages/enterprise`, selected via the server-side Enterprise composition. Candidate SDKs are `amqplib`, `@aws-sdk/client-sqs`, `@azure/storage-queue`, and `@google-cloud/pubsub`. Make provider SDKs optional peers of Enterprise and use them as development dependencies for Enterprise tests. Install only the selected SDK in a consuming deployment. Keep it behind lazy server imports that are external to app bundling. Verify installation and runtime with Enterprise absent, packaged but inactive, and active with only one provider SDK installed.
- Validate the route map in web and CLI bootstraps, including standalone web startup and explicit worker commands, before those paths use provider clients. Resolve lazily when a module constructs queue handles at import time. Reject changed route maps in a running process. Initialize clients only for the selected provider. Reject duplicate canonical source resources, reused Pub/Sub topics, and source/DLQ aliasing. Report the effective route by logical queue with a fingerprint of the canonical provider and resource identities, excluding credentials. Document how to compare the effective route across processes before admitting traffic.
- Qualify a queue only when all of its producers use that route, its consumers use the normal worker registry and per-job DI, and the driver covers its required capabilities. Seed the supported list with the example bulk-complete queue and cover its existing public flow. Keep the scheduler-driven `example-todos-bulk-dispatch` recovery queue on the built-in transport and route its republish of the execution job through the qualified producer. Document the registration and qualification path for custom module workers. Reject activations for unmatched routes, reserved event/scheduler queues, direct built-in producers, or required capabilities the driver cannot preserve. A scheduled job can target a qualified queue only when its producer has been migrated to the same routing seam and covered by integration tests.
- Use explicit `mercato queue worker <name>` and `mercato queue worker --all` for Enterprise queues. When an existing supervisor is configured, start opted-in workers eagerly and supervise their restart with bounded backoff, even at zero reported backlog. For a mixed `worker --all` start, a startup failure closes consumers already opened by that process and exits non-zero. The supervisor retries when enabled. Built-in-only startup maintains its current behavior. Preserve worker concurrency limits and the `worker --all` DB connection budget across all selected queues. Preserve per-job request context and cleanup on each delivery.

### Envelope, settlement, and operations

- Persist a versioned broker envelope containing the logical queue, application job ID, creation time, payload, and supported metadata. Generate an opaque job ID before publish and preserve it across broker retries and redrive. Pass the existing job and context shapes to handlers, with a 1-based delivery attempt derived from the best available provider counter. Keep envelope versions readable during a rolling deploy. Validate queue, envelope, and encoded size before dispatch. Handle invalid envelopes through dead-lettering or quarantine without invoking business logic. Preserve tenant and organization identifiers in the payload, and enforce scope in the handler as today. Broker resources are deployment-scoped. Producers, consumers, and separately authorized operators use distinct access policies where supported.
- Resolve enqueue after broker acceptance. Apply bounded timeouts to connection and publish. A lost publish response may leave the outcome uncertain. Report it as such and make no exactly-once or cross-database transaction promise. Acknowledge only after handler success. Handler errors follow provider retry policies. Renew leases where applicable and serialize renewal with settlement so the latest receipt is used. On lease loss, avoid a stale acknowledgement and allow redelivery. The worker must remain idempotent even after a side effect succeeded and the acknowledgement was lost.
- Cap consumer prefetch and dispatch at the resolved concurrency. On shutdown, stop fetching, drain for a bounded grace period, and release unsettled work for redelivery. On startup, invalid settings or topology fail explicitly. An unavailable broker prevents the affected worker from reporting ready and causes routed enqueue to fail within its bound. Existing supervisor mode can retry worker startup. On disconnect, resume consumption after bounded, jittered retries or exit for supervision. Keep failure logs and telemetry free of payloads, credentials, receipt handles, and unredacted provider URLs.
- Treat retry thresholds and delivery counts as provider-specific. Measure DLQ and redrive with a broker-backed test. Redrive uses a restricted operator identity and returns a recoverable envelope to the source paired with the DLQ in trusted deployment configuration. Validate the envelope's logical queue against that pairing before publication. For manual receive/publish redrive, acknowledge the DLQ source only after destination acceptance. A crash between the two can produce duplicates with the same job ID. Leave malformed envelopes quarantined. Expose operator instructions and observable telemetry for publish, delivery, retries, lease loss, dead-letter movement, and redrive. Use provider dashboards or tooling for inspection and keep payload access restricted.
- Keep `clear`, complete counts, and scoped removal available through existing surfaces where supported. For Enterprise routes, disallow `clear` and scoped deletion in v1, report the limitation explicitly, and fence any reinstall/reset path that would otherwise treat the selected queues as cleared. The reset fence runs after environment resolution and before connecting for destructive database work or flushing Redis. Serve only available, labeled signals from Enterprise CLI status and never substitute zero for an unknown number. Keep built-in dashboard and purge paths from presenting Enterprise queues as empty or wiping unrelated resources. The legacy numeric counts contract stays applicable to built-in queues.

## 📝 Data Model

No database entities, migrations, or credentials tables. The broker envelope and source/dead-letter topology are the new durable data. Set source/DLQ retention, size, and ownership limits in deployment configuration. Document payload residency, at-rest encryption, retention, and least-privilege access for each broker.

## 📝 Migration & Backward Compatibility

Existing built-in installations need no migration. An Enterprise cutover pauses every producer of the opted-in queue, including recovery dispatchers, and drains or reconciles ready, leased, delayed, and dead-letter work. Restart producers and workers with the same map, check route fingerprints and worker readiness, then resume producers. Roll back by repeating the same procedure in reverse. Jobs stay in their original transport until processed or explicitly reconciled.

## 📝 API Contracts

No new HTTP endpoints. Existing in-app APIs and handlers retain their request, response, and payload contracts. Enterprise queue routing and capability diagnostics are deployment and CLI interfaces. Report logical queue names and redacted errors for unsupported delay, payload limit, unavailable transport, and unsupported administration. CLI status exits successfully when it can report the provider's available metrics and marks unavailable fields explicitly. Invalid configuration, broker connectivity failure, and an attempted Enterprise clear return a non-zero exit code. A delayed enqueue is accepted only when a documented native limit covers it and it will become available at or after the requested delay. Round fractional seconds up where the provider uses integer seconds. Drop no enqueues to simulate coalescing.

| Transport | Delivery and failure | Delay and verification |
| --- | --- | --- |
| RabbitMQ AMQP 0-9-1 | Durable quorum queues, persistent messages, mandatory confirmed publish with return handling, bounded prefetch, and manual settlement. On RabbitMQ 4.3, use per-delivery reject with requeue for handler failures that count toward the delivery limit and use the acquisition count for the handler's attempt context. Use delivery-limit and at-least-once dead-lettering with checked quorum topology. Redrive with confirmed republish before acknowledging the DLQ delivery. [Publisher confirms](https://www.rabbitmq.com/docs/confirms), [quorum queues](https://www.rabbitmq.com/docs/quorum-queues) | Immediate enqueues in v1. Pin a real RabbitMQ image in CI with Docker or `RabbitMQContainer`. Verify the exact TLS/topology and redelivery configuration supported by the driver. [Testcontainers RabbitMQ](https://node.testcontainers.org/modules/rabbitmq/) |
| Amazon SQS Standard | Long-poll receives with bounded visibility extension, delete on success using the current receipt, and broker redrive policy. Transfer malformed envelopes to a separate quarantine queue before deleting the delivery. Use selective manual transfer when a DLQ may contain mixed validity, including after failed quarantine transfer. Use native queue-wide redrive only on an isolated DLQ known to contain recoverable envelopes during a maintenance window. Use configured queue URLs and AWS SDK credential chain. [Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html), [DLQ redrive](https://docs.aws.amazon.com/en_en/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html) | Native per-message timers up to 15 minutes. Run LocalStack plus an explicitly authorized disposable AWS account/role sandbox. Hosted evidence must include IAM, visibility renewal, DLQ movement, native redrive, and continued isolation of quarantined messages. [SQS timers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-timers.html), [LocalStack SQS](https://docs.localstack.cloud/aws/services/sqs/) |
| Azure Queue Storage | Poll with bounded backoff. Renew message visibility and keep the latest pop receipt for deletion. Once the dequeue threshold is reached, publish to a dedicated poison queue before deleting the original. A transfer failure preserves the original for another attempt. Use Entra workload identity in hosted acceptance. [Update Message](https://learn.microsoft.com/en-us/rest/api/storageservices/update-message) | Native initial invisibility up to the provider and message TTL limit. Validate the encoded 64 KiB limit, including Base64 overhead when used. Run Azurite and a hosted sandbox for identity, receipt renewal, poison transfer and redrive. [Put Message](https://learn.microsoft.com/en-us/rest/api/storageservices/put-message), [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-install-azurite) |
| Google Cloud Pub/Sub | One topic and one shared pull subscription per logical queue with a dedicated dead-letter topic and inspection subscription. Bound flow control and ack deadline extensions. Configure service-agent permissions on source and dead-letter resources. Attempts and dead-letter timing are approximate. On redrive, unwrap the forwarded envelope and publish to the configured source before acknowledging the DLQ delivery. Use Application Default Credentials. [Pull subscription properties](https://docs.cloud.google.com/pubsub/docs/subscription-properties), [dead-letter topics](https://docs.cloud.google.com/pubsub/docs/dead-letter-topics) | Immediate enqueues in v1. Use the official Pub/Sub emulator plus a hosted sandbox for IAM, subscription leases, and dead-letter forwarding/redrive. The emulator cannot verify IAM. [Pub/Sub emulator](https://docs.cloud.google.com/pubsub/docs/emulator) |

SQS FIFO, Azure Service Bus, Cloud Tasks, and exactly-once or global FIFO guarantees are outside the design. RabbitMQ and Pub/Sub queues with delayed workloads require a different routing choice until an independently specified durable delay capability exists.

## 📝 Risks & Impact Review

| Severity | Failure | Mitigation and residual risk |
| --- | --- | --- |
| High | Producer and worker select different brokers or reuse another deployment's queues. | Share resolution and bootstrap validation. Require explicit isolated resource mappings and compare the process route fingerprints before cutover. Config drift across independently deployed services still needs an operator check. |
| High | Crashed handler is replayed after committing its side effect, or DLQ transfer is interrupted. | Qualify idempotency before activation, keep a stable job ID, and release the source only after destination acceptance. Duplicates remain possible. |
| High | Provider change strands jobs or causes jobs from a wiped database to run later. | Require a drain and reconcile runbook for ready, leased, delayed, and dead-letter jobs. Block a reset that cannot account for activated remote routes. Cutover may require a maintenance window. |
| Medium | Lease renewal, retries, or status behavior differ between an emulator and hosted services. | Run the hosted acceptance gates and publish exact exercised capabilities. A provider remains unavailable for release if its gate is pending. |
| Medium | An eager worker exceeds the database or broker capacity budget. | Apply the existing per-queue limits and DB connection budget to mixed workers. Track idle and active load, bound prefetch, retry rate, and backoff. |
| Medium | Broker retention or payload size limits prevent processing. | Validate encoded size and declared delay, document retention and privacy posture, and keep incompatible workloads on a suitable route. |

## 🧪 Verification

**Design-stage evidence.** A disposable Docker broker running RabbitMQ 4.3.8 passed an AMQP smoke test with confirmed publish, requeue, manual acknowledgement, quorum dead-lettering, and confirmed republish from the DLQ. A second probe confirmed that repeated rejects hit the configured delivery limit, move poison work to the DLQ, and let a healthy message complete. The test used a standalone client. The Mercato adapters and cloud sandboxes remain implementation acceptance work.

Run built-in queue regressions with both local and real Redis/BullMQ. Cover existing factory and explicit overload behavior, pending probe, CLI and workers, redelivery behavior, and dependency isolation using an OSS standalone build plus the Enterprise build. Refuse a provider identifier or resource mapping without Enterprise activation. Test producer and consumer startup in fresh processes to cover module import ordering, route validation and startup failure, restart after broker loss, and mixed local/BullMQ and external routing. Exercise shared and per-queue supervision with zero reported backlog and mixed-worker startup cleanup on partial failure.

Run the same provider acceptance suite against every adapter. Use a unique resource namespace, synthetic payloads, bounded timeouts, readiness checks, and cleanup in teardown. The suite covers publish → worker → acknowledgement and context, concurrency ceiling, forced disconnect before ack, restart/redelivery, healthy work after poison, DLQ destination and redrive, uncertain publish, failed quarantine transfer or equivalent provider failure, shutdown, and encoded size boundaries. Test lease renewal and lost leases where applicable. For native delay, test earliest delivery and over-limit rejection. For immediate-only transports, test route and enqueue rejection for delay. Add a provider-aware variant of the existing [todo bulk-complete integration flow](../../../apps/mercato/src/modules/example/__integration__/TC-EXAMPLE-003-todo-bulk-progress.spec.ts) with real app producer and worker processes for each released driver. Verify completion after outbox republish when the broker was unavailable, using the built-in recovery dispatcher alongside the Enterprise execution worker. Verify a second scoped job remains isolated, the mixed worker DB budget holds, and a destructive reset refusal leaves both DB and brokers untouched. CLI coverage includes a status command with unavailable metrics, clear refusal, and a built-in unaffected by Enterprise activation. There are no new API or UI paths.

Hosted checks must use explicitly authorized sandbox credentials and resources scoped to the run. Document provider/image versions, exact suite command, run or redacted log references, and teardown result in the implementation PR. Use the hosted row above as an acceptance gate for each managed cloud driver. Missing sandbox access leaves that driver's release gate open while local verification continues.

## 📋 Phasing

1. **Shared routing and qualification.** Ship the generic seam with regression coverage and default-off Enterprise routing.
2. **RabbitMQ.** Activate the first qualified driver after the real-broker gate passes.
3. **Amazon SQS.** Activate Standard queues after both the local and AWS gates pass.
4. **Azure Queue Storage.** Activate after Azurite and hosted sandbox gates pass.
5. **Google Cloud Pub/Sub.** Activate after emulator and hosted sandbox gates pass.

Phases 2–5 each depend on phase 1 and can be delivered independently.

## 📋 Implementation Plan

1. Characterize factory behavior, direct producer exceptions, worker startup, lazy probes, events and scheduler, and queue commands on the two built-ins. Record a route inventory including modules and standalone bootstrap paths.
2. Introduce the generic transport seam and Enterprise registration with a fake provider in contract tests. Wire the routed producer and worker paths, CLI and supervisor. Validate known queues and capabilities, fail closed, and retain built-in behavior. Exercise mixed routes through the existing example job and verify OSS dependency isolation.
3. Implement RabbitMQ and its topology/runbook. Run the conformance and app suites against pinned Docker RabbitMQ, including confirm/return, broker restart, requeue, DLQ, and redrive.
4. Implement SQS Standard and its topology/runbook. Run LocalStack and AWS sandbox checks, including native redrive, IAM and timers. Record evidence before marking the driver supported.
5. Implement Azure Queue Storage and its topology/runbook. Run Azurite and Azure sandbox checks, including pop-receipt races, poison transfer uncertainty and redrive.
6. Implement Pub/Sub and its topology/runbook. Run the emulator and GCP sandbox checks, including service-agent IAM, lease renewal and DLQ envelope redrive.
7. Publish the qualified matrix and operations notes for the completed phases. Archive implemented Delta requirements in the Enterprise capability spec with the dated design as source. Keep unimplemented phases visible until their evidence passes.

## Final Compliance Report

- **Edition and compatibility.** All broker SDKs, adapters, provider configuration, and cloud acceptance suites are Enterprise-owned. Shared OSS changes are additive queue infrastructure. Existing public types, commands, worker discovery and built-in behavior remain supported.
- **Security and data.** Existing handler ownership and tenant/organization scoping apply at execution. Broker topology separates deployments and operator privileges. The proposal adds no persisted credentials or database changes.
- **Review evidence.** The design traces current producer, worker, probe, CLI, event, and scheduler paths and compares provider semantics against primary documentation. Implementation acceptance requires the broker and cloud evidence above.

## Changelog

- 2026-11-24 — Proposed the shared queue seam and four independently verified Enterprise drivers.
