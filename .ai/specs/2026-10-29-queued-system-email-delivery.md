# Queued System Email Delivery with Retry

- **Status:** Draft — ready for review
- **Issue:** [#8186](https://github.com/open-mercato/open-mercato/issues/8186)
- **Related:** [#5693](https://github.com/open-mercato/open-mercato/issues/5693) (queue signup mail to close the timing oracle), [#6185](https://github.com/open-mercato/open-mercato/pull/6185) (SMTP provider), [`2026-06-03-pluggable-email-providers.md`](./2026-06-03-pluggable-email-providers.md), [`2026-08-04-system-scoped-encryption-key-contract.md`](./2026-08-04-system-scoped-encryption-key-contract.md)
- **Scope:** OSS — `packages/shared` (email façade), `packages/core/src/modules/communication_channels`

## TLDR

**Key Points:**
- System/transactional email (`sendEmail()` from `@open-mercato/shared/lib/email/send`) is delivered synchronously today; a transient provider failure fails the caller and the email is lost.
- Add an **opt-in queued delivery mode** (`OM_SYSTEM_EMAIL_DELIVERY=queued`). The default stays `sync`, so no deployment changes behavior until the operator opts in.
- In queued mode the `communication_channels` email transport renders the body, persists a **`SystemEmailDelivery`** row (recipient, subject, body and attachments encrypted at rest), and enqueues a job that carries **only the row id**. A worker delivers it and retries transient failures with exponential backoff.
- Provider-agnostic: Resend, SES and any future provider (SMTP from #6185) get retries for free because the worker calls the same adapter path as the synchronous send.

**Scope:**
- New entity + migration `system_email_deliveries`, encryption map entry, queue `communication-channels-system-email`, worker `system-email-delivery`, one event `communication_channels.system_email.delivery_failed`.
- `sendSystemEmail` split into *prepare* (resolve body) and *deliver* (resolve channel + credentials + send) so both modes share one delivery path.
- Additive `SendEmailOptions.delivery?: 'sync' | 'queued'` per-call override.

**Concerns:**
- Rendered bodies contain one-time secrets (password-reset, invitation, magic links). They MUST NOT appear in queue payloads (the local strategy writes jobs to `.mercato/queue/` in plaintext) and MUST be encrypted at rest and purged after delivery.
- At-least-once semantics: a crash between provider acceptance and the status write can send a duplicate.

## Overview

`sendEmail()` resolves the sender and hands a `ResolvedEmailPayload` to the registered `EmailTransport`. Since the pluggable-providers work (#4471) the only transport is registered by `communication_channels/di.ts`, which calls `sendSystemEmail()` (`lib/system-email.ts`). That function resolves the tenant's system email channel and credentials, renders the React element to HTML, and awaits `adapter.sendMessage()`; `status: 'failed'` becomes a thrown `Error`.

The hub already solves retries for *conversation* messages: `workers/outbound-delivery.ts` re-enqueues transient failures with `computeBackoffMs`, classifies errors with `classifyOutboundError` (`lib/error-classification.ts`) and caps attempts. System email — 26 call sites across auth (password reset, invitations, user commands), customer_accounts, notifications, messages, sales quotes, checkout, forms, onboarding and enterprise security — bypasses all of it.

## Problem Statement

1. **Lost mail on transient failure.** A provider timeout, 5xx or 429 during a password-reset request throws inside the request handler. The user sees an error (or, where the caller swallows it, nothing) and the email is never retried.
2. **Request latency is coupled to the provider.** Every send waits for the provider round-trip. #5693 shows this is also a security problem: the signup endpoint's response time reveals whether an email was sent.
3. **No uniform failure record.** Failures surface only as exceptions in whichever caller hit them; there is no durable record an operator can inspect.

## Proposed Solution

### Delivery modes

| Mode | Selected by | Behavior |
|---|---|---|
| `sync` (default) | `OM_SYSTEM_EMAIL_DELIVERY` unset or `sync` | Today's behavior, unchanged. |
| `queued` | `OM_SYSTEM_EMAIL_DELIVERY=queued` | Persist + enqueue; `sendEmail()` resolves once the row is committed and the job enqueued. |

Per-call override: `sendEmail({ ..., delivery: 'sync' })` forces synchronous delivery for flows that must surface provider failure to the user (e.g. a future "send test email" action). `delivery: 'queued'` forces queuing even when the instance default is `sync`. Unknown env values fall back to `sync` with a one-time warning.

Sends **without `tenantId`** always use `sync`: the row cannot be encrypted with a tenant key, and the system-scoped key contract forbids adding a second system-scoped map before its Phase 3 lands. This is logged at debug level only (it is expected, not a misconfiguration).

### Flow (queued mode)

```
sendEmail(options)
  └─ captureEmailForTests / isEmailDeliveryDisabled / from resolution   (unchanged, shared)
  └─ transport.send(payload)                                            (communication_channels)
       ├─ mode = resolveSystemEmailDeliveryMode(payload)
       ├─ sync   → deliverSystemEmail(container, payload, renderedBody)   (today's path)
       └─ queued → body = resolveEmailBody(payload)                       (React rendered NOW)
                   row  = SystemEmailDelivery{status:'pending', attempts:0, encrypted fields}
                   em.persistAndFlush(row)
                   queue.enqueue({ deliveryId, scope }, {})               (id only — no PII)

worker system-email-delivery({ deliveryId, scope, attempt })
  ├─ row = findOneWithDecryption(SystemEmailDelivery, { id, tenantId })
  ├─ row missing or status ∈ {sent, failed} → return                      (idempotent)
  ├─ deliverSystemEmail(container, toPayload(row), toBody(row))
  │    ├─ ok        → status='sent', sentAt=now, purge content fields
  │    └─ throws    → c = classifyOutboundError(err)
  │                   attempts += 1, lastError = c.message (truncated, no body content)
  │                   transient && attempts < max → status='pending', re-enqueue with backoff
  │                   else → status='failed', purge content, emit delivery_failed, reportError
```

Rendering happens **before** enqueueing because a `React.ReactElement` is not serializable and its render may depend on request-scoped data (translations already resolved by the caller).

### Retry schedule

The conversation worker's `computeBackoffMs` (1 s base, 60 s cap) is tuned for chat-like latency and would exhaust all attempts within a minute — too short to outlive a provider incident. System email gets its own schedule:

- `OM_SYSTEM_EMAIL_MAX_ATTEMPTS` — default `8`, clamped to `1..20`.
- Delay before attempt *n+1*: `min(30 s × 2^(n−1), 30 min)` + up to 10 % jitter → cumulative window ≈ 2 h with defaults.

Re-enqueue uses `queue.enqueue(payload, { delayMs })`, exactly like `outbound-delivery.ts`. The worker never throws on a recorded failure (avoids the queue's own retry stacking on top); it rethrows only when it cannot even record the outcome (DB failure), mirroring the existing worker's dead-letter rule.

### Retention

Content fields (`recipient`, `subject`, `html_body`, `text_body`, `attachments`, `reply_to`) are set to `NULL` when a row reaches `sent` or `failed`. Metadata (status, attempts, timestamps, provider key, last error) is kept for diagnostics. Pruning old rows is out of scope for v1 (see Non-goals); the row is small once purged.

## Architecture

### `packages/shared/src/lib/email/send.ts`

- `SendEmailOptions.delivery?: 'sync' | 'queued'` and the same optional field on `ResolvedEmailPayload`, passed through unchanged. Additive only; no other change to the façade.

### `packages/core/src/modules/communication_channels`

| File | Change |
|---|---|
| `lib/system-email.ts` | Extract `prepareSystemEmailBody(payload)` (= today's `resolveEmailBody`) and `deliverSystemEmail(container, payload, body)` (channel + credentials resolution + `convertOutbound` + `sendMessage`). `sendSystemEmail` keeps its signature and becomes the mode dispatcher. |
| `lib/system-email-delivery-mode.ts` (new) | `resolveSystemEmailDeliveryMode(payload)` — env + per-call override + tenantless rule. |
| `lib/system-email-queue.ts` (new) | `enqueueSystemEmailDelivery(container, payload, body)` — persist row, enqueue job. `computeSystemEmailBackoffMs(attempt)`, `resolveSystemEmailMaxAttempts()`. |
| `lib/queue.ts` | Add `systemEmail: 'communication-channels-system-email'` to `COMMUNICATION_CHANNELS_QUEUES`. |
| `workers/system-email-delivery.ts` (new) | Worker described above; `metadata = { queue, id: 'communication_channels:system-email-delivery', concurrency: 5 }`. |
| `data/entities.ts` | `SystemEmailDelivery` entity. |
| `encryption.ts` | Encryption map entry for the content fields. |
| `events.ts` | `communication_channels.system_email.delivery_failed`. |
| `migrations/` | One migration creating `system_email_deliveries` + snapshot update. |

`di.ts` keeps registering the same `EmailTransport`; no DI key changes.

Concurrency 5 keeps the module's added pool usage well inside the queue connection budget (`packages/queue/AGENTS.md` → Connection Budget). Provider calls are already bounded by each adapter's own timeout.

## Data Models

### `SystemEmailDelivery` → table `system_email_deliveries`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid, not null | queued rows always have a tenant |
| `organization_id` | uuid, null | |
| `status` | text | `pending` \| `sent` \| `failed` |
| `attempts` | int, default 0 | completed attempts |
| `recipient` | text, null | **encrypted**; purged on terminal status |
| `subject` | text, null | **encrypted**; purged |
| `html_body` | text, null | **encrypted**; purged |
| `text_body` | text, null | **encrypted**; purged |
| `attachments` | text, null | JSON string, **encrypted**; purged |
| `from_address` | text | sender is instance/tenant config, not end-user PII |
| `from_is_instance_default` | boolean | preserves today's tenant-sender precedence |
| `reply_to` | text, null | **encrypted**; purged |
| `provider_key` | text, null | filled on first attempt, for diagnostics |
| `last_error` | text, null | classified message, truncated to 1000 chars, never body content |
| `sent_at` | timestamptz, null | |
| `created_at`, `updated_at` | timestamptz | `updated_at` per platform convention |

Indexes: `(tenant_id, status, created_at)`.

No `deleted_at`: rows are an internal delivery log, not a user-editable record, and are never soft-deleted. No optimistic locking: there is no edit surface; the worker is the single writer for a given id (one job in flight per row).

## API Contracts

No HTTP routes are added or changed.

| Surface | Change | Classification |
|---|---|---|
| `SendEmailOptions` / `ResolvedEmailPayload` (`@open-mercato/shared/lib/email/send`) | new optional `delivery` field | additive |
| Event `communication_channels.system_email.delivery_failed` | new; payload `{ deliveryId, tenantId, organizationId, providerKey, attempts, error }` — no recipient, no body | additive |
| Queue `communication-channels-system-email`, worker id `communication_channels:system-email-delivery` | new | additive |
| Env `OM_SYSTEM_EMAIL_DELIVERY`, `OM_SYSTEM_EMAIL_MAX_ATTEMPTS` | new, documented in `apps/mercato/.env.example` and mirrored into the create-app template | additive |
| `sendSystemEmail(container, payload)` | signature unchanged | — |

## Integration Coverage

- **TC-CHANNEL-SYSEMAIL-001** — queued mode, happy path: with `OM_SYSTEM_EMAIL_DELIVERY=queued` and the test-seed provider, trigger a password reset via `POST /api/auth/reset`; assert the email is captured and the delivery row ends `sent` with content purged.
- **TC-CHANNEL-SYSEMAIL-002** — transient failure then success: the test-seed adapter fails the first attempt with a transient error; assert a second attempt delivers and `attempts = 2`.
- **TC-CHANNEL-SYSEMAIL-003** — permanent failure: the adapter returns a non-transient failure; assert one attempt, status `failed`, content purged, `delivery_failed` emitted.
- Failure injection for 002/003: the test-seed adapter (`lib/test-seed.ts`) gains a test-only failure script, active only when `OM_ENABLE_TEST_CHANNEL_SEEDING` is set (same gate as the adapter itself), so the integration harness can request "fail the next N sends transiently / permanently" without a network provider.
- Default mode regression: existing email-dependent suites (auth reset/invite, notifications) run unchanged with the env unset.

Unit tests: mode resolution (env × per-call × tenantless), backoff schedule and clamping, worker state machine (idempotent skip, retry, exhaust, permanent, record-failure rethrow), purge on terminal status, payload never containing body fields.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| One-time links leak through the queue backend (local file queue, Redis) | High | security | job payload is `{ deliveryId, scope, attempt }` only; unit test asserts no body fields in the payload | none |
| Secrets persist in the DB after delivery | High | security | encryption map on content fields; purge on `sent`/`failed` | ciphertext exists for the retry window only |
| Duplicate send after a crash between provider accept and status write | Medium | delivery | documented at-least-once; status written immediately after send | rare duplicate email |
| Caller relied on a thrown error to inform the user (e.g. "could not send invite") | Medium | UX | opt-in mode; per-call `delivery: 'sync'`; callers that need it are listed during implementation review | operator must opt in knowingly |
| Queue worker not running → mail silently queued forever | Medium | ops | document that `queued` requires workers (`yarn mercato queue worker` / auto-spawn); `pending` rows remain inspectable | depends on deployment |
| Encryption disabled / no KMS on the instance | Low | security | same posture as `channel_ingest_dead_letters`; purge still applies | plaintext during the retry window |
| Large attachments bloat rows | Low | storage | purge on terminal status; existing callers send small PDFs only | — |

Backward compatibility: no contract surface is removed or changed; the default mode keeps every call site's current behavior (`BACKWARD_COMPATIBILITY.md` — additive only).

## Non-goals (v1)

- Admin UI or API to list/replay failed deliveries (rows and the event make it possible later).
- Pruning job for old metadata rows.
- Queued delivery for tenantless sends (blocked on system-scoped key Phase 3).
- Changing the conversation outbound worker or its backoff.
- Making `queued` the default — revisit after the mode has run in production.

## Final Compliance Report

- Tenant scoping: every row carries `tenant_id`; the worker loads by `(id, tenant_id)` via `findOneWithDecryption`.
- Encryption: content fields in `encryption.ts`; reads via `findOneWithDecryption`.
- Queue rules: idempotent worker, exported `metadata`, works with `local` and `async` strategies, concurrency within the connection budget.
- Error reporting: terminal failures go through `reportError` and the structured logger; no `console.*`.
- No direct ORM relations to other modules; no generated files edited by hand; migration file + snapshot committed, not applied.

## Changelog

- 2026-10-29 — Initial draft.
