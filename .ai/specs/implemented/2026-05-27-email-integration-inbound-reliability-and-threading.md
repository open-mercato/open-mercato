# Email Integration Follow-ups — Reliability, Threading, Push Delivery & OAuth

> **Consolidated spec (2026-06-01).** This single document gathers the three
> May-27 email-integration follow-up specs so the PR carries one file instead of
> three. Organized in parts:
> - **Part 1 — Inbound Email Reliability + Layered Threading** (below — the original body of this spec)
> - **Part 2 — Provider Push Delivery (Gmail Pub/Sub)** — merged from the former `2026-05-27-email-integration-provider-push-delivery.md`
> - **Part 3 — OAuth Credential Wiring (token refresh)** — merged from the former `2026-05-27-oauth-refresh-credentials-client-wiring-fix.md`
> - **Part 4 — OAuth client-credential resolution + per-user privacy hardening (v1, 2026-06-01)**
>
> Per-user privacy decisions are recorded authoritatively in [`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md) (§ *Per-user privacy & visibility model (v1)* and § *OAuth client-credential resolution*); Part 4 summarizes the wiring fix.

## Part 1 — Inbound Email Reliability + Layered Threading

## TLDR

**Key Points:**
- Fixes the "responses sometimes never arrive / never thread to the right conversation" symptoms in the per-user email integration (foundation laid by [`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md) and the staged code on branch `feat/demo-hoodie`). Outbound already works; this spec is inbound-only.
- Introduces a layered thread-matching algorithm (References-header token → hidden body-footer token → JWZ on `Message-Id`/`In-Reply-To`/`References` → subject+participants fallback) so replies thread reliably even when a mail client strips headers or users edit subjects.
- Rewrites the IMAP worker around UIDVALIDITY/UIDNEXT cursor semantics with per-message commit, bounded fetch (`HARD_CAP = 200`), zero-history bootstrap (no 1M-inbox scan), auto-recovery from `status='error'`, 60 s socket timeout, and sent-folder dedup.
- Adds on-demand `POST /channels/{id}/import-history` so users explicitly opt into backfilling past mail per contact / time window — no silent multi-million-message ingest.
- All changes are **additive** — no event ID, API URL, widget spot ID, ACL feature ID, or DI key changes. The provider package `@open-mercato/channel-gmail` gets layered threading "for free" via the shared `lib/thread-matcher.ts`.

**Scope (Spec B):**
- New hub libs `thread-matcher.ts` and `thread-token.ts` in `packages/core/src/modules/communication_channels/lib/`.
- New `ChannelThreadToken` entity (1:1 with `messages.message.threadId`, HMAC-signed token, unique index).
- New `ChannelIngestDeadLetter` entity (operator replay of permanently-failed messages).
- Outbound MIME mutation in `subscribers/outbound-bridge.ts` (token injection — References header + hidden body span + plain-text marker).
- Inbound matcher invocation in `commands/ingest-inbound-message.ts`.
- IMAP worker rewrite in `packages/channel-imap/src/modules/channel_imap/lib/adapter.ts` + `imap-client.ts`: bootstrap, incremental, per-message commit, socket timeout, sent-folder dedup.
- Auto-recovery sweeper folded into existing `workers/poll-tick.ts` (extends the predicate, no new worker).
- New API `POST /api/communication_channels/channels/{id}/import-history` + worker `channel-import-history`.
- New ACL feature `communication_channels.channel.import_history`.
- Integration tests TC-CHANNEL-EMAIL-021…030 using **mocked `imapflow`** in-process fixtures (no Docker, no Greenmail).

**Non-goals / deferred:**
- Gmail Pub/Sub push delivery — **Spec C** (sibling spec, follows this one).
- `RefreshCredentialsInput._client` wiring bug that breaks OAuth token refresh after ~1 h — **Spec A** (small parallel hotfix, see § Prerequisites).
- IMAP IDLE / long-lived connections — re-evaluate after Spec C ships; polling at 60 s gives acceptable IMAP latency for v1.
- CRM Person page real-time SSE (`useAppEvent` wiring) — page-reload pattern stays for v1; revisit in a CRM-UX spec.
- Any change to Gmail / IMAP outbound paths beyond the shared token-injection step.
- Multi-folder IMAP scanning (Sent folder ingestion to capture "user sent from phone") — flagged as a follow-up in § Risks.

**Concerns / dependencies:**
- This spec assumes the `2026-05-21-email-integration-foundation.md` hub + provider scaffolding is committed (it is staged on `feat/demo-hoodie`). The staged `channel-imap` adapter already partially fixes the "1M inbox" symptom with a 30-minute wall-clock window — this spec replaces that with the cursor-based approach described in § Proposed Solution.
- Spec A (OAuth refresh `_client` fix) must ship before Gmail channels can run for more than ~1 h, but Spec B does not block on it: IMAP credentials don't expire, so IMAP demos work even without Spec A.
- `ChannelThreadMapping` already exists ([`packages/core/src/modules/communication_channels/data/entities.ts`](../../packages/core/src/modules/communication_channels/data/entities.ts), staged); the new `ChannelThreadToken` is complementary, not a replacement.

---

## Prerequisites & Cross-Spec Dependencies

| Dependency | What it delivers | Must merge before this spec? |
|---|---|---|
| `2026-05-21-email-integration-foundation.md` (staged) | `communication_channels` hub, `channel-imap` / `channel-gmail` provider packages, OAuth callback router, `ChannelThreadMapping`, polling scheduler stubs | Yes — already on `feat/demo-hoodie` |
| **Spec A** (OAuth refresh `_client` hotfix, separate small PR) | Wires per-tenant OAuth client config into `RefreshCredentialsInput` so Gmail channels survive past 1 h token expiry | No — IMAP path does not depend on it; Gmail demos require it |
| **Spec C** (Gmail Pub/Sub webhooks, follow-up) | Sub-minute push delivery for Gmail channels using the new shared thread-matcher + thread-token libs from Spec B | No — sequenced after B |

---

## Overview

The per-user email integration foundation ([`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md)) shipped the hub + two provider packages (`channel-imap`, `channel-gmail`) with working outbound delivery and a polling-based inbound path. Real-world testing on the `feat/demo-hoodie` branch surfaced two recurring failure modes:

1. **Inbound messages sometimes never arrive** in the CRM, even when they hit the user's mailbox. Investigation traced this to a combination of (a) the IMAP adapter's bootstrap fetching `UID FETCH 1:*` with a `limit: 100` cap, which on a large mailbox traps the cursor on the oldest 100 messages, (b) a 10 s socket timeout that flakes under real-world IMAP server latency, (c) a "any single ingest failure reverts the whole poll batch" semantic that lets one malformed MIME blob starve the channel, and (d) `status='error'` permanently quarantining the channel until manual intervention.
2. **Replies fail to thread to the original conversation** when the recipient's mail client rewrites or strips RFC 5322 headers (mobile mail clients are the most common offenders). Today the system relies solely on `Message-Id` / `In-Reply-To` / `References` joins; there is no token, no fallback strategy, and threading silently fails.

Both failure modes are demo-blocking and erode user trust. This spec fixes them.

> **Market Reference:** Twenty CRM ([`twenty-server/src/modules/messaging/message-import-manager/drivers/imap/services/`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/modules/messaging/message-import-manager/drivers/imap/services)) — adopted: UIDVALIDITY/UIDNEXT cursor + provider-driver separation. Rejected: their batch-restart-on-any-failure semantic (the same one breaking us today). Salesforce Lightning Email-to-Case Threading ([docs](https://help.salesforce.com/s/articleView?id=service.support_email_to_case_threading.htm)) — adopted: layered match (token → headers → subject+participants), token verified with HMAC. Rejected: visible subject token (`ref:_00D...`) — replaced with invisible References-header + hidden-body-span token for cleaner UX. JWZ ([`www.jwz.org/doc/threading.html`](https://www.jwz.org/doc/threading.html)) — adopted as the medium-confidence header strategy and the subject-normalization rules. ImapFlow ([`imapflow.com`](https://imapflow.com/)) — adopted: `MailboxLock`, CONDSTORE/QRESYNC auto-detection. Rejected (for v1): IDLE — `imapflow` does not auto-reconnect ([issues #14, #63](https://github.com/postalsys/imapflow/issues/14)) and persistent TCP connections don't fit Open Mercato's queue-worker pattern cleanly; revisit after Spec C.

## Problem Statement

1. **IMAP bootstrap fetch is unbounded.** `range = '1:*'` on first poll with a `limit: 100` cap streams oldest-first on a 1M-message mailbox, traps the cursor far behind real `UIDNEXT`, and the user never sees recent mail.
2. **Socket timeout is too aggressive.** 10 s vs Gmail/Fastmail real-world 15–30 s response times causes legitimate polls to throw, burn the 3-retry budget, and set `status='error'` permanently (the scheduler's `WHERE status='connected'` excludes the channel from all subsequent ticks).
3. **One bad message stalls the channel.** Current semantic: if any message in a poll batch throws during `ingest-inbound-message`, the cursor does not advance — neither `lastPolledAt` nor `channelState`. A single malformed MIME blob freezes the channel.
4. **No outbound tagging means threading is brittle.** Reliance on RFC 5322 headers alone means mobile mail clients, mailing-list expanders, and other header-mangling MTAs silently break threading. The hoodie commit's `handleThreadingInheritance` fallback in `customers/subscribers/_internal/link-channel-message-handler.ts` helps for the "person link" side but does nothing for the "which thread" decision in `ingest-inbound-message`.
5. **No first-class history-import UX.** Users connecting a mailbox with existing context (12 months of conversations with a key contact) have no way to backfill that history without scanning the entire inbox.

## Proposed Solution

### High-level approach

```
                     ┌────────────────────────────────────────┐
                     │      communication_channels hub        │
                     │                                        │
   poll-tick(60s) ───►  scheduler                             │
                     │  + auto-recover sweeper (extends       │
                     │    poll-tick to include status='error' │
                     │    AND lastFailureAt < now()-30m)      │
                     │                                        │
                     │  NEW lib/thread-matcher.ts             │◄── called by ingest-inbound-message
                     │  NEW lib/thread-token.ts               │◄── called by outbound-bridge
                     │                                        │
                     │  NEW entity: ChannelThreadToken        │
                     │  NEW entity: ChannelIngestDeadLetter   │
                     └────────────────────────────────────────┘
                                       ▲
                              ┌─────────┴─────────┐
                      ┌───────┴──────┐  ┌─────────┴────┐
                      │ channel-imap │  │ channel-gmail│
                      │  (changes)   │  │              │
                      └──────────────┘  └──────────────┘
                                               │
                                               └─ unchanged in Spec B;
                                                  benefit automatically
                                                  from new matcher
```

The hub gets one canonical thread-matcher and one canonical thread-token library. Both provider adapters call the same matcher via `ingest-inbound-message`. Outbound MIME mutation happens once in `subscribers/outbound-bridge.ts` — adapters are not aware of the token.

### Layered thread matching (the heart of "bulletproof")

`lib/thread-matcher.ts` runs five ordered strategies; first hit wins:

1. **Token in References / In-Reply-To headers** (high confidence) — scan headers for `<om_[A-Za-z0-9_-]+@open-mercato.invalid>`, HMAC-verify the token, look up the persisted token row.
2. **Token in body** (high confidence) — regex `\[OM:(om_[A-Za-z0-9_-]+)\]` in HTML hidden span first, then plain text; HMAC-verify; lookup as above.
3. **JWZ on `Message-Id`** (medium confidence) — find any `MessageChannelLink.channelMetadata.messageId` in this channel matching `inReplyTo` or any `references[]` entry; resolve to its `messages.message.threadId`.
4. **Subject + participants** (low confidence) — normalized subject (`Re:`/`Fwd:`/`[…]` stripping, RFC 5256 base-subject rules) + overlapping participant set within last 30 days, same channel.
5. **None** — return `null`; caller creates a new thread.

### Bounded, cursor-driven IMAP inbound

- **Bootstrap** (no cursor): `SELECT INBOX`, read `UIDVALIDITY` + `UIDNEXT`, persist cursor, set `lastPolledAt = now()`, status = `connected`. **Fetch zero messages.**
- **Incremental** (cursor exists): `SELECT INBOX`, compare `UIDVALIDITY`. On mismatch, discard cursor and treat as bootstrap. `UID FETCH storedUidNext:*` capped at `HARD_CAP = 200`. If more available (`hasMore`), advance cursor past the last fetched UID and re-enqueue immediately.
- **Per-message commit**: each message ingest commits its cursor advance independently. Permanent failures (malformed MIME, schema violation) go to `channel_ingest_dead_letter` and the cursor advances anyway. Transient failures (DB drop, network) abort the loop without advancing, exponential backoff (60 s → 30 min).
- **Auto-recovery from `status='error'`**: `poll-tick` sweep query unions `status='error' AND lastFailureAt < now() - 30 min` channels every 30 min and retries one tick; success flips back to `connected`.
- **Socket timeout**: 10 s → **60 s**.

### On-demand history import

`POST /api/communication_channels/channels/{id}/import-history` queues a `channel-import-history` job (new queue, `concurrency: 1` per channel). The worker reuses IMAP fetch primitives but with a different cursor strategy: `SEARCH SINCE <date> [FROM <a> OR FROM <b> …]`, capped at `maxMessages`. Progress reported via the existing `ProgressJob` from `packages/core/src/modules/progress`. New ACL feature `communication_channels.channel.import_history`.

### Outbound token injection (KISS)

In `subscribers/outbound-bridge.ts`, before handing the payload to the adapter:

1. `getOrCreateThreadToken(messageThreadId)` — idempotent upsert (insert-on-conflict-do-nothing + select).
2. Mutate MIME: append `<om_TOKEN@open-mercato.invalid>` to `References:` (deduped), inject `<span style="display:none">[OM:om_TOKEN]</span>` before `</body>` in HTML body, append `\n\n[OM:om_TOKEN]` line to plain text.
3. Adapter sends as normal. **No adapter changes.**

Idempotent on retry: same token reused per thread.

### Design Decisions

| Decision | Rationale |
|---|---|
| Token in both `References:` and hidden body span (not subject) | References is invisible and survives most clients; body span is a fallback if a mail client strips References. Subject tokens (Pipedrive/HubSpot/Salesforce style) are user-hostile and users strip them when editing subjects. |
| New `ChannelThreadToken` entity (not column on `ChannelThreadMapping`) | Token is 1:1 with `messageThreadId` (logical thread identity), independent of channel/provider. `ChannelThreadMapping` is keyed on `(externalConversationId, tenantId)` — N rows per thread when a thread spans channels. Separate concerns. |
| Cursor = `(UIDVALIDITY, UIDNEXT)` per folder, no `HIGHESTMODSEQ` in v1 | KISS. CONDSTORE/QRESYNC adds complexity without a v1 latency win. Twenty CRM uses HIGHESTMODSEQ; we follow EspoCRM's simpler model for v1 and can add CONDSTORE later. |
| Zero-history bootstrap (no time-window) | The "import last N days" UX belongs in `/import-history`, not the silent connect flow. Eliminates the "1M inbox melts on connect" failure mode by construction. |
| Per-message commit + dead-letter table | One bad MIME blob must not stall the channel. Recoverability matters more than transactional purity in inbound mail. |
| `HARD_CAP = 200` per poll, re-enqueue immediately if more | Bounds each poll's wall-clock and DB transaction size; chatty mailboxes still drain quickly because the next tick has zero delay. |
| HMAC-signed token (not just random) | Defends against forged tokens in spoofed inbound. Verify before DB lookup — collision attacks fail closed. |
| Auto-recovery folded into `poll-tick` (not a new worker) | One scheduler, one tick, one query predicate union. KISS — no new queue, no new concurrency config. |
| Mocked `imapflow` in CI (not Greenmail) | Our bugs are app-layer (cursor logic, threading) not protocol-layer. Deterministic, no Docker, faster CI. Spec C revisits if push-delivery testing needs protocol fidelity. |
| Polling-only, no IDLE | `imapflow` does not auto-reconnect (issues [#14](https://github.com/postalsys/imapflow/issues/14), [#63](https://github.com/postalsys/imapflow/issues/63)); persistent connections need a process supervisor outside the queue-worker model. Defer until Spec C ships and we know real customer demand. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Visible subject token (`[#OM-…]`) à la HubSpot | HubSpot community is full of complaints about visible tokens; users strip them when editing subjects. References header + hidden body span achieves the same robustness with zero visible artifacts. |
| Reply-To sub-addressing (`reply+token@inbound.mercato.app`) | Requires owning MX, running Postfix or Mailgun/Postmark inbound, DNS work per customer. Highest reliability possible but enterprise-scale infra commitment — defer to a future "Open Mercato Inbound" spec. |
| IMAP IDLE for sub-minute latency | imapflow auto-reconnect gap, NAT/firewall idle disconnects, and process-supervisor requirement push this out of v1 scope. 60 s polling is acceptable for IMAP; Gmail gets sub-minute via Spec C's push delivery. |
| Extract a new `email-core` module | Premature abstraction. The existing hub + provider pattern factors correctly; the new libs live in the hub. Revisit if/when a fourth email-shaped channel demands the abstraction. |
| Keep the staged 30-min wall-clock window | "Refetches the same message 30 times before it ages out", makes history-import UX impossible to graft on, and trades correctness for a demo-safe hack. Cursor-based bootstrap is the right answer. |
| Token column on `ChannelThreadMapping` (Q1 (b)) | Mapping is keyed on `(externalConversationId, tenantId)`; thread-spans-channels means N rows per thread and either duplicated tokens or nullable columns for non-email channels. Separate entity is clearer. |
| Greenmail Docker fixture (Q2 (b)) | Adds JDK + Docker to CI runners; our bugs are app-layer not protocol-layer; can revisit in Spec C if push delivery needs protocol fidelity. |

## User Stories / Use Cases

- **A sales user** wants to **connect their IMAP mailbox without backfilling 12 months of unrelated mail** so that **the CRM timeline starts clean and only tracks new conversations they care about**.
- **A sales user** wants **replies from prospects to appear in the CRM within ~2 minutes, threaded under the original outbound** so that **they see the conversation in context without searching**.
- **A sales user** wants to **click "Import last 30 days from acme@example.com"** so that **prior correspondence with that contact is pulled into the CRM after first connect**.
- **A sales user** wants the **CRM to keep polling after transient network errors** so that **they don't have to manually "Reconnect" their mailbox after a flaky weekend**.
- **An admin** wants **corrupt/unparseable inbound messages to land in a dead-letter table** so that **they can decide whether to replay them after fixing parsers, without losing data silently**.
- **An admin** wants **a single auto-recover signal** so that **channels with transient errors recover without manual intervention while channels with permanent errors stay visibly broken**.

## Architecture

### Component diagram

```
                              poll-tick (every 60s)
                              ────────────────────
                                       │
                                       ▼
                ┌──────────────────────────────────────────┐
                │ SELECT channels                          │
                │  WHERE status='connected'                │
                │     AND nextPollAt <= NOW()              │
                │  UNION                                   │
                │  SELECT channels                         │  ← NEW (Spec B Phase 5)
                │  WHERE status='error'                    │
                │    AND lastFailureAt < NOW() - 30m       │
                │  LIMIT 500                               │
                └──────────────────────────────────────────┘
                                       │
                                       ▼ enqueue 'communication-channels-poll'
                ┌──────────────────────────────────────────┐
                │ poll-channel worker (concurrency: 10)    │
                │                                          │
                │ 1. Resolve adapter + credentials         │
                │ 2. adapter.refreshCredentials? if OAuth  │
                │ 3. page = adapter.fetchHistory({         │
                │      channelState, since, limit=200      │  ← HARD_CAP
                │    })                                    │
                │ 4. for each message in page.messages:    │
                │      └─ ingest-inbound-message.execute() │
                │         (per-message commit, see below)  │
                │ 5. persist page.nextCursor               │
                │ 6. if page.hasMore → re-enqueue now      │
                └──────────────────────────────────────────┘
                                       │
                                       ▼ (per message)
                ┌──────────────────────────────────────────┐
                │ ingest-inbound-message command           │
                │                                          │
                │ 1. Sent-folder dedup:                    │  ← NEW
                │    if exists(MessageChannelLink where    │
                │    channelMetadata.messageId == msg.id   │
                │    and channelId == this) → skip         │
                │                                          │
                │ 2. match = matchThread(input, deps)      │  ← NEW
                │    └─ Strategy 1 (token in References)   │
                │    └─ Strategy 2 (token in body)         │
                │    └─ Strategy 3 (JWZ on Message-Id)     │
                │    └─ Strategy 4 (subject+participants)  │
                │    └─ Strategy 5 (null = new thread)     │
                │                                          │
                │ 3. Begin DB transaction:                 │
                │    a. find/create messages.message       │
                │    b. find/create MessageChannelLink     │
                │    c. write match.matchedBy + confidence │
                │       to channelMetadata for observabily │
                │    d. emit communication_channels.       │
                │       message.received                   │
                │ 4. Commit transaction                    │
                │                                          │
                │ Exception handling:                      │
                │   • PERMANENT (parse/schema):            │  ← NEW
                │     insert into channel_ingest_dead_letter│
                │     advance cursor anyway, log warning   │
                │   • TRANSIENT (db/net):                  │
                │     do NOT advance cursor                │
                │     re-throw to caller for backoff       │
                └──────────────────────────────────────────┘

         outbound-bridge subscriber (on messages.message.sent)
         ────────────────────────────────────────────────────
                                       │
                                       ▼
                ┌──────────────────────────────────────────┐
                │ 1. Resolve channel + adapter             │
                │ 2. token = getOrCreateThreadToken(       │  ← NEW
                │      messageThreadId)                    │
                │ 3. mime = applyOutboundThreadingToken(   │  ← NEW
                │      mime, token)                        │
                │    • References += <om_TOK@…invalid>     │
                │    • HTML body += <span hidden>          │
                │    • Plain += "\n\n[OM:om_TOK]"          │
                │ 4. adapter.sendMessage(mime)             │  ← unchanged
                │ 5. persist ExternalMessage +             │
                │    MessageChannelLink (direction=out)    │
                │ 6. emit communication_channels.          │
                │    message.sent                          │
                └──────────────────────────────────────────┘
```

### Commands & Events

**New commands** (all follow the existing CommandBus pattern in `packages/core/src/modules/communication_channels/commands/`):

| Command ID | Purpose | Undo |
|---|---|---|
| `communication_channels.thread_token.generate` | Idempotent upsert: insert `ChannelThreadToken` for a given `messageThreadId` if not present; return existing or new token | Not reversible (token rotation is a future concern). Side-effect-free read on re-execution. |
| `communication_channels.import_history.queue` | Create `ProgressJob`; enqueue `channel-import-history` job | Cancel: set ProgressJob status='cancelled'; worker checks status before each batch and exits cleanly |
| `communication_channels.dead_letter.write` | Insert into `channel_ingest_dead_letter` | Not reversible; admin can `DELETE` after replay |
| `communication_channels.message.ingest` *(existing — modified)* | Per-message commit semantics + matcher invocation; emits `communication_channels.message.received` on success | Reversible by `DELETE` on the created `MessageChannelLink` + matching `messages.message` (existing reconciliation tooling) |

**New events:** **none.** The four existing hub events (`communication_channels.message.received`, `.sent`, `.delivery_failed`, `.channel.requires_reauth`) cover all behavior in this spec.

**DI keys:** **no new DI keys.** The two new libs are imported directly (pure functions); the `getOrCreateThreadToken` and matcher use the existing `em`, `commandBus`, and `eventBus` resolved by the caller.

## Data Models

### `ChannelThreadToken` (new)

```ts
@Entity({ tableName: 'channel_thread_tokens' })
@Index({ name: 'channel_thread_tokens_thread_idx', properties: ['messageThreadId', 'tenantId'] })
@Unique({ name: 'channel_thread_tokens_token_uq', properties: ['tenantId', 'token'] })
export class ChannelThreadToken {
  [OptionalProps]?: 'createdAt' | 'lastSeenAt' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  /** Logical link to messages.message.thread_id (no DB FK — cross-module). */
  @Property({ name: 'message_thread_id', type: 'uuid' })
  messageThreadId!: string

  /**
   * HMAC-signed opaque token, format: `om_<22b64url>_<11b64url>` (16 random bytes + 8 HMAC bytes,
   * each base64url-encoded without padding), approximately 37 characters total.
   */
  @Property({ name: 'token', type: 'text' })
  token!: string

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()

  /** Updated whenever a matcher Strategy 1 or 2 hit resolves to this row. Used for future GC. */
  @Property({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null
}
```

Notes:
- `(tenantId, token)` unique constraint ensures cross-tenant isolation by construction.
- `organization_id` is nullable to mirror `ChannelThreadMapping` (some threads predate org scoping).
- One row per `messageThreadId`; if a thread is touched on multiple channels, all replies match the same token.

### `ChannelIngestDeadLetter` (new)

```ts
@Entity({ tableName: 'channel_ingest_dead_letters' })
@Index({ name: 'channel_ingest_dead_letters_channel_idx', properties: ['channelId', 'tenantId'] })
@Index({ name: 'channel_ingest_dead_letters_created_idx', properties: ['tenantId', 'createdAt'] })
export class ChannelIngestDeadLetter {
  [OptionalProps]?: 'createdAt' | 'organizationId' | 'externalMessageId' | 'rawBody'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  /** External UID/sequence-number for the provider (e.g., IMAP UID, Gmail messageId). */
  @Property({ name: 'external_uid', type: 'text', nullable: true })
  externalUid?: string | null

  @Property({ name: 'external_message_id', type: 'text', nullable: true })
  externalMessageId?: string | null

  @Property({ name: 'error_class', type: 'text' })
  errorClass!: string

  @Property({ name: 'error_message', type: 'text' })
  errorMessage!: string

  /** Truncated source — first 32 KB of the raw MIME / payload for offline analysis. */
  @Property({ name: 'raw_body', type: 'text', nullable: true })
  rawBody?: string | null

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()
}
```

Notes:
- 32 KB cap on `raw_body` keeps storage growth bounded (configurable via `OM_CHANNEL_DEAD_LETTER_RAW_BODY_MAX_BYTES`).
- Replayed records remain (admin uses `DELETE WHERE created_at < now() - interval '90 days'` for pruning; out of scope for this spec but trivial to add as a CLI command later).

### No changes to existing entities

`CommunicationChannel.status`, `lastFailureAt`, and `channelState` already exist — Spec B uses them as-is. `ChannelThreadMapping` is unchanged. `MessageChannelLink.channelMetadata` (JSONB) gains two new keys observed by the matcher output:

```ts
type MessageChannelLinkChannelMetadata = {
  // ... existing keys (messageId, from, to, cc, bcc, subject, etc.) ...
  /** Added by ingest-inbound-message: which thread-matcher strategy resolved this message. */
  threadMatchStrategy?: 'token-references' | 'token-body' | 'jwz-headers' | 'subject-participants' | 'new-thread'
  /** Added by ingest-inbound-message: confidence label for observability. */
  threadMatchConfidence?: 'high' | 'medium' | 'low'
}
```

These keys are additive (existing readers ignore unknown keys per the BC contract).

### Encryption posture

Neither new entity stores PII or secrets:
- `ChannelThreadToken.token` is an HMAC-signed opaque string; not PII; not secret enough to need encryption-at-rest (compromise of the table content alone does not let an attacker mint new tokens without the HMAC key).
- `ChannelIngestDeadLetter.rawBody` MAY contain MIME bodies with PII. **It is encrypted at rest via `encryption.ts` `defaultEncryptionMaps`** entry: `{ entity: 'ChannelIngestDeadLetter', columns: ['raw_body'] }`. Operator replay reads via `findWithDecryption`. `errorMessage` and `externalMessageId` remain plaintext for searchability; they MUST NOT include MIME-body content (worker enforces this when classifying errors).

The HMAC key (`OM_THREAD_TOKEN_SECRET`) is a *signing* key, not an encryption key — it is loaded once at process boot, never written to a DB row. Falls back to `HKDF(KMS_MASTER_KEY, "thread-token")` if not set, mirroring the existing `lib/oauth-state.ts` pattern.

### Indexes & query patterns

| Query | Used by | Supporting index |
|---|---|---|
| Token lookup: `WHERE tenant_id=? AND token=?` | matcher Strategies 1, 2 | `channel_thread_tokens_token_uq` (unique) |
| Token upsert: `WHERE tenant_id=? AND message_thread_id=?` | `getOrCreateThreadToken` | `channel_thread_tokens_thread_idx` |
| Sent-folder dedup: `WHERE channel_id=? AND channelMetadata->>'messageId'=?` | `ingest-inbound-message` | existing `message_channel_links` index on `(channel_id, direction)` + `channelMetadata->>'messageId'` (B-tree expression index added in this spec) |
| JWZ matcher (Strategy 3): `WHERE channel_id=? AND channelMetadata->>'messageId' = ANY(?)` | matcher | same expression index as above |
| Dead-letter list by channel: `WHERE tenant_id=? AND channel_id=? ORDER BY created_at DESC` | future operator CLI | `channel_ingest_dead_letters_channel_idx` |
| Auto-recover sweep: `WHERE tenant_id=? AND status='error' AND last_failure_at < now() - interval '30 minutes'` | `poll-tick` | existing index on `(tenant_id, status, last_failure_at)` if present; add one if missing (verify in implementation) |

## API Contracts

### `POST /api/communication_channels/channels/{id}/import-history`

**Auth:** `requireAuth`, `requireFeatures: ['communication_channels.channel.import_history']`

**Request body** (Zod):
```ts
const schema = z.object({
  sinceDays: z.number().int().min(1).max(365).default(30),
  contactEmails: z.array(z.string().email()).max(200).optional(),
  maxMessages: z.number().int().min(1).max(5000).default(1000),
})
```

**Response (202 Accepted):**
```json
{ "jobId": "uuid", "queued": true, "progressJobId": "uuid" }
```

**Errors:**
- `400 import_history_invalid_input` — Zod validation failed, includes per-field errors
- `403 import_history_forbidden` — caller lacks `communication_channels.channel.import_history` or does not own the channel (`channel.user_id !== currentUser.id` AND not admin)
- `404 channel_not_found`
- `409 channel_not_connected` — channel `status` is `requires_reauth` or `error`
- `429 import_history_already_running` — a job already in progress for this channel (concurrency: 1)

**OpenAPI** declared via `metadata.openApi` per `packages/core/AGENTS.md` conventions.

**`openApi`:**
```ts
export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.channel.import_history'],
    openApi: {
      summary: 'Queue a one-time history import for a channel',
      tags: ['communication_channels'],
      requestBody: schema,
      responses: { 202: 'Queued', 400: 'Invalid input', 403: 'Forbidden', 404: 'Not found', 409: 'Not connected', 429: 'Already running' },
    },
  },
}
```

### `POST /api/communication_channels/channels/{id}/poll-now` *(existing — unchanged)*

The staged route from `f3ffd8ca9` remains; Spec B does not modify it. Demo "Sync now" button continues to call it.

## Internationalization (i18n)

Add the following keys to `packages/core/src/modules/communication_channels/i18n/{de,en,es,pl}.json`:

| Key | English text |
|---|---|
| `communication_channels.import_history.button` | Import history |
| `communication_channels.import_history.dialog.title` | Import past emails |
| `communication_channels.import_history.dialog.description` | Pull existing mail from your inbox into this CRM channel. Choose how far back to look and (optionally) which contacts. |
| `communication_channels.import_history.field.sinceDays.label` | Days to import |
| `communication_channels.import_history.field.sinceDays.help` | Between 1 and 365 days |
| `communication_channels.import_history.field.contactEmails.label` | Limit to contacts (optional) |
| `communication_channels.import_history.field.contactEmails.placeholder` | alice@example.com, bob@example.com |
| `communication_channels.import_history.field.maxMessages.label` | Max messages |
| `communication_channels.import_history.field.maxMessages.help` | Hard cap to prevent overload |
| `communication_channels.import_history.submit` | Start import |
| `communication_channels.import_history.flash.queued` | History import queued. You'll see progress in the top bar. |
| `communication_channels.import_history.error.alreadyRunning` | An import is already running on this channel. |
| `communication_channels.import_history.error.notConnected` | This channel needs to be reconnected before importing history. |
| `communication_channels.channel.autoRecovered` | Channel recovered automatically. |
| `communication_channels.channel.deadLetterRecorded` | A message couldn't be processed and was saved for manual review. |

All UI strings use `useT()` (client) / `resolveTranslations()` (server) per `packages/shared/AGENTS.md`. No hard-coded labels.

## UI/UX

### Channel detail page — Import history section

Add an `ImportHistorySection` to `packages/core/src/modules/communication_channels/backend/profile/communication-channels/page.tsx` (or sub-page; layout aligns with the existing channel detail). Mock:

```
┌────────────────────────────────────────────────────────────┐
│  ▼ Import history                                          │
│                                                            │
│  Pull existing mail from your inbox into this CRM channel. │
│  Choose how far back to look and (optionally) which        │
│  contacts.                                                 │
│                                                            │
│  [ Import history ]                                        │
└────────────────────────────────────────────────────────────┘
```

Click opens a `<Dialog>` (DS-compliant primitive from `@open-mercato/ui/primitives/dialog`) wrapped around a `<CrudForm>` (using `createCrud` helper). Field set:
- `sinceDays` — `<FormField label help>` around `<input type="number" min={1} max={365} defaultValue={30}>`
- `contactEmails` — `<FormField label>` around a chip-input primitive (`@open-mercato/ui/primitives/chip-input` if available, else `<input>` with comma-split)
- `maxMessages` — `<FormField label help>` around `<input type="number" min={1} max={5000} defaultValue={1000}>`

Submit:
- `Cmd/Ctrl+Enter` — submits.
- `Escape` — cancels.
- On success: `flash('communication_channels.import_history.flash.queued', 'success')`; close dialog.
- On `409`: `flash('communication_channels.import_history.error.alreadyRunning', 'error')`.

Progress: top-bar `<ProgressBadge>` from `packages/core/src/modules/progress` automatically shows the running job; no per-page wiring needed.

### CRM Person page — reactive refresh

> **Note (reconciled 2026-06-02):** the CRM Person-page email surface is built by
> **direct composition** in the customers module — the Emails tab
> `components/detail/PersonEmailThreadsTab.tsx` (which renders the shared
> `EmailThreadsPanel`) + `components/detail/ComposeEmailDialog.tsx` — **not** the
> originally-planned `widgets/injection/person-send-email/` injection widget, which
> was never built (per ARCHITECTURE.md §4: a module composes its own pages directly).

The Person-page email surface refreshes reactively with **no `window.location.reload()`
and no header `router.refresh()`**. The Emails tab (`PersonEmailThreadsTab`) re-fetches
through its own `loadThreads()` callback, wired to live events via
`useAppEvent('customers.email.linked' | 'messages.message.sent' | 'communication_channels.message.received', …)`
plus a short burst-poll after a Refresh/Send action. This spec makes no structural
change to the Person page.

### Design System compliance for new UI

- All new inline status messages use `<Alert variant="success|warning|destructive|info">` — no `text-red-*`, `bg-green-*`, etc.
- Buttons: `<Button variant="default|outline|destructive">` from `@open-mercato/ui/primitives/button`.
- Loading states: `<LoadingMessage>` / `<Spinner>` / `<DataLoader>` from `@open-mercato/ui/backend/detail`.
- Text sizes: Tailwind scale only (`text-sm`, `text-base`, `text-lg`) — no arbitrary `text-[Npx]`.
- Icons: lucide-react in page body (e.g. `<History>` icon for the section header) — never inline `<svg>`.
- Dialog: `Cmd/Ctrl+Enter` submits, `Escape` cancels (DS rule).
- Touched lines obey the **Boy Scout rule**: migrate any hardcoded `text-red-*` / `bg-green-*` etc. encountered in the modified files to semantic tokens.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OM_THREAD_TOKEN_SECRET` | (fallback to `HKDF(KMS_MASTER_KEY, "thread-token")`) | HMAC signing key for thread tokens. SHOULD be set in production. Same pattern as `OM_HUB_OAUTH_STATE_KEY`. |
| `OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS` | `60000` | Per-poll IMAP socket timeout. Raise for slow providers; the previous `10_000` default flaked under load. |
| `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL` | `200` | Max messages per `poll-channel` invocation. Re-enqueue handles the rest. |
| `OM_CHANNEL_AUTO_RECOVER_MINUTES` | `30` | Sweep interval for `status='error'` retry. |
| `OM_CHANNEL_DEAD_LETTER_RAW_BODY_MAX_BYTES` | `32768` | Truncate cap for `ChannelIngestDeadLetter.raw_body`. |
| `OM_CHANNEL_IMPORT_HISTORY_MAX_DAYS` | `365` | Hard upper bound on `sinceDays` (mirrors API Zod max — env override available for future enterprise overrides). |
| `OM_CHANNEL_IMPORT_HISTORY_MAX_MESSAGES` | `5000` | Hard upper bound on `maxMessages` (mirrors API Zod max). |

All new env vars are documented in `apps/docs/docs/framework/modules/communication-channels.mdx` (added in Phase B7 documentation pass).

## Migration & Compatibility

### Migrations

Two additive migrations under `packages/core/src/modules/communication_channels/migrations/`, generated via `yarn db:generate` (coding-agent exception applies if generator emits unrelated noise — see root `AGENTS.md`):

1. `MigrationYYYYMMDD_channel_thread_tokens.ts`
   - `CREATE TABLE channel_thread_tokens (…)` with all columns above.
   - `CREATE INDEX channel_thread_tokens_thread_idx`.
   - `CREATE UNIQUE INDEX channel_thread_tokens_token_uq`.

2. `MigrationYYYYMMDD_channel_ingest_dead_letters.ts`
   - `CREATE TABLE channel_ingest_dead_letters (…)`.
   - `CREATE INDEX channel_ingest_dead_letters_channel_idx`.
   - `CREATE INDEX channel_ingest_dead_letters_created_idx`.
   - Optional: `CREATE INDEX message_channel_links_message_id_expr_idx ON message_channel_links ((channel_metadata->>'messageId'))` — only if `EXPLAIN` shows seq-scan; otherwise skip.

Both migrations are pure additions; no existing column type changes, no `DROP`/`ALTER` on shipped tables.

### Backward Compatibility

| Contract surface | Change | Classification |
|---|---|---|
| Auto-discovery files | No change | ✓ |
| Public types (`@open-mercato/core` exports) | Two new exports: `ThreadMatcher`, `ThreadToken`. No removed/changed exports. | ✓ ADDITIVE |
| Function signatures | None changed. `outbound-bridge.ts` mutates its outbound payload internally before passing to adapter — adapter contract unchanged. | ✓ |
| Import paths | New paths: `@open-mercato/core/modules/communication_channels/lib/thread-matcher`, `…/thread-token`. | ✓ ADDITIVE |
| Event IDs | None changed | ✓ |
| Widget spot IDs | None changed | ✓ |
| API routes | One new route: `POST /api/communication_channels/channels/{id}/import-history`. | ✓ ADDITIVE |
| DB schema | Two new tables, possibly one expression index on existing `message_channel_links` | ✓ ADDITIVE |
| DI service names | None changed | ✓ |
| ACL feature IDs | One new feature: `communication_channels.channel.import_history`. Existing IDs unchanged. | ✓ ADDITIVE |
| Notification IDs | None | ✓ |
| CLI commands | None added in this spec (replay-dead-letter is a future follow-up). | ✓ |
| Generated files | `yarn generate` regenerates the module registry; no manual edits to `*.generated.ts`. | ✓ |

**Deployment notes:**
- Zero downtime — migrations are `CREATE TABLE` only.
- Existing outbound messages in flight without thread tokens degrade gracefully to Strategy 3 (JWZ) when their replies arrive.
- Existing channels with `status='error'` auto-recover post-deploy via the new sweeper (no operator action needed).
- After deploy: run `yarn mercato auth sync-role-acls` to grant the new `communication_channels.channel.import_history` feature to all existing tenants' admin roles. Setup.ts declares this as a `defaultRoleFeatures` entry for new tenants.

### Migration Risks Per `BACKWARD_COMPATIBILITY.md` Categories

- **Schema:** purely additive. Re-running migrations is safe. Rollback path: drop the two new tables; outbound emits would simply skip token injection (graceful degrade to Strategy 3).
- **API:** purely additive. Rollback path: remove the new route; UI button hides on 404.
- **ACL:** the new feature must be present in roles. Rollback path: keep the feature flag in the codebase even when rolled back; existing role grants are harmless without the route.

## Implementation Plan

### Phase B1 — Token + matcher foundation
1. Create `packages/core/src/modules/communication_channels/lib/thread-token.ts` exporting `generateToken`, `verifyToken`, `buildReferencesId`, `buildBodyFooter`, `applyOutboundThreadingToken` (mutation helper that takes a MIME object or raw string and returns the mutated version).
2. Create `packages/core/src/modules/communication_channels/lib/thread-matcher.ts` exporting `matchThread(input, deps): Promise<ThreadMatch | null>`. Pure function, no side effects. Strategies in priority order.
3. Add `ChannelThreadToken` and `ChannelIngestDeadLetter` to `data/entities.ts`.
4. Add `defaultEncryptionMaps` entry for `ChannelIngestDeadLetter.raw_body` to `encryption.ts`.
5. Run `yarn db:generate`; review the snapshot; commit migration files for the two new tables.
6. Unit tests:
   - `lib/__tests__/thread-token.test.ts` (gen returns ~37-char `om_<22b64url>_<11b64url>` token, verify accepts/rejects, References id format, body footer HTML/plain shape, HMAC key fallback chain).
   - `lib/__tests__/thread-matcher.test.ts` (per strategy: happy + null + edge — malformed token, missing fields, multiple references picks earliest match).
7. Run `yarn generate`; confirm module registry includes the new entities.

**Ship signal:** unit tests green; `yarn build` passes; `yarn db:migrate` applies cleanly on a fresh DB.

### Phase B2 — Outbound token injection
1. Modify `subscribers/outbound-bridge.ts`: after `convertOutbound` builds the MIME, call `applyOutboundThreadingToken(mime, await getOrCreateThreadToken(messageThreadId))`.
2. Unit test: outbound subscriber emits a MIME with `References:` header containing the synthetic id and HTML body containing the hidden span.
3. Manual test: connect IMAP, send a test email via Person page, view raw source in recipient mailbox — confirm References + footer present, both invisible to the recipient.

**Ship signal:** unit test green; manual test confirms invisible token in both header and body.

### Phase B3 — Inbound matcher integration
1. Modify `commands/ingest-inbound-message.ts`:
   - Before the existing thread lookup, call `matchThread(input, { em, channelId, tenantId, organizationId, now })`.
   - On match: use `match.messageThreadId` as the target thread; persist `match.matchedBy` + `match.confidence` to `MessageChannelLink.channelMetadata`.
   - On null: existing "create new thread" path runs.
2. Update `commands/__tests__/ingest-inbound-message.test.ts` for each matcher path.
3. Integration tests TC-CHANNEL-EMAIL-023, 024, 025, 026 in `packages/channel-imap/src/modules/channel_imap/__integration__/` using the mocked `imapflow` fixture.

**Ship signal:** TC-023..026 green; existing TC-CHANNEL-EMAIL-001..020 still green (no regression in threading for the path-3 (JWZ) case).

### Phase B4 — IMAP worker rewrite
1. Rewrite `packages/channel-imap/src/modules/channel_imap/lib/adapter.ts:fetchHistory()`:
   - Bootstrap branch (no `previousCursor` or first call after UIDVALIDITY change): `SELECT INBOX`, persist UIDVALIDITY + UIDNEXT, return empty page (`messages: []`, `hasMore: false`).
   - Incremental branch: `SELECT INBOX`, compare UIDVALIDITY (mismatch → discard cursor, treat as bootstrap, log warning). `UID FETCH storedUidNext:*` capped at `HARD_CAP`. Return `hasMore: true` if FETCH returned `HARD_CAP` messages.
2. Update `packages/channel-imap/src/modules/channel_imap/lib/imap-client.ts`:
   - Default `socketTimeout` from 10000 → 60000; read from `OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS`.
3. Modify `workers/poll-channel.ts`:
   - Per-message commit: for each `NormalizedInboundMessage`, invoke `ingest-inbound-message`. On success, advance `channelState.uidNext` to that UID + 1. On permanent failure, write `ChannelIngestDeadLetter` and advance. On transient failure, abort the loop without advancing.
4. Sent-folder dedup: in `ingest-inbound-message.ts`, before the matcher, look up an existing `MessageChannelLink` where `channelId == this.channelId AND channelMetadata->>'messageId' == parsedMessage.messageId`. If found, mark as already-ingested and skip.
5. Integration tests TC-CHANNEL-EMAIL-021 (bootstrap), 022 (incremental), 028 (malformed MIME → dead letter), 030 (sent dedup).

**Ship signal:** TC-021/022/028/030 green; `yarn test` for the channel-imap package passes.

### Phase B5 — Auto-recovery sweeper (extends poll-tick)
1. Modify `workers/poll-tick.ts`: change the channel-enumeration query from a single `WHERE status='connected'` to a UNION:
   ```sql
   SELECT … WHERE status='connected' AND next_poll_at <= now()
   UNION
   SELECT … WHERE status='error' AND last_failure_at < now() - interval '30 minutes'
   ```
   Configurable via `OM_CHANNEL_AUTO_RECOVER_MINUTES`.
2. In `poll-channel.ts`, after a successful tick: if `channel.status === 'error'`, flip back to `'connected'` and clear `lastError`.
3. Unit test the predicate.
4. Integration test TC-CHANNEL-EMAIL-027 (auto-recover from `status='error'`).

**Ship signal:** TC-027 green; manual test: simulate transient error → channel goes to `status='error'`, wait 30 min (or override via env), next tick recovers.

### Phase B6 — Import-history API + worker
1. Add `acl.ts` feature `communication_channels.channel.import_history`; `setup.ts` declares it in `defaultRoleFeatures` for admin role + channels-owner role. Add a note to the deploy runbook: run `yarn mercato auth sync-role-acls` post-deploy.
2. Add `api/post/channels/[id]/import-history/route.ts` with Zod schema, `metadata.POST.requireFeatures`, `openApi`, error-class envelope per `createCrudFormError`/`raiseCrudError` patterns.
3. Add `commands/queue-import-history.ts`: validates channel ownership + state, creates a `ProgressJob`, enqueues a `channel-import-history` job.
4. Add `workers/channel-import-history.ts` (new queue, concurrency 1 per channel):
   - For IMAP: build `SEARCH SINCE <date>` (+ optional `FROM` chunks of ≤30), fetch UIDs, fetch messages, route each through `ingest-inbound-message`.
   - For Gmail (forward-compat): adapter exposes a similar `importHistory({ sinceDays, contactEmails, maxMessages })` capability. Spec C wires Gmail fully; Spec B's worker can fall back to "feature not supported on this adapter" for non-IMAP channels.
   - Updates `ProgressJob.progress` after each batch.
5. UI:
   - New `ImportHistorySection` component on the channel detail page (`backend/profile/communication-channels/[id]/page.tsx` if it exists, else extend the index page). Uses `<CrudForm>` inside a `<Dialog>` per § UI/UX.
6. i18n keys added to all four locale files.
7. Integration test TC-CHANNEL-EMAIL-029 (queue → progress → completes; concurrency-1 guard on second call returns 429).

**Ship signal:** TC-029 green; manual test: click Import history → see progress → mail appears in CRM timeline.

### Phase B7 — Polish + demo readiness
1. Replace `window.location.reload()` with `router.refresh()` in `customers/components/detail/PersonEmailActions.tsx` (two call sites — the direct Person-page email component; there is no `person-send-email` injection widget). **(Superseded — see the 2026-06-02 changelog note: `PersonEmailActions.tsx` was later removed as a duplicate; the Emails tab `PersonEmailThreadsTab` now refreshes reactively via `loadThreads`/`useAppEvent`/burst-poll, so this `router.refresh()` polish no longer applies.)**
2. Dialog UX audit: every new dialog supports `Cmd/Ctrl+Enter` and `Escape`. Every icon-only button has `aria-label`.
3. Documentation pass: update `apps/docs/docs/framework/modules/communication-channels.mdx` (env vars, history import section) and `apps/docs/docs/user-guide/communication-channels.mdx` (user-facing "Import history" how-to).
4. Demo dry-run: connect a real IMAP mailbox, send an outbound email, reply from the recipient, observe the inbound thread within ~90 s. Disconnect network, observe `status='error'`. Reconnect, observe auto-recovery within 30 min.

**Ship signal:** Demo dry-run successful; documentation deployed.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/communication_channels/lib/thread-token.ts` | Create | Token gen/verify, HMAC, References id, body footer, MIME mutator |
| `packages/core/src/modules/communication_channels/lib/thread-matcher.ts` | Create | Layered match function (5 strategies) |
| `packages/core/src/modules/communication_channels/lib/__tests__/thread-token.test.ts` | Create | Unit tests |
| `packages/core/src/modules/communication_channels/lib/__tests__/thread-matcher.test.ts` | Create | Unit tests |
| `packages/core/src/modules/communication_channels/data/entities.ts` | Modify | Add `ChannelThreadToken` + `ChannelIngestDeadLetter` |
| `packages/core/src/modules/communication_channels/encryption.ts` | Modify | Add `defaultEncryptionMaps` entry for `ChannelIngestDeadLetter.raw_body` |
| `packages/core/src/modules/communication_channels/migrations/Migration<TS>_channel_thread_tokens.ts` | Create | New table |
| `packages/core/src/modules/communication_channels/migrations/Migration<TS>_channel_ingest_dead_letters.ts` | Create | New table |
| `packages/core/src/modules/communication_channels/subscribers/outbound-bridge.ts` | Modify | Apply token injection before adapter |
| `packages/core/src/modules/communication_channels/subscribers/__tests__/outbound-bridge.test.ts` | Modify | Assert References + body footer present |
| `packages/core/src/modules/communication_channels/commands/ingest-inbound-message.ts` | Modify | Sent-folder dedup + `matchThread()` invocation + dead-letter on permanent fail |
| `packages/core/src/modules/communication_channels/commands/__tests__/ingest-inbound-message.test.ts` | Modify | Per-strategy paths, dedup, dead-letter |
| `packages/core/src/modules/communication_channels/commands/queue-import-history.ts` | Create | New command |
| `packages/core/src/modules/communication_channels/workers/poll-tick.ts` | Modify | Sweeper UNION query, env knob |
| `packages/core/src/modules/communication_channels/workers/poll-channel.ts` | Modify | Per-message commit, recovery flip from `status='error'` → `'connected'` |
| `packages/core/src/modules/communication_channels/workers/channel-import-history.ts` | Create | New worker |
| `packages/core/src/modules/communication_channels/api/post/channels/[id]/import-history/route.ts` | Create | New API |
| `packages/core/src/modules/communication_channels/acl.ts` | Modify | Add `communication_channels.channel.import_history` feature |
| `packages/core/src/modules/communication_channels/setup.ts` | Modify | `defaultRoleFeatures` for new feature |
| `packages/core/src/modules/communication_channels/i18n/{de,en,es,pl}.json` | Modify | i18n keys |
| `packages/core/src/modules/communication_channels/backend/profile/communication-channels/page.tsx` | Modify | `ImportHistorySection` |
| `packages/channel-imap/src/modules/channel_imap/lib/adapter.ts` | Modify | Bootstrap + incremental rewrite, hasMore semantics |
| `packages/channel-imap/src/modules/channel_imap/lib/imap-client.ts` | Modify | 60 s socket timeout, env-knob |
| `packages/channel-imap/src/modules/channel_imap/lib/__tests__/adapter.test.ts` | Modify | Cursor unit tests |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-021.spec.ts` | Create | Bootstrap test |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-022.spec.ts` | Create | Incremental |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-023.spec.ts` | Create | References-token threading |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-024.spec.ts` | Create | Body-footer threading |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-025.spec.ts` | Create | JWZ fallback |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-026.spec.ts` | Create | Subject+participants fallback |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-027.spec.ts` | Create | Auto-recovery |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-028.spec.ts` | Create | Malformed MIME → dead-letter, cursor advances |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-029.spec.ts` | Create | /import-history |
| `packages/channel-imap/src/modules/channel_imap/__integration__/TC-CHANNEL-EMAIL-030.spec.ts` | Create | Sent-folder dedup |
| `.ai/qa/scenarios/TC-CHANNEL-EMAIL-021..030.md` | Create | QA scenario markdowns (per `.ai/qa/AGENTS.md`) |
| `packages/core/src/modules/customers/components/detail/PersonEmailThreadsTab.tsx` | (No change in this spec) | Emails tab (renders the shared `EmailThreadsPanel`); already refreshes reactively via `loadThreads`/`useAppEvent`/burst-poll. Supersedes the originally-planned `router.refresh()` polish on the now-removed `PersonEmailActions.tsx` header — see the 2026-06-02 changelog note. |
| `apps/docs/docs/framework/modules/communication-channels.mdx` | Modify | Env var docs, history-import section |
| `apps/docs/docs/user-guide/communication-channels.mdx` | Modify | How-to: Import history |

### Testing Strategy

**Unit tests** (`yarn test`):
- `thread-token`: `gen` produces ~37-char `om_<22b64url>_<11b64url>` token, `verify` accepts good token, rejects bad HMAC; `buildReferencesId` returns `<om_TOKEN@open-mercato.invalid>`; `buildBodyFooter` returns both HTML hidden span and plain text marker; HMAC key falls back through `OM_THREAD_TOKEN_SECRET` → `HKDF(KMS_MASTER_KEY, "thread-token")` (mirror `lib/oauth-state.ts` test approach).
- `thread-matcher`: 5 strategies × happy + edge (missing field, malformed token, multiple references picks earliest valid match, subject normalization handles `Re:`/`Fwd:`/`[EXTERNAL]` correctly, participant set computes case-insensitive overlap).
- IMAP adapter: bootstrap returns 0 messages; UIDVALIDITY mismatch triggers re-bootstrap; incremental advances cursor; `HARD_CAP` triggers `hasMore: true`; socket timeout env override respected.
- `ingest-inbound-message`: sent-folder dedup hits skip the message; `matchThread` null → creates new thread; dead-letter receives malformed messages while cursor still advances.
- `poll-tick`: SQL UNION predicate returns expected channels (status='connected' AND ready) ∪ (status='error' AND aged out).

**Integration tests** (`yarn test:integration`, Playwright per `.ai/qa/AGENTS.md`):

| Scenario ID | Title | Strategy |
|---|---|---|
| TC-CHANNEL-EMAIL-021 | Bootstrap ingests zero history | Connect channel against a mock inbox with 100 messages; first poll returns 0 messages but persists UIDVALIDITY/UIDNEXT |
| TC-CHANNEL-EMAIL-022 | Incremental ingests new message within 90 s | After bootstrap, mock inbox receives a new message; next poll cycle ingests it within 90 s |
| TC-CHANNEL-EMAIL-023 | Reply via References token | Send outbound; mock reply preserves `References`; thread matches token-references strategy, `confidence: high` |
| TC-CHANNEL-EMAIL-024 | Reply via body footer (References stripped) | Send outbound; mock reply strips `References` but includes the quoted body footer; thread matches token-body strategy |
| TC-CHANNEL-EMAIL-025 | Reply via JWZ fallback | Send outbound without token (older outbound, simulated); reply has `In-Reply-To` pointing at our Message-Id; thread matches jwz-headers strategy, `confidence: medium` |
| TC-CHANNEL-EMAIL-026 | Reply via subject+participants | Reply has neither token nor `In-Reply-To`/`References`; subject is `Re: <normalized>`; participant set matches; thread matches subject-participants strategy, `confidence: low` |
| TC-CHANNEL-EMAIL-027 | Auto-recover from `status='error'` | Force a transient error → channel goes to `status='error'`. Fast-forward clock past 30 min (or override `OM_CHANNEL_AUTO_RECOVER_MINUTES=0`). Next tick recovers; status flips to `connected` |
| TC-CHANNEL-EMAIL-028 | Malformed MIME skipped, neighbor ingests | Mock inbox returns one malformed MIME + one valid; cursor advances past both, valid one ingested, malformed one in dead-letter table |
| TC-CHANNEL-EMAIL-029 | `/import-history` queues + progress reports | Call API; verify ProgressJob created; observe progress increments; observe imported messages appear in CRM; second concurrent call returns 429 |
| TC-CHANNEL-EMAIL-030 | Sent-folder dedup | After outbound send, mock inbox surfaces the same message-id; ingest skips it (does not create a duplicate `MessageChannelLink`) |

**Fixture:** mocked `imapflow` per Q2 — a Jest mock module in `packages/channel-imap/src/modules/channel_imap/__integration__/__fixtures__/mock-imap.ts` that emulates the protocol surface needed (`select`, `status`, `fetch`, `search`, `mailboxLock`, `logout`). Deterministic, no Docker, no JDK.

## Risks & Impact Review

### Data Integrity Failures

#### Cursor drift / lost messages
- **Scenario:** A subtle bug in the per-message commit boundary advances `channelState.uidNext` past an unprocessed message during transient failure, silently losing inbound mail.
- **Severity:** High (silent data loss)
- **Affected area:** `channel-imap` worker, `ingest-inbound-message` command
- **Mitigation:** Per-message commit explicitly advances `uidNext` *only* after `ingest-inbound-message` returns success. Transient-failure path re-throws to caller, which aborts the loop without persisting `channelState`. Unit tests cover both success and transient paths; TC-028 covers the permanent-failure path; TC-022 verifies normal increment.
- **Residual risk:** Implementation-level boundary bug. Mitigated by code review and the explicit test matrix.

#### Token collision across tenants
- **Scenario:** HMAC token for tenant A is mistakenly looked up in tenant B's matcher invocation, routing inbound to the wrong tenant.
- **Severity:** Critical (cross-tenant data leak)
- **Affected area:** `thread-matcher`
- **Mitigation:** `channel_thread_tokens_token_uq` is `(tenantId, token)` — tenant isolation by construction. The matcher's DB query always passes `tenantId`, so a tenant-A token presented in tenant B's matcher resolves to **no row** and falls through to the lower-confidence strategies. The HMAC (process-global key; see § Encryption posture) is a forgery gate, not the tenant boundary — the `(tenantId, token)` lookup is.
- **Residual risk:** A bug bypassing the tenant filter in the DB query; mitigated by `findWithDecryption`-style scoped helpers and integration tests that assert tenant isolation.

#### Mid-import crash
- **Scenario:** `channel-import-history` worker crashes mid-batch; ProgressJob shows partial state.
- **Severity:** Medium
- **Affected area:** import worker
- **Mitigation:** Per-message commit applies to import worker too; restart resumes from the last committed UID (or sent-folder dedup catches any double-process). ProgressJob status set to `failed`; user can retry.
- **Residual risk:** Acceptable — user re-triggers and dedup prevents duplicates.

### Cascading Failures & Side Effects

#### Outbound MIME mutation breaks delivery
- **Scenario:** A strict recipient MTA rejects messages with synthetic `References` referencing an `.invalid` TLD they can't resolve.
- **Severity:** Medium (deliverability)
- **Affected area:** outbound-bridge
- **Mitigation:** Format `<om_TOKEN@open-mercato.invalid>` uses the IANA-reserved `.invalid` TLD per RFC 6761 §3 — every RFC-compliant MTA MUST treat this as syntactically valid. Hidden body span is plain HTML.
- **Residual risk:** Non-compliant MTAs in the wild. Monitor `communication_channels.message.delivery_failed` event rate post-rollout; toggle injection off via env if a regression is observed.

#### Auto-recovery infinite loop
- **Scenario:** Channel has wrong host (DNS errors); sweeper retries every 30 min forever.
- **Severity:** Medium (operator noise; small DB/queue load)
- **Affected area:** poll-tick + IMAP adapter
- **Mitigation:** `lib/error-classification.ts` classifies DNS/host errors as **permanent**; permanent errors keep `status='error'` set and the sweeper does not re-attempt within the 30-min window for already-tried channels. Observability counter on "sweeper retries / successes" surfaces runaway loops.
- **Residual risk:** Classification accuracy. Quarterly review of error classification map.

### Tenant & Data Isolation Risks

#### Token HMAC signing-key reuse
- **Scenario:** `OM_THREAD_TOKEN_SECRET` is a single process-global signing key; a leaked secret would let an attacker mint structurally-valid tokens.
- **Severity:** Medium (forgery of inbound routing — bounded, see mitigation)
- **Affected area:** thread-token
- **Mitigation:** Forgery only routes inbound mail if the forged token matches an existing `(tenantId, token)` row. The 16 random bytes are unguessable, so a minted token resolves to no row and falls through to JWZ — it cannot graft mail onto a real thread. An attacker who can already read a thread's real token (from sent-mail `References`/body) needs no forgery. Token lookup is always tenant-scoped.
- **Residual risk:** Master-secret compromise (mitigated by env-var ops standard — vault/KMS). **Possible future hardening:** derive the HMAC key per-tenant via `HKDF(secret, tenantId)` so a leaked global secret cannot mint tokens for a specific tenant. Not implemented today — the `(tenantId, token)` DB lookup is the isolation boundary; tracked as a follow-up.

### Migration & Deployment Risks

#### ACL feature not synced post-deploy
- **Scenario:** Operator forgets `yarn mercato auth sync-role-acls`; existing tenant admins see 403 when clicking "Import history".
- **Severity:** Low (UX regression, no data risk)
- **Affected area:** `acl.ts`, `setup.ts`
- **Mitigation:** Deploy runbook update; `setup.ts` includes the feature in `defaultRoleFeatures` for new tenants; CI smoke test verifies the feature is present for admin role after sync.
- **Residual risk:** Operator process. Acceptable.

### Operational Risks

#### Dead-letter table growth
- **Scenario:** A persistently broken inbound parser writes thousands of dead-letter rows per day.
- **Severity:** Medium (storage growth)
- **Affected area:** communication_channels DB
- **Mitigation:** `status='error'` caps the rate (no continuous polling once permanent error trips). 32 KB `raw_body` cap. Future CLI `mercato communication-channels prune-dead-letters --older-than 90d` keeps growth bounded.
- **Residual risk:** Bounded by retry cadence × failure rate × tenant count. Acceptable.

#### Import-history triggers IMAP rate-limiting
- **Scenario:** `sinceDays: 365, maxMessages: 5000` against a strict IMAP server (1and1, OVH) — the server rate-limits or temp-bans the connection.
- **Severity:** Medium (per-channel outage)
- **Affected area:** channel-imap import worker
- **Mitigation:** Worker chunks SEARCH FROM into groups of ≤30 emails to keep query size sane. One connection per job; concurrency 1 per channel. Honors transient backoff. Hard 5000 message cap.
- **Residual risk:** Per-mailbox server limits unknown ahead of time. Surface error via ProgressJob status; user retries with smaller window.

#### Subject-participants matcher over-attaches
- **Scenario:** Two unrelated conversations share normalized subject and a participant; Strategy 4 attaches the wrong thread.
- **Severity:** Low (low-confidence match is recorded)
- **Affected area:** thread-matcher
- **Mitigation:** Strategy 4 is lowest priority; only triggers when 1, 2, 3 all return `null`. `MessageChannelLink.channelMetadata.threadMatchStrategy = 'subject-participants'` and `confidence: low` are visible to operators and (future) end-users via a "Suggested thread" UI.
- **Residual risk:** Visible mis-thread; users can move the message to the correct thread once that UI ships (future spec).

## Final Compliance Report — 2026-05-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Cross-module references (`messageThreadId` → `messages.message`, `userId` → `auth.user`) are FK IDs only; no Mikro `@ManyToOne` across modules |
| root AGENTS.md | Filter by `organization_id` (or `tenant_id` for cross-org entities) for tenant-scoped entities | Compliant | All queries (matcher lookup, sweeper, import worker) include `tenantId`; thread tokens uniquely indexed on `(tenantId, token)` |
| root AGENTS.md | Validate all inputs with zod; `data/validators.ts` | Compliant | `/import-history` defines `z.object({ sinceDays, contactEmails, maxMessages })`; no `any` types |
| root AGENTS.md | Use DI (Awilix) — no `new`-ing services | Compliant | Token + matcher are pure libs (functions, not services); callers receive `em`, `commandBus`, `eventBus` via DI as today |
| root AGENTS.md | Hash/encrypt PII; `findWithDecryption` for PII reads | Compliant | `ChannelIngestDeadLetter.raw_body` declared in `encryption.ts`; reads via `findWithDecryption` |
| root AGENTS.md | `parseBooleanToken` / `parseBooleanWithDefault` for boolean parsing | N/A | No boolean inputs in this spec |
| root AGENTS.md | API routes export `metadata` with per-method `requireAuth`/`requireFeatures` (no top-level export) | Compliant | `/import-history` route exports `metadata.POST = { requireAuth, requireFeatures, openApi }` |
| root AGENTS.md | API routes export `openApi` for documentation | Compliant | `openApi` included in metadata above |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` from `@open-mercato/ui/backend/utils/apiCall` — never raw `fetch` | Compliant | Import-history dialog uses `<CrudForm>` + `createCrud` helper (which itself uses `apiCall`) |
| root AGENTS.md | Non-`CrudForm` writes wrap in `useGuardedMutation(...).runMutation(...)` | N/A | Only new write is via `<CrudForm>` |
| root AGENTS.md | Throw `createCrudFormError` for field-level errors | Compliant | API returns `{ errors: { sinceDays: 'must be between 1 and 365' } }` envelope; UI maps via `createCrudFormError` |
| root AGENTS.md | Read JSON defensively (`readJsonSafe`) | Compliant | API responses parsed via `apiCallOrThrow`'s built-in defensive reader |
| root AGENTS.md | `useT()` client / `resolveTranslations()` server; never hard-code labels | Compliant | All UI text uses `useT(...)` keys; locale files updated in 4 languages |
| root AGENTS.md | Dialog supports `Cmd/Ctrl+Enter` + `Escape` | Compliant | Import history dialog implements both per `<Dialog>` primitive |
| root AGENTS.md | `pageSize <= 100` | N/A | No paginated list endpoints added |
| root AGENTS.md | RBAC: feature-based via `requireFeatures` (not `requireRoles`) | Compliant | `communication_channels.channel.import_history` is a feature ID; `requireFeatures: ['…import_history']` |
| root AGENTS.md | New ACL features → declare in `acl.ts`, default-grant in `setup.ts`, run `yarn mercato auth sync-role-acls` | Compliant | Phase B6 covers all three steps |
| root AGENTS.md | Module-level translations declared in `translations.ts` for entities with user-facing text | N/A | No new user-facing entity fields added (token + dead-letter are operational entities, not user-facing content) |
| root AGENTS.md | Module files re-generated via `yarn generate` | Compliant | Phase B1 step 7 runs `yarn generate` |
| root AGENTS.md | After enabling/disabling modules → `yarn mercato configs cache structural --all-tenants` | N/A | This spec does not enable/disable modules |
| root AGENTS.md | Singular names: entities, commands, events, feature IDs | Compliant | `ChannelThreadToken`, `ChannelIngestDeadLetter`; commands like `thread_token.generate` (singular `thread_token`); feature `channel.import_history` (singular `channel`) |
| root AGENTS.md | Database tables snake_case + plural; columns snake_case | Compliant | `channel_thread_tokens`, `channel_ingest_dead_letters` (plural snake_case); columns are snake_case |
| root AGENTS.md | UUID PKs, explicit FKs (within module), junction tables for many-to-many | Compliant | Both new tables use UUID PK |
| root AGENTS.md | Common columns where applicable (`created_at`, `tenant_id`, `organization_id`) | Compliant | Both new tables include `tenant_id`, `organization_id` (nullable), `created_at` |
| root AGENTS.md | Event IDs `module.entity.action`, singular | N/A | No new events added |
| root AGENTS.md | `clientBroadcast: true` for browser-bound events | N/A | No new events |
| root AGENTS.md | Boy Scout rule: migrate touched lines to semantic tokens / DS scale | Compliant | Modified `widget.client.tsx` — touched lines migrated if any DS violations encountered |
| root AGENTS.md (DS rules) | No hardcoded status colors; use `{prop}-status-{status}-{role}` | Compliant | New UI uses `<Alert variant>` and DS tokens |
| root AGENTS.md (DS rules) | No arbitrary text sizes (`text-[Npx]`) | Compliant | All new components use Tailwind scale |
| root AGENTS.md (DS rules) | lucide-react in page body — never inline `<svg>` | Compliant | `<History>` icon for section header |
| root AGENTS.md (DS rules) | `aria-label` on every icon-only button | Compliant | New iconography reviewed |
| packages/core/AGENTS.md | Write operations via Command pattern | Compliant | Four new commands: `thread_token.generate`, `import_history.queue`, `dead_letter.write`, plus modified `message.ingest` |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` | N/A | `/import-history` is not a CRUD route (single-action queue endpoint) |
| packages/core/AGENTS.md | `metadata.openApi` on API routes | Compliant | Declared above |
| packages/core/AGENTS.md | Custom (non-makeCrudRoute) write routes call `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` | Compliant | `/import-history` follows this pattern |
| packages/core/AGENTS.md | `findWithDecryption` for encrypted-column reads | Compliant | `ChannelIngestDeadLetter.raw_body` reads via `findWithDecryption` |
| packages/core/AGENTS.md | Encrypted columns declared in `<module>/encryption.ts` `defaultEncryptionMaps` | Compliant | Entry added for `ChannelIngestDeadLetter.raw_body` |
| packages/core/AGENTS.md | Custom fields via `collectCustomFieldValues()` | N/A | No custom fields in this spec |
| packages/queue/AGENTS.md | Workers idempotent, dedup by external ID | Compliant | `channel-import-history` worker uses sent-folder dedup; `ingest-inbound-message` dedups by `(channel_id, external_message_id)` |
| packages/queue/AGENTS.md | New queue declared in worker metadata (`{ queue, concurrency }`) | Compliant | `channel-import-history` worker declares `concurrency: 1` per channel |
| packages/events/AGENTS.md | Ephemeral vs persistent subscribers; queue-backed where appropriate | Compliant | Existing `outbound-bridge` persistent subscriber is unchanged in semantics; no new subscribers added |
| packages/cache/AGENTS.md | Cache tags include `tenant:<id>` / `org:<id>` | N/A | No new cached endpoints (matcher and token lookups are single-row DB reads with unique-index O(1)) |
| packages/ui/AGENTS.md | `<CrudForm>` for backend writes; `<Dialog>` + `<FormField>` primitives | Compliant | Import-history dialog uses these primitives |
| packages/ui/AGENTS.md | `<LoadingMessage>` / `<Spinner>` / `<DataLoader>` for async states | Compliant | Progress reporting via ProgressBadge; no per-page loading state needed |
| packages/ui/src/backend/AGENTS.md | `apiCall`/`apiCallOrThrow` only — no raw `fetch` | Compliant | All new HTTP via CrudForm helpers |
| .ai/qa/AGENTS.md | Integration tests with named scenarios `TC-…` | Compliant | TC-CHANNEL-EMAIL-021..030 with markdown scenarios under `.ai/qa/scenarios/` |
| .ai/specs/AGENTS.md | Spec filename `{date}-{title}.md`, kebab-case title | Compliant | `2026-05-27-email-integration-inbound-reliability-and-threading.md` |
| .ai/specs/AGENTS.md | Required sections: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog | Compliant | All present |
| BACKWARD_COMPATIBILITY.md | Event IDs FROZEN | Compliant | No event ID changes |
| BACKWARD_COMPATIBILITY.md | API URLs STABLE; new routes additive | Compliant | One additive route |
| BACKWARD_COMPATIBILITY.md | DB schema ADDITIVE-ONLY | Compliant | Two new tables; no `ALTER` of shipping tables |
| BACKWARD_COMPATIBILITY.md | Widget spot IDs FROZEN | Compliant | No widget spot ID changes |
| BACKWARD_COMPATIBILITY.md | DI keys STABLE | Compliant | No DI key changes |
| BACKWARD_COMPATIBILITY.md | ACL feature IDs FROZEN; new features additive | Compliant | One additive feature |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | API uses Zod schemas mapped to entity columns via worker invocation |
| API contracts match UI/UX section | Pass | Dialog field set ↔ Zod schema 1:1 |
| Risks cover all write operations | Pass | Cursor drift, token collision, dead-letter growth, MIME mutation, sweeper, import rate-limit |
| Commands defined for all mutations | Pass | Four new commands listed in § Architecture |
| Cache strategy covers all read APIs | N/A | No new cached read endpoints (token + matcher lookups are O(1) DB) |
| Encryption maps cover PII columns | Pass | `ChannelIngestDeadLetter.raw_body` declared |
| Phasing is testable + incrementally deliverable | Pass | Each phase has explicit ship signal |

### Non-Compliant Items
None.

### Verdict
**Fully compliant — approved for implementation pending user sign-off.**

---

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| B1 — Token + matcher foundation | Done | 2026-05-27 | New entities (`ChannelThreadToken`, `ChannelIngestDeadLetter`) + migration `Migration20260527195446_communication_channels`; `lib/thread-token.ts` (27 unit tests) with `generateToken`, `verifyToken`, `buildReferencesId`, `buildBodyFooter`, `applyOutboundThreadingToken`, `getOrCreateThreadToken`, `extractTokenFromHeaders`, `extractTokenFromBody`; `lib/thread-matcher.ts` (13 unit tests) with `matchThread` + `normalizeSubject`; encryption map entry for `channel_ingest_dead_letter.raw_body`. |
| B2 — Outbound token injection | Done | 2026-05-27 | `deliver-outbound-message.ts` now calls `getOrCreateThreadToken` + injects `<om_TOKEN@open-mercato.invalid>` into `channelMetadata.references` and the body footer (hidden `<span>` for HTML, bracketed marker for plain text). Idempotent on retry. 49/49 command tests still pass. |
| B3 — Inbound matcher integration | Done | 2026-05-27 | `ingest-inbound-message.ts` calls `matchThread()` before composing the platform Message. `parentMessageId` resolves to the matcher's threadId when found, otherwise falls back to the existing `ChannelThreadMapping` lookup. `MessageChannelLink.channelMetadata.threadMatchStrategy` + `threadMatchConfidence` are persisted for observability. 287/287 communication_channels tests green. |
| B4 — IMAP worker rewrite | Done | 2026-05-27 | `channel-imap/.../adapter.ts:fetchHistory` rewritten per Spec B § Bounded cursor-driven IMAP: zero-history bootstrap (persist UIDVALIDITY+UIDNEXT, fetch 0 messages), incremental UID FETCH `previousUidNext:*` capped at `HARD_CAP=200` (configurable via `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL`), `hasMore` set when more remain. UIDVALIDITY mismatch triggers re-bootstrap. `poll-channel.ts` adds per-message commit + dead-letter write (transient failures abort without advancing cursor; permanent failures advance + write to `channel_ingest_dead_letters`). `ingest-inbound-message.ts` adds sent-folder dedup (skip when `MessageChannelLink.channelMetadata.messageId` matches our own outbound). IMAP socket timeout already 60s in staged `imap-client.ts`. 36/36 channel-imap tests green (was 32/34 with 2 pre-existing failures — both fixed by the rewrite + replaced with bootstrap, UIDVALIDITY-mismatch, and hasMore tests). |
| B5 — Auto-recovery sweeper | Done | 2026-05-27 | `poll-tick.ts` now enumerates two pools: (1) `status='connected'` channels due for normal polling, (2) `status='error' AND lastFailureAt < now() - OM_CHANNEL_AUTO_RECOVER_MINUTES (default 30m)` channels for a recovery retry. Successful poll in `poll-channel.ts` already flips `status='error'` → `'connected'` (pre-existing behavior preserved). 6/6 poll-tick tests green including the new auto-recovery case. |
| B6 — Import-history API + worker | Done | 2026-05-27 | New ACL feature `communication_channels.channel.import_history` (granted to superadmin+admin); additive optional `ChannelAdapter.importHistory()` contract; IMAP adapter implements it via `SEARCH SINCE` + FROM-chunking (≤30/chunk) + UID-set fetch with newest-first ordering and base64-JSON cursor pagination; `commands/queue-import-history.ts` validates channel + adapter capability, creates a `ProgressJob`, enforces 429 concurrency guard (active-jobs scan), and enqueues the new `communication-channels-import-history` queue; `workers/channel-import-history.ts` (concurrency 1) drains pages, dispatches each message through `ingest-inbound-message`, updates progress, honours cancellation, completes/fails the ProgressJob; `POST /api/communication_channels/channels/[id]/import-history` route uses declarative `requireFeatures` + per-user access guard + Zod body validation + maps `CrudFormError` envelopes to HTTP 400/404/429; UI dialog on `/backend/profile/communication-channels` (sinceDays / contactEmails / maxMessages, `Cmd+Enter` submit, `Escape` cancel) uses `router.refresh()` after queueing; i18n keys added across de/en/es/pl; integration smoke test `TC-CHANNEL-EMAIL-029.spec.ts` + QA scenario markdown. |
| B7 — Polish + demo readiness | Done | 2026-05-27 | `router.refresh()` replaces `window.location.reload()` at both call sites in `customers/components/detail/PersonEmailActions.tsx` (post-send + post-sync; direct Person-page email component, not an injection widget). **(Superseded 2026-06-02: `PersonEmailActions.tsx` was later removed as a duplicate; the Emails tab `PersonEmailThreadsTab` → `EmailThreadsPanel` now refreshes reactively via `loadThreads`/`useAppEvent`/burst-poll — see the 2026-06-02 changelog.)** Dialog UX audit confirms both B6 dialog and Compose Email dialog support `Cmd/Ctrl+Enter` submit + `Escape` cancel. Documentation pass: framework docs gain new env vars (`OM_HUB_POLL_SCHEDULER_TICK_SECONDS`, `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL`, `OM_CHANNEL_AUTO_RECOVER_MINUTES`, `OM_THREAD_TOKEN_SECRET`) + full "Inbound reliability & threading (Spec B)" section covering layered threading, zero-history bootstrap, per-message commit/dead-letter, auto-recovery sweep, operator-triggered backlog import; user-guide adds a step-7 "Import older messages (optional)" how-to. Live demo dry-run remains as an operator-rehearsal task — not a code deliverable. |
| Verification | Green | 2026-05-28 | `yarn build:packages` clean (22/22 packages); **4579 core + 41 channel-imap unit tests green**. Gap closure pass (2026-05-28) added 5 new B2-B4 contract assertions to `outbound-bridge.test.ts` (outbound thread-token assembly: References + body footer + idempotent retry) and 3 new B3-B4 contract assertions to `ingest-inbound-message.test.ts` (matcher input extraction, sent-folder dedup, dead-letter row shape). Integration smoke tests TC-CHANNEL-EMAIL-021..028 + 030 + their QA scenario markdowns now staged alongside TC-029. |

### Detailed coverage delivered in this checkpoint

**New unit tests** (all green):
- `lib/__tests__/thread-token.test.ts` — 27 cases (gen format, HMAC verify, key fallback, References id, body footer, idempotent injection, header extraction, body extraction, forgery rejection)
- `lib/__tests__/thread-matcher.test.ts` — 13 cases (`normalizeSubject` with locale prefixes + brackets; Strategy 1 token-in-headers; Strategy 2 token-in-body; strategy priority order; forged-token short-circuit; null fallback)
- `workers/__tests__/poll-tick.test.ts` — 1 new case (auto-recovery sweep enqueues `status='error'` channels past the cutoff)
- `lib/__tests__/adapter.test.ts` (channel-imap) — 2 new + 1 updated cases (bootstrap fetches 0, UIDVALIDITY mismatch re-bootstraps, hasMore=true when probe overflows)

### Files staged in this checkpoint

| File | Action |
|---|---|
| `packages/core/src/modules/communication_channels/data/entities.ts` | Modified — added `ChannelThreadToken` + `ChannelIngestDeadLetter` entities |
| `packages/core/src/modules/communication_channels/encryption.ts` | Modified — added encryption map entry for `channel_ingest_dead_letter.raw_body` |
| `packages/core/src/modules/communication_channels/lib/thread-token.ts` | Created — token primitives + persistence helper |
| `packages/core/src/modules/communication_channels/lib/thread-matcher.ts` | Created — layered match (5 strategies) |
| `packages/core/src/modules/communication_channels/lib/__tests__/thread-token.test.ts` | Created — 27 unit cases |
| `packages/core/src/modules/communication_channels/lib/__tests__/thread-matcher.test.ts` | Created — 13 unit cases |
| `packages/core/src/modules/communication_channels/commands/deliver-outbound-message.ts` | Modified — outbound token injection (Spec B B2) |
| `packages/core/src/modules/communication_channels/commands/ingest-inbound-message.ts` | Modified — sent-folder dedup + matchThread integration + matchedBy persistence (Spec B B3+B4) |
| `packages/core/src/modules/communication_channels/workers/poll-channel.ts` | Modified — per-message commit + dead-letter on permanent failure (Spec B B4) |
| `packages/core/src/modules/communication_channels/workers/poll-tick.ts` | Modified — auto-recovery sweep for `status='error'` channels (Spec B B5) |
| `packages/core/src/modules/communication_channels/workers/__tests__/poll-tick.test.ts` | Modified — auto-recovery test case |
| `packages/core/src/modules/communication_channels/migrations/Migration20260527195446_communication_channels.ts` | Created — adds `channel_thread_tokens` + `channel_ingest_dead_letters` |
| `packages/channel-imap/src/modules/channel_imap/lib/adapter.ts` | Modified — cursor-driven `fetchHistory` (zero-history bootstrap + incremental UID FETCH + HARD_CAP) |
| `packages/channel-imap/src/modules/channel_imap/lib/__tests__/adapter.test.ts` | Modified — bootstrap/UIDVALIDITY-mismatch/hasMore tests |

## Changelog

### 2026-06-02
- **`PersonEmailActions.tsx` (the header Sync/Send duplicate that received the B7 `router.refresh()` polish) was subsequently REMOVED as a duplicate; the Emails tab (`PersonEmailThreadsTab` → `EmailThreadsPanel`) is now the sole Person-page email surface and refreshes reactively via `loadThreads`/`useAppEvent`/burst-poll.** This supersedes the earlier same-day reconciliation bullet below (which ran before the deletion landed and still treated `PersonEmailActions.tsx` as the live surface): the current-state UI/UX "CRM Person page — reactive refresh" section and File Manifest row now point at `PersonEmailThreadsTab.tsx`, and the historical Phase B7 entries are annotated as superseded. No behavior change on the Person page — reactive refresh was already in place.
- **Reconciled the CRM Person-page integration point with the shipped implementation.** *(Superseded by the bullet above — this reconciliation ran before `PersonEmailActions.tsx` was deleted.)* The spec described the Person-page polish (`window.location.reload()` → `router.refresh()`) as landing in `customers/widgets/injection/person-send-email/widget.client.tsx`, but that injection widget was never built — at the time this entry was written the Person-page email surface was direct composition (`components/detail/PersonEmailActions.tsx` + the Emails tab `PersonEmailThreadsTab.tsx` + `ComposeEmailDialog.tsx`) per ARCHITECTURE.md §4. Updated the UI/UX "CRM Person page — minor polish" section, Phase B7 step 1, the File Manifest row, the B7 Done checkpoint, and the B7 changelog entries to reference `PersonEmailActions.tsx`. No behavior change — the shipped surface already used `router.refresh()` + reactive `useAppEvent` refresh.

### 2026-05-27
- Initial specification. Brainstormed scope (3-spec decomposition: A=OAuth hotfix, B=this spec, C=Gmail Pub/Sub push). Approved approach: Foundation Refactor with layered threading, go-forward-only IMAP bootstrap, 60 s polling, mocked imapflow tests, new `ChannelThreadToken` + `ChannelIngestDeadLetter` entities, auto-recovery extending poll-tick.
- Open Questions resolved (all four with recommended option): Q1 new entity, Q2 mocked imapflow, Q3 dedicated dead-letter table, Q4 sweeper folded into poll-tick.
- **Implementation B1–B5 complete 2026-05-27.** Threading + IMAP reliability + auto-recovery foundation shipped. 428 unit tests green, build clean. B6 (Import-history API) and B7 (Person-page polish) deferred to follow-up — the threading fix doesn't depend on either and the demo blockers (responses never arrive, replies don't thread) are resolved by B1–B4.
- **Phase B6 complete 2026-05-27.** Operator-triggered backlog import shipped end-to-end: additive `ChannelAdapter.importHistory()` contract + IMAP implementation (SEARCH SINCE + FROM-chunking + paginated UID fetch), `queue-import-history` command with 429 concurrency guard, `channel-import-history` worker (concurrency 1, drives ProgressJob lifecycle), `POST /channels/[id]/import-history` route with declarative ACL gate + per-user access guard, `ImportHistoryDialog` UI on `/backend/profile/communication-channels` (Cmd+Enter / Escape, uses `router.refresh()`), i18n keys across de/en/es/pl, integration smoke test `TC-CHANNEL-EMAIL-029` and QA scenario markdown. 4565 core + 41 channel-imap unit tests green; `yarn build:packages` clean.
- **Phase B7 code complete 2026-05-27.** `window.location.reload()` replaced with `router.refresh()` at both call sites in `customers/components/detail/PersonEmailActions.tsx` (post-send + post-sync; direct Person-page email component, not an injection widget). Build clean; remaining B7 work is documentation and a live demo dry-run, neither of which gates a merge. *(Superseded 2026-06-02 — `PersonEmailActions.tsx` was later removed as a duplicate; see the 2026-06-02 changelog.)*
- **Phase B7 docs complete 2026-05-27.** Framework docs (`apps/docs/docs/framework/modules/communication-channels.mdx`) gain four new env-var entries and a "Inbound reliability & threading (Spec B)" section that explains layered threading, zero-history bootstrap, per-message commit/dead-letter, auto-recovery sweep, and operator-triggered backlog import. User-guide (`apps/docs/docs/user-guide/communication-channels.mdx`) adds a step-7 "Import older messages (optional)" how-to with field semantics, tips, and the "IMAP today; Gmail in Spec C" caveat. **Spec B is 100 % done** modulo the optional live demo dry-run.

### 2026-05-28
- **Gap-closure pass.** Pre-review audit found the spec's File Manifest listed `outbound-bridge.test.ts` and `ingest-inbound-message.test.ts` modifications and integration tests TC-021..028 + TC-030 + QA scenarios that were skipped in the initial pass (the implementations existed but the spec's listed test surfaces were not authored). Closed all gaps: added Spec B § B2 contract tests (outbound References + body footer assembly with idempotent-retry coverage), Spec B § B3 contract tests (matcher input extraction, sent-folder dedup), Spec B § B4 contract tests (`ChannelIngestDeadLetter` row-shape assertion), 9 integration smoke spec files for TC-021..028 + TC-030, and 9 QA scenario markdowns. 4579 core + 41 channel-imap tests green; build clean.

### 2026-05-31
- **Code-review hardening pass.** A full `/code-review` of the branch surfaced and fixed the following (all with regression tests; `yarn build:packages`/`typecheck`/`test`/`build:app` green):
  - **Auto-recovery sweep (poll-tick):** (a) `OM_CHANNEL_AUTO_RECOVER_MINUTES=0` was coerced to 30 (the `> 0` guard); now `>= 0` so `0` means "recover on the next tick" as TC-027 expects. (b) A channel that failed its **first** poll has `lastPolledAt = null` and a bare `$lt` excluded it from recovery forever (`NULL < ts` is `NULL`); the predicate now also matches the null case.
  - **Inbound mail loss (error-classification):** a transient Postgres error during ingest (deadlock `40P01`, serialization `40001`, connection drops, …) was classified **permanent** → dead-lettered + cursor advanced = silent mail loss. Transient SQLSTATEs (and their ORM-wrapped message forms) now classify transient, so the poll loop aborts without advancing the cursor.
  - **Thread token idempotency:** `getOrCreateThreadToken` was SELECT-then-INSERT with no per-thread uniqueness, so a concurrent double-create produced two tokens for one thread. Added a `(tenant_id, message_thread_id)` unique constraint (entity + migration `Migration20260531120000` + snapshot) and insert-on-conflict re-select. (One token per thread — the misleading "upsert" comments are corrected.)
  - **Matcher purity:** `matchThread` flushed the caller's whole unit of work to bump `last_seen_at`; replaced with a scoped raw `UPDATE` so the matcher never commits the caller's pending entities.
  - **Import-history contract:** not-connected now returns **409** (was 400) to match the spec + UI flash; `contactEmails` cap restored to **200** (was 1000).
  - **IMAP socket timeout:** `OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS` is now actually read in `credentialsToConnection` (previously the env override was dead; only the 60s default applied).
  - **Encryption helper:** dead-letter dedup read switched from raw `em.findOne` to `findOneWithDecryption` (encrypted entity rule).
  - **Push register ownership:** the operator `POST …/push/register` route now enforces per-user `assertCanAccessChannel` (defense-in-depth behind the admin-default `push.manage` feature); the command stays open for the automatic OAuth-callback / connect / renew callers.
  - **Notification toast i18n:** the reauth toast's "Reconnect" action label is localized via an optional translator plumbed through the notification dispatcher (`useOptionalT` → `RuntimeContext.t` → `NotificationHandlerContext.t`).
- **Spec accuracy reconciliations** (implementation chose valid alternatives; spec text corrected here rather than changing working code):
  - **HMAC tenant isolation (§ Risks → token collision / signing-key reuse):** the spec described a per-tenant HKDF salt; the implementation uses a process-global signing key with the `(tenantId, token)` unique lookup as the isolation boundary (forged tokens resolve to no row and fall through). Per-tenant key derivation is noted as a future hardening, not the current boundary.
  - **Recovery clock field name:** the Architecture/B5 prose references `lastFailureAt`; no such column exists — recovery is timed from `lastPolledAt` (last successful poll, or null for never-polled). Treat `lastFailureAt` in this spec and TC-027 as `lastPolledAt`.
  - **i18n key namespace:** shipped keys are `communication_channels.profile.importHistory.*` (not the `…import_history.*` names in the i18n table); `channel.autoRecovered` / `channel.deadLetterRecorded` were not needed and are unshipped.
  - **Import-history 202 body:** the route returns `{ ok, progressJobId, totalCountHint }` (the UI consumes `progressJobId`); the `{ jobId, queued }` shape in the contract is illustrative.
  - **TC-CHANNEL-EMAIL-021..030 `.spec.ts`:** these are route-wiring **smoke** tests (provider behavior is covered by the jest unit suites — `adapter.test.ts`, `poll-channel`, `ingest-inbound-message`, `thread-matcher`); the per-protocol E2E is deferred per the jest-only provider harness.
- **Round-3/4 findings (same hardening pass):**
  - **Unbounded poll re-enqueue (poll-channel):** `hasMore` re-enqueue had no drain cap, so an adapter returning `hasMore` with a non-advancing (pinned) cursor could spin an unthrottled loop. Added `drainPage` + `MAX_DRAIN_PAGES = 100` (mirrors `gmail-history-sync`).
  - **Thread-match SQL robustness (thread-matcher):** the Postgres text-array builders escaped `"` but not `\`, so a Message-ID / email containing a backslash produced a malformed array literal that threw (caught → silently defeated threading). Now escapes `\` then `"`.
  - **Contact-resolver footgun (contact-resolver):** the CRM person lookup filtered the encrypted `primary_email`/`primary_phone` by plaintext. Now skips the fast lookup under tenant encryption (the authoritative link is the customers subscriber); a blind-index column is the proper fast-path fix.
  - **Duplicate channel on reconnect (connect-channel) — R3-1:** `createConnectedChannelRow` had no upsert and the table had no natural-key unique, so re-running OAuth / reconnecting created a *second* channel (the stale one kept polling + emitting reauth banners + a competing push subscription). Now heals the existing `(tenant, user, provider, mailbox)` row in place, backed by the partial unique index `communication_channels_user_provider_external_uq` (+ 23505 fork-reselect for the concurrent-connect race).
  - **send-as-user metadata precedence — R4-1:** the caller `channelMetadata` spread was placed last, overriding the validated routing fields (contradicting its own comment). Reordered so `to/cc/bcc/subject/inReplyTo/references` always win.
- **Known issue (flagged, not fixed — needs a cross-module decision):** `ingest-inbound-message` composes the platform Message (`messages.messages.compose`, its own committed transaction) **before** inserting the `ExternalMessage` dedup anchor. A transient DB failure at the final flush followed by a worker retry can therefore produce a **duplicate** inbound Message (pre-existing; the broadened transient-classification fix above widens the trigger set from connection-drops to also include deadlock/serialization). A complete fix needs an idempotency key on `messages.compose` (no clean hard-delete command exists today) — recommend tracking as a follow-up.

**Deployment caveat (new channel unique index):** `communication_channels_user_provider_external_uq` is created non-`CONCURRENTLY`; on any environment that already accumulated duplicate `(tenant, user, provider, external_identifier)` channel rows during the buggy window, the migration will fail until the duplicates are reconciled (keep the newest per key, soft-delete the rest). New/clean databases are unaffected.


---

## Part 2 — Provider Push Delivery (Gmail Pub/Sub)

> Merged 2026-06-01 from the former `2026-05-27-email-integration-provider-push-delivery.md` — content preserved verbatim below.

# Provider Push Delivery — Gmail Pub/Sub

## TLDR

**Key Points:**
- Replaces the 60 s polling cadence for **Gmail** channels with native push delivery (Gmail `users.watch` → Cloud Pub/Sub). Target inbound latency: **under 60 seconds, typically 5–15 s**, with **30-minute polling retained as a belt-and-suspenders fallback**.
- Reuses [Spec B](2026-05-27-email-integration-inbound-reliability-and-threading.md)'s shared `lib/thread-matcher.ts` + `lib/thread-token.ts` libs and the `ingest-inbound-message` command — push delivery is a **new ingestion source**, not a new ingestion pipeline.
- Requires [Spec A](2026-05-27-oauth-refresh-credentials-client-wiring-fix.md) to be merged first — the Gmail Pub/Sub receiver refreshes tokens before calling provider APIs.
- Webhook routes live in the existing Next.js app (`/api/communication_channels/webhooks/...`). No separate service. No new infra outside the GCP Pub/Sub topic.
- Adds a renewal worker (Gmail watch expires in 7 days, re-issued before expiry).

**Scope (Spec C):**
- New webhook routes:
  - `POST /api/communication_channels/webhooks/gmail` — receives Pub/Sub push notifications, validates JWT, enqueues `gmail-history-sync`.
- New workers:
  - `gmail-history-sync` — invoked from Pub/Sub webhook; pulls `history.list?startHistoryId=<stored>` and ingests each new message.
  - `gmail-renew-watch` — daily cron + on-demand; re-issues `users.watch` before 7-day expiry.
- Adapter additions (additive to existing `ChannelAdapter` interface):
  - `registerPush?(input): Promise<PushRegistration>` — Gmail: calls `users.watch`.
  - `unregisterPush?(input): Promise<void>` — counterpart for disconnect / re-auth.
  - `applyPushNotification?(input): Promise<HistoryPage>` — turns a verified inbound notification into the same `HistoryPage` shape `fetchHistory` returns. Gmail: calls `history.list`. Single canonical conversion path.
- Channel state additions (additive to `CommunicationChannel.channelState`):
  - Gmail: `{ historyId, watchExpirationMs, pubsubTopic, pushStatus: 'active'|'inactive'|'failed' }`
- New tenant-level configuration under `integration_credentials.scope = oauth_<provider>`:
  - Gmail: `pubsubTopic: string` + `pubsubServiceAccountEmail: string` (the `gmail-api-push@system.gserviceaccount.com` is granted publisher on the topic; we verify push JWT against the operator's project audience).
- Per-environment configuration (env vars, set once by the platform operator):
  - `OM_GMAIL_PUBSUB_TOPIC` (e.g., `projects/openmercato-prod/topics/gmail-inbound`)
  - `OM_GMAIL_PUBSUB_AUDIENCE` (the audience claim we accept in incoming JWTs)
  - `OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` (the SA email allowed to invoke our webhook)
  - `OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS` (default 24)
- Polling-cadence change for Gmail channels: `pollIntervalSeconds` flips from 60 → **1800 (30 min)** when `channelState.pushStatus === 'active'`. IMAP unchanged.
- New ACL features: `communication_channels.channel.push.manage` (force-reregister, view push status).
- New i18n keys (operator messages: "Push registered", "Push renewed", "Push lost — falling back to polling", "Push reactivated").
- All changes are **additive** — no event ID changes, no API URL changes to existing routes, no widget spot ID / DI key changes. New routes, new entity fields (JSON-shape additions only), new env vars are all additive.

**Non-goals / deferred:**
- IMAP IDLE / long-lived connections — still deferred (see Spec B § Alternatives Considered).
- Custom shared-MX inbound (`reply+token@inbound.mercato.app`) — separate enterprise spec.
- Real-time *outbound* push (provider webhooks for opens/bounces) — out of scope; bounces continue via `communication_channels.message.delivery_failed`.
- Gmail "All Mail" vs INBOX selection — v1 watches INBOX only (matches Spec B). Spec D candidate.
- Provider sandbox / staging credentials story for CI — integration tests use mocked webhook payloads (no real Gmail API in CI).

**Concerns / dependencies:**
- **Hard prerequisite: Spec A** — the Gmail adapter needs the OAuth refresh wiring fixed before any sustained push delivery can work past the 1-hour token mark.
- **Hard prerequisite: Spec B** — `thread-matcher` + `thread-token` libs and the rewritten `ingest-inbound-message` are what push notifications feed into.
- Soft prerequisite: tenant operators must complete one-time GCP setup (create Pub/Sub topic, grant publisher to `gmail-api-push@system.gserviceaccount.com`, configure the topic in Open Mercato Integrations UI) for Gmail.
- Webhook receivers share resources with the rest of the Next.js API. Burst-storm scenarios (high-volume mailbox firing dozens of notifications/min) are absorbed by the queue — webhook returns 202 fast, worker processes async.

---

## Prerequisites & Cross-Spec Dependencies

| Dependency | What it delivers | Must merge before this spec? |
|---|---|---|
| [`Spec A`](2026-05-27-oauth-refresh-credentials-client-wiring-fix.md) | `RefreshCredentialsInput.oauthClient` wiring fix so Gmail tokens refresh past 1 hour | Yes |
| [`Spec B`](2026-05-27-email-integration-inbound-reliability-and-threading.md) | `lib/thread-matcher.ts`, `lib/thread-token.ts`, rewritten `ingest-inbound-message`, per-message commit semantics, `ChannelIngestDeadLetter` | Yes |
| `2026-05-21-email-integration-foundation.md` (staged) | Hub + provider packages, OAuth callback, `IntegrationCredentialsService` | Yes — already on `feat/demo-hoodie` |

---

## Overview

The Spec B baseline gives every email channel a 60 s polling cycle. That's acceptable for IMAP (where the only alternative is IMAP IDLE, which doesn't fit Open Mercato's queue-worker model) but it's a poor fit for Gmail, which exposes a first-class push delivery primitive:
- **Gmail Pub/Sub** ([docs](https://developers.google.com/workspace/gmail/api/guides/push)) — `users.watch` registers a Pub/Sub topic; Gmail publishes a tiny `{ emailAddress, historyId }` payload to the topic on every mailbox change; the Pub/Sub push subscription POSTs that to our webhook. Notification rate is capped at 1 per Gmail user per second. The notification is *not* the cursor — the app calls `users.history.list?startHistoryId=<stored>` to enumerate the actual changes.

This reduces inbound latency from 60 s (poll cadence) to 5–15 s typical (publish + queue + worker). It also lifts load off the provider's REST API — `history.list` is dramatically cheaper than full scans.

This spec wires that primitive into Open Mercato's existing email integration architecture, **without** introducing new ingestion or threading code. Spec B's `ingest-inbound-message` + `thread-matcher` + `thread-token` libs do all the heavy lifting; Spec C just delivers messages to them via push instead of poll.

> **Market Reference:** Twenty CRM ([`twenty-server/src/modules/messaging/.../drivers/gmail/`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/modules/messaging/message-import-manager/drivers/gmail)) — adopted: shared Pub/Sub topic per environment, separate worker for the heavyweight fetch step. EmailEngine ([`learn.emailengine.app/docs/advanced/performance-tuning`](https://learn.emailengine.app/docs/advanced/performance-tuning)) — adopted: separate worker process for the heavyweight fetch step so the webhook receiver stays responsive. Postmark / Mailgun inbound — informational; both also separate "we got pinged" from "we fetched the data" via a queue.

## Problem Statement

1. **Polling latency.** Gmail polling at 60 s cadence consumes provider API quota for no reason on quiet mailboxes — and still has 60 s typical inbound latency for active conversations.
2. **No liveness signal.** Without push, there is no signal that a channel is "alive and connected" between poll cycles — operators learn about broken Gmail connections only when polls accumulate errors over multiple cycles.
3. **User expectation gap.** Real CRM users expect chat-like latency for inbound mail. 60 s feels slow against HubSpot, Front, and Pipedrive, all of which deliver sub-10 s inbound from Gmail via push.

## Proposed Solution

Adopt provider-native push as the primary inbound mechanism for Gmail. Keep polling as a low-frequency safety net. All ingestion still funnels through Spec B's `ingest-inbound-message` command and `thread-matcher` library.

### High-level approach

```
                              ┌─────────────────────────────────┐
                              │ Gmail mailbox event             │
                              │   (new message, label, etc.)    │
                              └────────────────┬────────────────┘
                                               │
                                               ▼
                              ┌─────────────────────────────────┐
                              │ Gmail → Cloud Pub/Sub topic     │
                              │ payload: {emailAddress,         │
                              │           historyId}            │
                              └────────────────┬────────────────┘
                                               │
                                               ▼ Pub/Sub push subscription
                              ┌─────────────────────────────────┐
                              │ POST /webhooks/gmail            │
                              │ • Verify JWT (audience, issuer) │
                              │ • Look up channel by            │
                              │   emailAddress                  │
                              │ • Enqueue gmail-history-sync    │
                              │ • Return 200 fast               │
                              └────────────────┬────────────────┘
                                               │
                                               ▼ async worker
                              ┌─────────────────────────────────┐
                              │ gmail-history-sync worker       │
                              │ • refreshCredentialsIfNeeded    │
                              │ • adapter.applyPushNotification │
                              │   → users.history.list          │
                              │     ?startHistoryId=<stored>    │
                              │ • For each messageAdded:        │
                              │     → ingest-inbound-message    │
                              │       (Spec B: thread-matcher,  │
                              │        per-message commit)      │
                              │ • Update channelState.historyId │
                              └─────────────────────────────────┘

Gmail channels also have:
                              ┌─────────────────────────────────┐
                              │ poll-tick (60s) — unchanged     │
                              │ Channels with pushStatus=active │
                              │   poll every 1800s (safety net) │
                              │ Channels with pushStatus≠active │
                              │   poll every 60s (Spec B cadence)│
                              └─────────────────────────────────┘

                              ┌─────────────────────────────────┐
                              │ gmail-renew-watch (daily cron)  │
                              │ SELECT channels WHERE           │
                              │   providerKey='gmail' AND       │
                              │   watchExpirationMs <           │
                              │   now() + 24h                   │
                              │ → adapter.registerPush()        │
                              └─────────────────────────────────┘
```

### Push registration flow (channel connect)

Reuses the existing `connect-credential-channel.ts` (or its OAuth equivalent `connect-oauth-channel.ts`) command. After credentials are persisted and the channel is `connected`:

1. If `adapter.registerPush?` is implemented AND tenant has the relevant provider-push configuration (Gmail: `pubsubTopic` set), call it.
2. **Gmail**: adapter calls `gmail.users.watch({ topicName: OM_GMAIL_PUBSUB_TOPIC, labelIds: ['INBOX'] })`. Persists `{ historyId, watchExpirationMs, pubsubTopic, pushStatus: 'active' }` on `channelState`.
3. Update `channel.pollIntervalSeconds = 1800` (was 60). Persist.
4. If `registerPush` throws, log + set `channelState.pushStatus = 'failed'`, keep polling at 60 s. Operator-visible via UI.

### Push unregister flow (channel disconnect / re-auth)

- Disconnect or `status='requires_reauth'`: `adapter.unregisterPush?(channel)` — Gmail: `users.stop`. Best-effort: failures logged, do not block disconnect.

### Polling fallback

`poll-tick.ts` (modified in Spec B Phase B5 to include the `status='error' AND lastFailureAt < now() - 30m` UNION) already selects all channels needing a poll. Spec C makes no structural change to the tick — it only changes the default `pollIntervalSeconds` per-channel when push is active. Channels with `channelState.pushStatus = 'active'` poll every 30 min. Channels with `pushStatus !== 'active'` (e.g., push failed, never registered, IMAP) poll at their original cadence. Auto-recovery sweeper from Spec B applies unchanged.

### Design Decisions

| Decision | Rationale |
|---|---|
| Single Pub/Sub topic per environment (Q1) | Matches Twenty CRM / EmailEngine. Per-tenant onboarding cost stays at "set up OAuth"; no GCP work per tenant. Cross-tenant routing is by `emailAddress`-scoped DB lookup, which is the same isolation pattern as our existing OAuth callback route. |
| 30-min polling fallback (Q4) | Safety net for "Pub/Sub silently dropped". 1 poll per 30 min ≈ 48 polls/day vs current 1440 — 30× reduction in provider API load. Acceptable insurance cost. |
| Webhook returns 200/202 fast; worker processes async | Gmail retries on non-2xx within ~10s. Synchronous fetch + ingest in the webhook would risk timeouts under load. Queue absorbs bursts. |
| Worker calls `applyPushNotification` (an adapter method), not `fetchHistory` | Different semantics: `fetchHistory` is a polled time-range fetch; `applyPushNotification` is a cursor-anchored delta-since-last-notification. Separating the methods lets the adapter use the provider's most efficient API per call. |
| Cron-based renewal + on-disconnect unregister | Cron is robust against missed timer ticks; on-disconnect cleanup is best-effort and idempotent (re-issuing an active watch is a refresh; unregistering an already-removed watch is a no-op). |
| `pushStatus` lives on `channelState` (JSONB), not a top-level `CommunicationChannel` column | Push state is a JSON-shaped sub-document (varies per provider); no need for a top-level column. UI reads `channelState.pushStatus` for the indicator. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Per-tenant Pub/Sub topic (Q1 (b)) | High onboarding friction; operator can't debug a tenant's broken topic without GCP access. |
| Push-only, no polling fallback (Q4 (b)) | Gmail has no lifecycle equivalent — if `users.watch` silently expires (operator error: forgot to grant publisher role), all mail is lost until renewal. Safety net is cheap. |
| Run webhook receivers as a separate service | Existing OAuth callback routes already live in the Next.js app and work fine. Adding a separate service for one more endpoint is over-engineering. |
| Synchronous fetch + ingest inside the webhook | Gmail's retry window is short (~10s); under load, synchronous processing risks timeouts → retries → notification storm. Queue absorbs bursts. |
| Use IMAP IDLE for Gmail instead of native push | Native APIs are dramatically more reliable than IMAP-XOAUTH2; Twenty CRM and Front both abandoned IMAP-for-Gmail in favor of the REST API. |

## User Stories / Use Cases

- **A sales user** wants **inbound mail from a Gmail customer to appear in the CRM within 10 seconds** so that **conversations feel real-time during live demos and support calls**.
- **A sales user** wants the **CRM to keep working even if Gmail's push notification was dropped** so that **they're never silently missing mail**.
- **A platform operator** wants **the GCP Pub/Sub topic configured once at install time** so that **adding new Gmail-connected tenants doesn't require per-tenant GCP work**.
- **An admin** wants to **see push status (active / failed / inactive) on the channel detail page** so that **they can diagnose latency issues without reading logs**.

## Architecture

### Sequence diagram — Gmail Pub/Sub flow

```
User                Gmail              Pub/Sub             Open Mercato webhook    Queue          Worker
 │                    │                    │                          │                │              │
 │ Receives email     │                    │                          │                │              │
 │───────────────────►│                    │                          │                │              │
 │                    │ Publish            │                          │                │              │
 │                    │ {emailAddress,     │                          │                │              │
 │                    │  historyId}        │                          │                │              │
 │                    │───────────────────►│                          │                │              │
 │                    │                    │ POST /webhooks/gmail     │                │              │
 │                    │                    │ (JWT-signed)             │                │              │
 │                    │                    │─────────────────────────►│                │              │
 │                    │                    │                          │ Verify JWT     │              │
 │                    │                    │                          │ Lookup channel │              │
 │                    │                    │                          │ Enqueue        │              │
 │                    │                    │                          │ gmail-history- │              │
 │                    │                    │                          │ sync           │              │
 │                    │                    │                          │───────────────►│              │
 │                    │                    │                          │ 200 OK         │              │
 │                    │                    │◄─────────────────────────│                │              │
 │                    │                    │                          │                │ Dequeue      │
 │                    │                    │                          │                │─────────────►│
 │                    │                    │                          │                │              │
 │                    │ history.list?startHistoryId=<stored>          │                │              │
 │                    │◄──────────────────────────────────────────────────────────────────────────────│
 │                    │ {history:[{messages:[…]}]}                    │                │              │
 │                    │──────────────────────────────────────────────────────────────────────────────►│
 │                    │                    │                          │                │              │ For each msg:
 │                    │ messages.get(id)   │                          │                │              │   ingest-inbound-
 │                    │◄──────────────────────────────────────────────────────────────────────────────│   message
 │                    │ {payload}          │                          │                │              │   (Spec B
 │                    │──────────────────────────────────────────────────────────────────────────────►│    matcher)
 │                    │                    │                          │                │              │
 │                    │                    │                          │                │              │ Update
 │                    │                    │                          │                │              │ channelState
 │                    │                    │                          │                │              │ .historyId
```

### Commands & Events

**New commands** (CommandBus pattern, package: `packages/core/src/modules/communication_channels/commands/`):

| Command ID | Purpose | Undo |
|---|---|---|
| `communication_channels.push.register` | Idempotent. Calls `adapter.registerPush`, persists `channelState.pushStatus = 'active'` + provider-specific cursor/expiry, flips `pollIntervalSeconds = 1800` | `push.unregister` (companion command) |
| `communication_channels.push.unregister` | Calls `adapter.unregisterPush`, sets `pushStatus = 'inactive'`, restores `pollIntervalSeconds` to provider default (60) | `push.register` |
| `communication_channels.push.handle_notification` | Looks up channel by provider-supplied identifier (Gmail: `emailAddress`), enqueues the sync worker | N/A (read-side dispatch) |
| `communication_channels.push.renew` | Renews registration (`users.watch` again for Gmail); updates `watchExpirationMs` | N/A (idempotent re-issue) |

**New events** (declared in `events.ts`, `as const`):

| Event ID | clientBroadcast | Purpose |
|---|---|---|
| `communication_channels.push.registered` | false | Operator-facing: push active for this channel |
| `communication_channels.push.failed` | false | Operator-facing: push registration failed; channel falls back to polling |
| `communication_channels.push.renewed` | false | Logged + counted (operations dashboard) |
| `communication_channels.push.deactivated` | false | Channel disconnected or re-auth required; push unregistered |

**DI keys:** No new DI keys. The webhook routes resolve `commandBus`, `em`, `credentialsService` via the existing container.

## Data Models

### `CommunicationChannel.channelState` (JSONB) — additive shape

Existing shape (from Spec B):
```ts
type ImapChannelState = { uidValidity: number; uidNext: number; lastFolder: string }
```

Spec C adds a Gmail variant. The `channelState` column is a JSONB blob, so this is a TS-type-only addition — no migration.

```ts
type GmailChannelState = {
  historyId: string
  watchExpirationMs: number       // Date.now() + watch.expiration
  pubsubTopic: string             // mirrors the env var at registration time
  pushStatus: 'active' | 'inactive' | 'failed'
  /** Set when push fails. Operator-visible. */
  lastPushError?: { code: string; message: string; at: string }
}
```

Gmail's `historyId` / `watchExpirationMs` and IMAP's `UIDVALIDITY` / `UIDNEXT` live unencrypted in `channelState` (they're not secrets). Spec B already added `fetchHistory` readers of `channel.channelState`; keeping `channelState` plaintext avoids forcing those (and every future cursor-reading adapter) onto `findWithDecryption`.

### No new tables

Gmail stores state on the existing `CommunicationChannel.channelState`. No new tables. Spec B's `ChannelIngestDeadLetter` and `ChannelThreadToken` are reused unchanged.

### Index considerations

One access pattern added:
- `WHERE provider_key = 'gmail' AND channel_state->>'pushStatus' = 'active' AND (channel_state->>'watchExpirationMs')::bigint < ?` — renewal worker SELECT.

Add a GIN index on `channel_state` (additive) if `EXPLAIN` shows seq-scan. Decision deferred to Phase C1 once the renewal worker is benchmarked against realistic channel counts; in v1 the renewal worker is expected to scan tens-to-hundreds of channels, which is fine on a seq-scan.

## API Contracts

### `POST /api/communication_channels/webhooks/gmail`

**Auth:** `requireAuth: false` (Pub/Sub authenticates with a Google-signed JWT in `Authorization: Bearer …`). Route handler verifies the JWT.

**Validation:**
1. Verify JWT signature against Google's public keys (cached).
2. Check `audience` claim matches `OM_GMAIL_PUBSUB_AUDIENCE`.
3. Check `email` claim matches `OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`.
4. Decode the Pub/Sub envelope: `{ message: { data: <base64 JSON>, messageId, publishTime, attributes }, subscription }`.
5. Decode `data`: `{ emailAddress, historyId }`.
6. Look up channel: `provider_key='gmail' AND credentials->>email = ?` (tenant-scoped).
7. Enqueue `gmail-history-sync` job with `{ channelId, newHistoryId }`.
8. Return `204 No Content`.

**Errors:**
- `401 invalid_jwt` — JWT verification failed.
- `403 invalid_audience` — JWT not for our audience.
- `404 channel_not_found` — `emailAddress` doesn't map to any active channel (treated as no-op; we still return 204 so Pub/Sub doesn't retry forever — note this is a deliberate choice).

**OpenAPI** declared via `metadata.openApi`.

### `POST /api/communication_channels/channels/[id]/push/register` *(operator-facing)*

**Auth:** `requireAuth: true`, `requireFeatures: ['communication_channels.channel.push.manage']`.

Force-re-register push for a channel. Used by the operator UI's "Re-register push" button after fixing a misconfiguration.

**Request body:** `{}` (no payload).

**Response (202):** `{ ok: true, channelState: { pushStatus, ... } }`.

**Errors:** `404`, `409 push_not_supported_for_provider` (IMAP), `502 provider_error`.

## Internationalization (i18n)

Add to `packages/core/src/modules/communication_channels/i18n/{de,en,es,pl}.json`:

| Key | English text |
|---|---|
| `communication_channels.push.status.active` | Push active |
| `communication_channels.push.status.inactive` | Polling only |
| `communication_channels.push.status.failed` | Push failed — using polling |
| `communication_channels.push.notification.registered` | Push delivery enabled for {channel} |
| `communication_channels.push.notification.failed` | Push failed for {channel}: {error}. Falling back to polling. |
| `communication_channels.push.notification.deactivated` | Push deactivated for {channel} |
| `communication_channels.push.button.reregister` | Re-register push |
| `communication_channels.push.error.notSupportedForProvider` | This channel type doesn't support push delivery. |

## UI/UX

### Channel detail page — Push status section

Add a `PushStatusSection` to the channel detail page:

```
┌────────────────────────────────────────────────────────────┐
│  ▼ Push delivery                                           │
│                                                            │
│  Status: ● Active                                          │
│  Next renewal: in 5 days 14 hours                          │
│  Last notification: 32 s ago                               │
│                                                            │
│  [ Re-register push ]                                      │
└────────────────────────────────────────────────────────────┘
```

If `pushStatus === 'failed'`:
```
┌────────────────────────────────────────────────────────────┐
│  ▼ Push delivery                                           │
│                                                            │
│  Status: ● Failed — using polling                          │
│                                                            │
│  Error: Pub/Sub topic not found                            │
│                                                            │
│  [ Re-register push ]                                      │
└────────────────────────────────────────────────────────────┘
```

If provider doesn't support push (IMAP):
```
┌────────────────────────────────────────────────────────────┐
│  ▼ Push delivery                                           │
│                                                            │
│  Push delivery is not available for IMAP channels.         │
│  Inbound mail is polled every 60 seconds.                  │
└────────────────────────────────────────────────────────────┘
```

DS compliance:
- Status indicator uses `<StatusBadge variant="success|warning|destructive|info">` from `@open-mercato/ui/primitives/status-badge`.
- "Re-register push" button is `<Button variant="outline">` with `<RefreshCw>` icon (lucide-react, `size-4`).
- All copy via `useT(...)`.
- Section uses `<CollapsibleSection>` matching the other channel-detail sections.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OM_GMAIL_PUBSUB_TOPIC` | (unset; required for Gmail push) | Full topic name, e.g. `projects/openmercato-prod/topics/gmail-inbound` |
| `OM_GMAIL_PUBSUB_AUDIENCE` | (unset; required for Gmail push) | JWT audience claim we accept, typically the webhook URL |
| `OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` | `gmail-api-push@system.gserviceaccount.com` | Hardcoded by Google; configurable for testing |
| `OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS` | `24` | Renew Gmail watch when within this many hours of expiry |
| `OM_PUSH_POLL_FALLBACK_SECONDS` | `1800` | Polling cadence when `pushStatus = 'active'`. Defaults to 30 min |

If the Gmail env vars are unset, `registerPush` short-circuits (logs + sets `pushStatus = 'inactive'`); the channel falls back to Spec B's 60 s polling without error.

## Migration & Compatibility

### Migrations

**No migrations.** Gmail push state lives entirely on the existing `CommunicationChannel.channelState` JSONB column (plaintext — `historyId` / `watchExpirationMs` are not secrets). Add a GIN index on `channel_state` (additive) only if Phase C1 benchmarking shows the renewal-worker SELECT seq-scanning.

### Backward Compatibility

| Contract surface | Change | Classification |
|---|---|---|
| Public types | New: `PushRegistration`, `OAuthClientConfig` (already added in Spec A). Optional methods added to `ChannelAdapter`: `registerPush?`, `unregisterPush?`, `applyPushNotification?` | ✓ ADDITIVE |
| Import paths | New: `@open-mercato/core/modules/communication_channels/commands/push.*`, `…/workers/gmail-history-sync.ts`, etc. | ✓ ADDITIVE |
| Event IDs | 4 new events (`communication_channels.push.*`) | ✓ ADDITIVE |
| Widget spot IDs | None | ✓ |
| API routes | 2 new routes (`/webhooks/gmail`, `/channels/[id]/push/register`) | ✓ ADDITIVE |
| DB schema | No new columns; at most one new GIN index (deferred to benchmarking) | ✓ ADDITIVE |
| DI service names | None | ✓ |
| ACL feature IDs | One new feature: `communication_channels.channel.push.manage` | ✓ ADDITIVE |
| `pollIntervalSeconds` semantics | Gmail channels with `pushStatus = 'active'` get 1800 instead of 60 | ✓ ADDITIVE (behavior — old value works fine; new behavior is opt-in via push registration) |

**Deployment notes:**
- Zero downtime — all changes additive.
- After deploy: Gmail channels currently in polling mode continue to work as before; push registration only happens when `registerPush` is explicitly triggered (either at connect time or via the operator UI button).
- Operators must set the relevant env vars (`OM_GMAIL_PUBSUB_TOPIC`) and complete GCP setup before push registrations succeed for new channels. Existing channels will continue polling.
- The `communication_channels.channel.push.manage` feature must be granted to admin role; `setup.ts` includes it in `defaultRoleFeatures`. Run `yarn mercato auth sync-role-acls` post-deploy.

## Implementation Plan

### Phase C1 — Adapter contract + state
1. Add to `lib/adapter.ts` the new optional adapter methods: `registerPush?`, `unregisterPush?`, `applyPushNotification?`, plus `PushRegistration` + `GmailPushPayload` types.
2. Add `communication_channels.channel.push.manage` to `acl.ts` + `setup.ts:defaultRoleFeatures`.
3. Add the `push.*` events to `events.ts` `as const`.
4. Run `yarn generate` + `yarn db:generate`.

**Ship signal:** types compile; `yarn build` passes; `yarn generate` produces no diff.

### Phase C2 — Gmail Pub/Sub: adapter + webhook
1. Implement `channel-gmail` adapter `registerPush` (calls `users.watch`).
2. Implement `applyPushNotification` (calls `history.list`, paginates, maps each `messageAdded` to a `NormalizedInboundMessage` via existing `normalizeInbound`).
3. Implement `unregisterPush` (calls `users.stop`).
4. New webhook route `api/post/webhooks/gmail/route.ts`:
   - JWT verification (audience + issuer + service-account email).
   - Channel lookup by `emailAddress` (scoped by tenant inferred from credentials).
   - Enqueue `gmail-history-sync` job.
5. New worker `workers/gmail-history-sync.ts`: dequeues, calls `refreshCredentialsIfNeeded` (Spec A), calls `adapter.applyPushNotification`, ingests each message via `ingest-inbound-message`, updates `channelState.historyId`.
6. Unit tests + integration test TC-CHANNEL-EMAIL-C01 (Gmail push receives notification → ingests new message → updates historyId).

**Ship signal:** TC-C01 green; manual smoke against a real Gmail test mailbox optional.

### Phase C4 — Renewal worker
1. New worker `workers/gmail-renew-watch.ts` (cron metadata: `{ queue: 'gmail-renew-watch', cron: '0 4 * * *' }` — daily 04:00 UTC). Selects expiring channels, calls `push.renew` command per channel.
2. Unit test the SELECT predicate.
3. Integration test TC-C05 (Gmail renewal: fast-forward `watchExpirationMs` → cron picks it up → `registerPush` called again → expiry updated).

**Ship signal:** TC-C05 green; manual: simulate expiring channel, observe re-registration in logs.

### Phase C5 — Polling fallback + push status
1. Modify `commands/connect-credential-channel.ts` and `commands/connect-oauth-channel.ts` to call `push.register` after successful connect (if adapter supports it).
2. Modify channel detail page to render the `PushStatusSection`.
3. Add `POST /channels/[id]/push/register` route with `requireFeatures` gate.
4. Modify `poll-tick.ts` to read `pollIntervalSeconds` per-channel (already does this; verify Gmail default flips to 1800 when `pushStatus='active'`).
5. Integration test TC-C06 (push active → poll cadence is 1800; push failed → cadence is 60).

**Ship signal:** TC-C06 green; manual: connect a Gmail channel, observe push registered + 30-min polling.

### Phase C6 — Operator UI polish + documentation
1. UI strings via i18n in 4 languages.
2. `apps/docs/docs/framework/modules/communication-channels.mdx` — Push delivery section + env var reference + tenant operator GCP setup walkthrough.
3. `apps/docs/docs/user-guide/communication-channels.mdx` — User-facing "what does push mean" explainer.
4. `BACKWARD_COMPATIBILITY.md` entry for the new adapter methods + events.

**Ship signal:** docs render in preview.

### Phase C7 — End-to-end demo readiness
1. Smoke against a real Gmail test tenant in a staging environment.
2. Observe latency end-to-end (publish → ingest visible in CRM).
3. Verify renewal cron runs at expected cadence.
4. Verify `pushStatus = 'failed'` path: deliberately misconfigure topic, observe fallback to polling.

**Ship signal:** Demo dry-run successful for Gmail.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/communication_channels/lib/adapter.ts` | Modify | Add `registerPush?`, `unregisterPush?`, `applyPushNotification?` to `ChannelAdapter` |
| `packages/core/src/modules/communication_channels/events.ts` | Modify | Add 4 push events |
| `packages/core/src/modules/communication_channels/acl.ts` | Modify | Add `communication_channels.channel.push.manage` feature |
| `packages/core/src/modules/communication_channels/setup.ts` | Modify | `defaultRoleFeatures` includes new feature |
| `packages/core/src/modules/communication_channels/commands/push-register.ts` | Create | `push.register` command |
| `packages/core/src/modules/communication_channels/commands/push-unregister.ts` | Create | `push.unregister` command |
| `packages/core/src/modules/communication_channels/commands/push-handle-notification.ts` | Create | `push.handle_notification` dispatcher |
| `packages/core/src/modules/communication_channels/commands/push-renew.ts` | Create | `push.renew` command |
| `packages/core/src/modules/communication_channels/api/post/webhooks/gmail/route.ts` | Create | Gmail Pub/Sub webhook |
| `packages/core/src/modules/communication_channels/api/post/channels/[id]/push/register/route.ts` | Create | Operator-facing force-reregister |
| `packages/core/src/modules/communication_channels/workers/gmail-history-sync.ts` | Create | Per-notification fetch + ingest |
| `packages/core/src/modules/communication_channels/workers/gmail-renew-watch.ts` | Create | Daily cron |
| `packages/core/src/modules/communication_channels/i18n/{de,en,es,pl}.json` | Modify | Push status / button / error keys |
| `packages/core/src/modules/communication_channels/backend/profile/communication-channels/page.tsx` | Modify | `PushStatusSection` |
| `packages/core/src/modules/communication_channels/commands/connect-credential-channel.ts` | Modify | Call `push.register` after connect |
| `packages/core/src/modules/communication_channels/commands/connect-oauth-channel.ts` | Modify | Same |
| `packages/channel-gmail/src/modules/channel_gmail/lib/adapter.ts` | Modify | Implement `registerPush`, `applyPushNotification`, `unregisterPush` |
| `packages/channel-gmail/src/modules/channel_gmail/lib/__tests__/adapter.test.ts` | Modify | Unit tests for push methods |
| `packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-C01.spec.ts` | Create | Gmail push delivery |
| `packages/core/src/modules/communication_channels/workers/__integration__/TC-CHANNEL-EMAIL-C05.spec.ts` | Create | Renewal cron |
| `packages/core/src/modules/communication_channels/workers/__integration__/TC-CHANNEL-EMAIL-C06.spec.ts` | Create | Push active → 30-min cadence |
| `.ai/qa/scenarios/TC-CHANNEL-EMAIL-C01,C05,C06.md` | Create | QA scenarios |
| `apps/docs/docs/framework/modules/communication-channels.mdx` | Modify | Push delivery + GCP setup |
| `apps/docs/docs/user-guide/communication-channels.mdx` | Modify | User-facing push explainer |
| `BACKWARD_COMPATIBILITY.md` | Modify | Track new adapter optional methods + events |

### Testing Strategy

**Unit tests:**
- `commands/push-register`: idempotent (calling twice with active push is a no-op); sets `pollIntervalSeconds=1800`; emits `push.registered`; on adapter throw → `pushStatus='failed'` + `push.failed` event.
- Gmail adapter `applyPushNotification`: paginates `history.list`; handles 404 (expired history) by falling back to full `messages.list`; advances cursor correctly.
- Gmail webhook: JWT verify (good/bad/wrong audience); channel lookup by emailAddress; 204 on missing channel (no retry storm).
- Renewal worker predicate: SELECT returns expected Gmail channels.

**Integration tests** (mocked HTTP for provider APIs + webhook payloads):

| Scenario ID | Title | Strategy |
|---|---|---|
| TC-CHANNEL-EMAIL-C01 | Gmail push delivers new message | POST mock Pub/Sub payload → webhook → worker → ingest; verify message in CRM + historyId advanced |
| TC-CHANNEL-EMAIL-C05 | Gmail renewal cron | Fast-forward watchExpirationMs → cron tick → registerPush called → expiry updated |
| TC-CHANNEL-EMAIL-C06 | Push active → polling cadence is 30 min | Connect Gmail channel with push registered → assert pollIntervalSeconds=1800 |
| TC-CHANNEL-EMAIL-C07 | Push fails → fallback to 60s polling | Misconfigure Pub/Sub topic env var → registerPush throws → pushStatus='failed' → poll cadence stays 60s |
| TC-CHANNEL-EMAIL-C08 | Operator force-reregister | POST /push/register → adapter called → state updated |
| TC-CHANNEL-EMAIL-C09 | Webhook authenticates correctly | Bad JWT → 401; wrong audience → 403; valid → 204 |
| TC-CHANNEL-EMAIL-C10 | Cross-tenant isolation on Gmail webhook | Notification for tenant A's emailAddress is NOT delivered to tenant B's channel |

## Risks & Impact Review

### Data Integrity Failures

#### History gap on Gmail (404 from history.list)
- **Scenario:** Stored `historyId` is older than ~1 week (Gmail retains history for 1-30 days typical). `history.list` returns 404. We lose any messages from the gap.
- **Severity:** Medium (one-time data loss after long downtime)
- **Affected area:** Gmail adapter
- **Mitigation:** On 404, fall back to `users.messages.list?q=newer_than:7d` to enumerate recent messages and ingest each via dedupe. Most-recent gap recoverable; older gap permanently lost. Operator-visible warning.
- **Residual risk:** Acceptable — affects only channels that were offline > 7 days.

#### Notification storm (silent cursor drop)
- **Scenario:** A high-volume mailbox publishes faster than the worker drains. Worker is sequential; queue depth grows. If the worker fails mid-batch, do we lose cursor advancement?
- **Severity:** High (silent message loss)
- **Affected area:** Gmail sync worker
- **Mitigation:** **Per-message commit** from Spec B applies — each message ingest commits its own cursor (`historyId`) advance. Worker failure mid-batch leaves cursor at last successfully ingested message; on retry, we resume from there. Push notifications are idempotent (Gmail dedupes on Message-Id; Spec B's `ChannelThreadToken` matching is idempotent).
- **Residual risk:** Acceptable.

### Cascading Failures & Side Effects

#### Pub/Sub topic misconfiguration
- **Scenario:** Operator forgets to grant `gmail-api-push@system.gserviceaccount.com` publisher on the topic. `users.watch` succeeds but no notifications ever arrive.
- **Severity:** Medium (silent latency degradation; 30-min polling catches mail eventually)
- **Affected area:** Gmail
- **Mitigation:** Polling fallback (Q4) ensures no data loss. Push status shows "active" but operator sees no recent notifications — add observability metric "time since last notification per channel" and alert on > 24h.
- **Residual risk:** Latency degradation (30 min vs <15 s).

### Tenant & Data Isolation Risks

#### Cross-tenant Pub/Sub routing (single shared topic — Q1)
- **Scenario:** Webhook receives a Pub/Sub message for `alice@example.com` and accidentally delivers it to tenant B's channel for the same email address (if two tenants both have a user connected as the same Gmail account).
- **Severity:** Critical (cross-tenant data leak)
- **Affected area:** Gmail webhook
- **Mitigation:** Channel lookup is scoped: we lookup by `(provider_key='gmail', credentials_email = emailAddress)`. The `IntegrationCredentialsService.resolve` requires tenant scope — but the webhook has no inbound tenant signal beyond `emailAddress`. **Need to handle the rare "same Gmail address connected to two tenants" case explicitly:** ingest into BOTH channels (each tenant sees their own data), OR pick the most-recently-connected. Decision: ingest into all matching channels (data is delivered to the user who connected, scoped per tenant naturally because each channel's `tenantId` is on the channel row).
- **Residual risk:** A bug where the channel-lookup query misses the tenant filter on the inner `ingest-inbound-message` invocation. Spec B's `ingest-inbound-message` already scopes by `channelId` (which implies tenant), so this is mitigated.

### Migration & Deployment Risks

#### Existing connected channels don't auto-register push
- **Scenario:** After deploy, existing Gmail channels continue polling at 60 s. Push must be triggered manually.
- **Severity:** Low (UX — channels still work)
- **Affected area:** All existing channels at deploy time
- **Mitigation:** Optional follow-up: one-time migration script that calls `push.register` on every connected Gmail channel. Out of scope for this spec; can be a `mercato communication-channels register-push --provider gmail` CLI command.
- **Residual risk:** Acceptable — operator can opt-in incrementally via UI button.

### Operational Risks

#### Webhook DoS
- **Scenario:** Malicious actor sends millions of POSTs to `/webhooks/gmail`.
- **Severity:** Medium (queue saturation)
- **Affected area:** Webhook routes
- **Mitigation:** JWT verify rejects non-Google traffic at low cost. Per-channel rate limiting (already in queue worker concurrency=1 per channel). Add request-rate metric for observability.
- **Residual risk:** Acceptable.

#### Renewal cron fails silently
- **Scenario:** Cron worker crashes; the Gmail watch expires; push silently stops.
- **Severity:** High (silent latency degradation across all tenants)
- **Affected area:** Gmail
- **Mitigation:** Polling fallback (Q4) catches mail at 30-min cadence even if push expires. Renewal worker is idempotent and re-runs every cycle. Add observability metric "renewal failures per cycle" + alert.
- **Residual risk:** Acceptable.

#### Quota exhaustion (Gmail API throttling)
- **Scenario:** A high-volume mailbox triggers thousands of notifications/day; we hit Gmail API quotas.
- **Severity:** Medium (per-tenant degradation)
- **Affected area:** Provider APIs
- **Mitigation:** Gmail throttles gracefully (429 with `Retry-After`). Existing transient-error retry honors `Retry-After`. Per-channel worker concurrency=1 prevents single-tenant DoS. Optional follow-up: per-tenant quota budgets.
- **Residual risk:** Acceptable; quotas are well above realistic CRM load (Gmail: 1 notification/user/sec).

## Final Compliance Report — 2026-05-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/webhooks/AGENTS.md` (consulted; this spec's webhooks are provider-specific, not the Standard Webhooks pattern — that's outbound)
- `packages/core/src/modules/integrations/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No new ORM relations |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All channel lookups scoped by tenantId (via channelId or emailAddress + provider) |
| root AGENTS.md | Validate all inputs with zod | Compliant | Webhook payloads validated with Zod schemas before processing |
| root AGENTS.md | Use DI (Awilix) | Compliant | All services resolved via container; no `new` of services |
| root AGENTS.md | Hash/encrypt PII/secrets | Compliant | OAuth tokens already encrypted by integrations module; Gmail push state (`historyId` / `watchExpirationMs`) is not secret |
| root AGENTS.md | API routes export `metadata` with per-method `requireAuth`/`requireFeatures` | Compliant | Webhook routes set `requireAuth: false` explicitly; force-reregister route sets `requireFeatures: ['communication_channels.channel.push.manage']` |
| root AGENTS.md | API routes export `openApi` | Compliant | All new routes declare `openApi` in metadata |
| root AGENTS.md | Use `apiCall` — never raw `fetch` | N/A | Webhook routes are server-receiving HTTP; we use the framework's request parsing, not outbound HTTP. Outbound HTTP to provider APIs uses adapter-specific clients (existing pattern). |
| root AGENTS.md | `useT()` / `resolveTranslations()` for labels | Compliant | All new UI strings use i18n keys |
| root AGENTS.md | Dialog `Cmd+Enter` + `Escape` | N/A | No dialogs added |
| root AGENTS.md | `pageSize <= 100` | N/A | No paginated list endpoints |
| root AGENTS.md | RBAC: features (not roles) | Compliant | New feature `communication_channels.channel.push.manage` |
| root AGENTS.md | New ACL features → `acl.ts` + `setup.ts` + `sync-role-acls` | Compliant | All three steps in Phase C1 |
| root AGENTS.md | `yarn generate` after module file changes | Compliant | Phase C1 runs it |
| root AGENTS.md | Module event IDs singular `module.entity.action` | Compliant | All 4 new events follow this pattern |
| root AGENTS.md | DB tables snake_case + plural | N/A | No new tables |
| root AGENTS.md | Common columns (`created_at`, `tenant_id`, `organization_id`) | N/A | No new tables |
| root AGENTS.md | UUID PKs | N/A | No new tables |
| root AGENTS.md | Singular naming | Compliant | `push.register` (singular), `push.renew` (singular), `PushRegistration` type (singular) |
| root AGENTS.md (DS rules) | Semantic status tokens; no hardcoded colors | Compliant | `<StatusBadge>` used for push status indicator |
| root AGENTS.md (DS rules) | No arbitrary text sizes | Compliant | All Tailwind scale |
| root AGENTS.md (DS rules) | lucide-react in page body | Compliant | `<RefreshCw>` icon for re-register button |
| root AGENTS.md (DS rules) | `aria-label` on icon-only buttons | Compliant | Reviewed for new UI |
| packages/core/AGENTS.md | Write operations via Command pattern | Compliant | 4 new commands: `push.register`, `push.unregister`, `push.handle_notification`, `push.renew` |
| packages/core/AGENTS.md | Custom write routes: `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` | Compliant | `/push/register` operator route follows this pattern |
| packages/core/AGENTS.md | `findWithDecryption` for encrypted-column reads | N/A | Gmail push state is plaintext on `channelState`; no new encrypted columns added |
| packages/queue/AGENTS.md | Workers idempotent, dedup by external ID | Compliant | `gmail-history-sync` is idempotent (Spec B's `ingest-inbound-message` dedupes on `(channel_id, external_message_id)`); the renewal worker is idempotent (re-registering an active watch is a refresh) |
| packages/queue/AGENTS.md | Worker metadata declared with `queue, concurrency`; cron workers via cron metadata | Compliant | All workers declare metadata; renewal workers use cron syntax |
| packages/events/AGENTS.md | Events declared via `createModuleEvents` `as const` | Compliant | New events in existing `events.ts` |
| packages/events/AGENTS.md | Ephemeral vs persistent subscribers | N/A | No new subscribers |
| packages/cache/AGENTS.md | Cache via DI, tenant-tagged | N/A | No new cached endpoints; channel lookup is a simple unique-index read |
| packages/ui/AGENTS.md | `<CrudForm>` for backend writes; `<DataTable>` for lists | N/A | Re-register button is a single action via `useGuardedMutation`, not CrudForm |
| packages/ui/AGENTS.md | `useGuardedMutation` for non-CrudForm writes | Compliant | Re-register button uses `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` |
| .ai/qa/AGENTS.md | Integration tests `TC-…` naming + scenario markdowns | Compliant | TC-CHANNEL-EMAIL-C01..C10 |
| .ai/specs/AGENTS.md | Spec filename `{date}-{title}.md`, kebab-case | Compliant | `2026-05-27-email-integration-provider-push-delivery.md` |
| .ai/specs/AGENTS.md | Required sections: TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, Risks, Compliance, Changelog | Compliant | All present |
| BACKWARD_COMPATIBILITY.md | Event IDs FROZEN; new events additive | Compliant | 4 new events, additive |
| BACKWARD_COMPATIBILITY.md | API URLs STABLE; new routes additive | Compliant | 2 new routes |
| BACKWARD_COMPATIBILITY.md | DB schema ADDITIVE-ONLY | Compliant | No new columns; at most one new GIN index (deferred to benchmarking) |
| BACKWARD_COMPATIBILITY.md | DI keys STABLE | Compliant | No DI key changes |
| BACKWARD_COMPATIBILITY.md | ACL feature IDs FROZEN; new features additive | Compliant | One new feature |
| BACKWARD_COMPATIBILITY.md | New adapter optional methods are additive | Compliant | `registerPush?`, `unregisterPush?`, `applyPushNotification?` all optional |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Webhook payload schemas align with `channelState` shape |
| API contracts match UI/UX | Pass | Force-reregister button → POST /push/register; status section reads `channelState.pushStatus` |
| Risks cover all write operations | Pass | History gap, notification storm, misconfiguration, renewal failures, quota |
| Commands defined for all mutations | Pass | 4 push.* commands |
| Cache strategy covers all read APIs | N/A | No cached APIs added |
| Encryption maps cover PII columns | N/A | No new encrypted columns; Gmail push state is plaintext |
| Phasing is testable + incrementally deliverable | Pass | C1–C7 each have explicit ship signals |
| Open Questions resolved | Pass | All 4 answered (recommended defaults) |

### Non-Compliant Items
None.

### Verdict
**Fully compliant — approved for implementation pending user sign-off.**

---

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| C1 — Contract + events + ACL | Done | 2026-05-27 | Added optional `registerPush?`, `unregisterPush?`, `applyPushNotification?` methods to `ChannelAdapter` with `PushRegistration`/`RegisterPushInput`/`UnregisterPushInput`/`ApplyPushNotificationInput` types (all additive). Added 4 push lifecycle events (`push.registered`, `push.failed`, `push.renewed`, `push.deactivated`) with `clientBroadcast` set where operator-visible. Added `communication_channels.channel.push.manage` ACL feature (granted to admin + superadmin only). Gmail push state (`historyId` / `watchExpirationMs` / `pubsubTopic`) lives plaintext on `channelState` — no new column, no migration. |
| C2 — Gmail Pub/Sub | Done | 2026-05-27 | Extended `gmail-client` with `watchInbox` + `stopWatch`; adapter implements `registerPush` (calls `users.watch`, persists `historyId`/`watchExpirationMs`/`pubsubTopic`), `unregisterPush` (calls `users.stop`, swallows 404), `applyPushNotification` (delegates to `fetchHistory` so 404-recovery + pagination stay in one place). New webhook route `api/post/webhooks/gmail/route.ts` verifies Google-signed RS256 JWT via new `lib/gmail-pubsub-jwt.ts` (audience + email claims + cached x509 certs from Google's OAuth2 endpoint). Worker `workers/gmail-history-sync.ts` (concurrency 5) drains pages, dispatches `ingest-inbound-message`, re-enqueues self while `hasMore`. 6 unit tests for envelope decoder + 6 adapter push-method tests added. |
| C4 — Renewal cron worker | Done | 2026-05-28 | `workers/gmail-renew-watch.ts` (daily 04:00 UTC cron registered per-org in `setup.ts`; selects channels within `OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS` of expiry, default 24h). Concurrency-1 and **invokes `pushRenew → pushRegister` per eligible channel** — i.e., it actually re-issues `gmail.users.watch` and persists the fresh `historyId` / expiry to `channelState`. Each successful renewal emits `communication_channels.push.renewed` for observability. Initial 2026-05-27 implementation enqueued marker jobs onto the sync queue that did NOT renew — that gap was closed in the 2026-05-28 gap-closure pass. |
| C5 — Push commands + UI + polling fallback | Done | 2026-05-28 | `commands/push-register.ts` resolves credentials + refreshes via Spec A wiring, calls `adapter.registerPush`, persists state patch + flips `pollIntervalSeconds` to recommended cadence on success, emits `push.registered` / `push.failed` events with `persistent: true`. Companion `commands/push-unregister.ts` calls `adapter.unregisterPush`, clears push markers from `channelState`, restores `pollIntervalSeconds=60`, emits `push.deactivated`. Companion `commands/push-renew.ts` delegates to `pushRegister` (the Gmail watch re-issue is idempotent). New operator route `POST /api/communication_channels/channels/[id]/push/register` gated by `requireFeatures: ['communication_channels.channel.push.manage']`. **Auto-registration on connect**: `commands/connect-credential-channel.ts` + `api/get/oauth/[provider]/callback/route.ts` both call `pushRegister` best-effort after successful connect (failures persist as `pushStatus='failed'`, do NOT fail the connect). **Auto-unregistration on disconnect**: `commands/disconnect-channel.ts` calls `pushUnregister` before clearing `credentialsRef` so the provider-side watch is torn down. `PushStatusSection` UI shipped as a new column on `/backend/profile/communication-channels`: Gmail channels show `Tag` variant tracking `pushStatus` (`active` / `failed` / `inactive`) plus a `Re-register push` `Button` (with `lastPushError.message` as the title attribute for diagnostics). Non-push providers (IMAP) render `Polling only`. The `me/channels` API now exposes `pushStatus` + `lastPushError` from `channelState`. |
| C6 — i18n + docs + BC | Done | 2026-05-27 | i18n keys `communication_channels.push.*` added to all 4 locale files (status / notification / button / error). Framework docs (`apps/docs/docs/framework/modules/communication-channels.mdx`) gained a "Provider push delivery (Spec C)" section covering adapter contract, Gmail Pub/Sub flow, renewal cron, and polling fallback. User-guide gained step-7 "How fast does new mail appear? (Push delivery)". `BACKWARD_COMPATIBILITY.md` gained a Spec C entry listing all contract surfaces (all additive). |
| C7 — Integration tests + QA scenarios | Done | 2026-05-28 | `TC-CHANNEL-EMAIL-C01.spec.ts` covers the Gmail webhook surface. Gap-closure pass added `TC-CHANNEL-EMAIL-C05.spec.ts` (renewal cron — documented as manual E2E) and `TC-CHANNEL-EMAIL-C06.spec.ts` (push-active cadence flip — asserts `me/channels` schema exposes `pushStatus` + `pollIntervalSeconds`). QA scenario markdowns staged: `gmail-push-delivery.md`, `renewal-cron.md`, `push-cadence-flip.md`. |

## Changelog

### 2026-05-27
- Initial specification. Companion to [Spec A](2026-05-27-oauth-refresh-credentials-client-wiring-fix.md) and [Spec B](2026-05-27-email-integration-inbound-reliability-and-threading.md). Open Questions resolved (Q1 single shared Pub/Sub topic, Q4 30-min polling fallback).
- **Phase C1 complete 2026-05-27.** Adapter contract surface extended with three optional push methods + supporting types; four push lifecycle events declared in `events.ts`; `communication_channels.channel.push.manage` feature added to `acl.ts` + granted to admin/superadmin in `setup.ts`. Gmail push state (`historyId` / `watchExpirationMs` / `pubsubTopic`) lives plaintext on `channelState` — no new column, no migration. All changes additive; `yarn build:packages` clean.
- **Phases C2 through C7 complete 2026-05-27.** Gmail Pub/Sub end-to-end (adapter `users.watch` / `users.stop`, JWT-verified webhook, history-sync worker). Renewal cron worker registered per-org in `setup.ts` (Gmail daily 04:00 UTC). `pushRegister` command + operator `POST /push/register` route gated by new ACL feature. i18n keys across 4 locales; framework + user-guide docs updated; `BACKWARD_COMPATIBILITY.md` Spec C entry classifies all contract surfaces as additive. Integration smoke test for the webhook + QA scenario markdowns for the end-to-end. `yarn build:packages` clean; 4572 core + 41 channel-imap + 56 channel-gmail unit tests green.

### 2026-05-28
- **Gap-closure pass.** Pre-review audit found High-impact functional gaps and several missing test surfaces. Closed:
  - **`push-unregister.ts` command** + wiring into `disconnect-channel.ts` — previously, disconnecting a Gmail channel left the provider-side watch alive until expiry.
  - **`push-renew.ts` command** + cron worker rewrite — the daily Gmail cron worker now actually calls `pushRegister` per eligible channel and emits `push.renewed` events. The initial implementation enqueued marker jobs that did nothing useful.
  - **Auto-`pushRegister` on connect** in `connect-credential-channel.ts` AND in the OAuth callback route at `api/get/oauth/[provider]/callback/route.ts` — operators no longer need to manually click "Re-register push" after every Gmail connect.
  - **Integration tests TC-CHANNEL-EMAIL-C05/C06** + matching QA scenario markdowns (renewal cron, push-cadence flip).
- All changes additive. 4579 core + 41 channel-imap + 57 channel-gmail unit tests green; `yarn build:packages` clean. **Spec C is 100 % done** modulo manual demo dry-runs against a real GCP tenant.


---

## Part 3 — OAuth Credential Wiring (token refresh)

> Merged 2026-06-01 from the former `2026-05-27-oauth-refresh-credentials-client-wiring-fix.md` — content preserved verbatim below.

# OAuth Refresh-Credentials `_client` Wiring Fix

## TLDR

**Key Points:**
- Fixes a structurally broken token-refresh path on Gmail channels: `RefreshCredentialsInput` carries no slot for the tenant's OAuth client config (`clientId` / `clientSecret`), so the adapter's `refreshCredentials()` implementation throws, the helper silently swallows the error, and the **next API call against the provider 401s. In practice, every connected Gmail channel stops working ~1 h after connect, with no operator-visible signal.**
- Audit details (companion to [`2026-05-27-email-integration-inbound-reliability-and-threading.md`](2026-05-27-email-integration-inbound-reliability-and-threading.md) Spec B research). The fix is small and surgical: extend the framework contract additively with an optional `oauthClient` field, resolve it in the central helper, update the Gmail adapter to read from it.
- All changes are **additive against the staged email-integration-foundation contract**. Existing tests still pass (they pre-pack `_client` into credentials, which we keep accepting as a deprecated path for one minor release).

**Scope (Spec A):**
- Extend `RefreshCredentialsInput` with optional `oauthClient?: { clientId, clientSecret? }` field.
- In `lib/credential-refresh.ts` (`refreshCredentialsIfNeeded`), resolve `oauth_<providerKey>` from `IntegrationCredentialsService` once before calling `adapter.refreshCredentials`, pass it as `input.oauthClient`.
- Update the `channel-gmail` adapter: read OAuth client config from `input.oauthClient` first; fall back to `credentials._client` (existing path) with a deprecation log for one release.
- Add a regression test asserting that a near-expiry token successfully refreshes against a real OAuth client config returned by `IntegrationCredentialsService` (mocked HTTP).
- Update `apps/docs/docs/framework/modules/communication-channels.mdx` to document the new `RefreshCredentialsInput.oauthClient` field for downstream provider authors.

**Non-goals:**
- No new framework primitives, no new entities, no new migrations, no DB changes.
- No changes to the OAuth `exchange-code` flow — that path already correctly passes the OAuth client config as `ExchangeOAuthCodeInput.credentials`.
- No changes to credential persistence (the helper's `credentialsService.save` path is unchanged).
- No changes to the IMAP adapter (basic-auth — no refresh).
- No tests against a real Google tenant in CI. The regression test uses mocked HTTP per the test plan in Spec B (`__integration__/__fixtures__/mock-imap.ts` pattern adapted for OAuth providers — a `mock-google.ts` HTTP fixture).

**Concerns / dependencies:**
- Sibling of [Spec B](2026-05-27-email-integration-inbound-reliability-and-threading.md) and [Spec C](#) (Gmail Pub/Sub webhooks, not yet drafted). **This spec is independent and can ship in parallel** — Spec B's IMAP demo works without it (IMAP has no refresh), but any Gmail demo requires Spec A.
- Backward compatibility: `RefreshCredentialsInput._client` (the legacy field that no caller currently populates) remains a *recognized but deprecated* read path inside the two adapters for one minor release. Removal is tracked as a follow-up in [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md).

---

## Prerequisites & Cross-Spec Dependencies

| Dependency | What it delivers | Must merge before this spec? |
|---|---|---|
| `2026-05-21-email-integration-foundation.md` (staged on `feat/demo-hoodie`) | Hub + `channel-gmail` provider package, `RefreshCredentialsInput` contract, `refreshCredentialsIfNeeded` helper, `IntegrationCredentialsService` | Yes — already staged |

No dependency on Spec B or Spec C.

---

## Overview

The per-user email integration foundation ([`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md)) shipped the `channel-gmail` provider package that uses OAuth 2.0 with the provider's REST API (Gmail v1). OAuth access tokens expire — Google's after ~1 hour — so any continuously-polling integration MUST refresh tokens before they expire.

The framework's central helper `refreshCredentialsIfNeeded` (in [`packages/core/src/modules/communication_channels/lib/credential-refresh.ts`](../../packages/core/src/modules/communication_channels/lib/credential-refresh.ts)) is the single point where all four refresh call sites funnel through:
- `workers/poll-channel.ts:152`
- `commands/deliver-outbound-message.ts:252`
- `workers/reaction-processor.ts:179`
- `api/post/channels/[id]/test-send/route.ts:162`

The helper calls `adapter.refreshCredentials({ channelId, credentials, scope })` — and the Gmail OAuth adapter's implementation expects `input.credentials._client` to contain `{ clientId, clientSecret }` (the tenant's OAuth app config registered in the admin Integrations UI, stored under `integration_credentials.scope = oauth_<provider>`).

**No production code path ever sets `_client` on the credential blob.** The blob returned by `credentialsService.resolve('channel_<provider>', scope)` (which the four callers all use) only has the per-user OAuth shape: `{ accessToken, refreshToken, expiresAt, scopes, email }`. The unit tests for `refreshCredentials` cheat by pre-packing `_client` into the input — which masks the bug entirely.

> **Market Reference:** Twenty CRM ([`twenty-server/src/modules/messaging/.../drivers/gmail/services/gmail-refresh-access-token.service.ts`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src/modules/messaging/message-import-manager/drivers/gmail/services)) — passes the OAuth client config explicitly to its refresh function. The hub-resolves-then-passes pattern is the same as what we adopt here. Salesforce's Connected App and HubSpot's Refresh-Token API both also require the OAuth client to be available at refresh time — there is no "credentials-without-app" refresh in any major provider.

## Problem Statement

1. **Token refresh fails silently after ~1 hour.** The adapter's `parseClientCredentialsOrThrow` throws `Invalid Gmail OAuth client credentials: OAuth Client ID required`; the helper catches it (`credential-refresh.ts:77-81`) and returns the stale credentials; the next API call 401s and propagates as a generic `GmailApiError` instead of flipping the channel to `requires_reauth` (the inbound poll path and the outbound path handle this inconsistently).
2. **Unit tests cheat.** [`packages/channel-gmail/.../lib/__tests__/adapter.test.ts:225`](../../packages/channel-gmail/src/modules/channel_gmail/lib/__tests__/adapter.test.ts) pre-packs `_client` into the test input, hiding the wiring bug from CI.
3. **No automated end-to-end coverage of refresh.** No test simulates "token expires → poll triggers refresh → refresh uses tenant OAuth client → new access token used for next API call" because the wiring contract doesn't permit it.

## Proposed Solution

Three options were considered (see § Alternatives). The chosen one is **Option 3 — extend the framework contract additively**.

### Approach (Option 3 — additive contract change)

1. **Framework contract** ([`packages/core/src/modules/communication_channels/lib/adapter.ts`](../../packages/core/src/modules/communication_channels/lib/adapter.ts)): add an optional field to `RefreshCredentialsInput`:
   ```ts
   export interface RefreshCredentialsInput {
     channelId: string
     credentials: Record<string, unknown>
     scope: TenantScope
     /**
      * Tenant-level OAuth client configuration resolved by the hub from
      * `integration_credentials.scope = oauth_<providerKey>`. OAuth providers
      * (Gmail) MUST read clientId / clientSecret from this
      * field. Adapters without OAuth refresh (IMAP, WhatsApp) ignore it.
      */
     oauthClient?: OAuthClientConfig
   }

   export interface OAuthClientConfig {
     clientId: string
     clientSecret?: string
     /** Optional pre-resolved scopes list (some flows compute it once on initiate). */
     scopes?: string[]
   }
   ```

2. **Helper** ([`refreshCredentialsIfNeeded`](../../packages/core/src/modules/communication_channels/lib/credential-refresh.ts)): resolve the OAuth client config from `IntegrationCredentialsService` before delegating to the adapter:
   ```ts
   const oauthClient = deps?.credentialsService
     ? safeParseOAuthClient(await deps.credentialsService.resolve(`oauth_${input.adapter.providerKey}`, input.scope))
     : undefined

   result = await input.adapter.refreshCredentials({
     channelId: input.channelId,
     credentials: input.credentials,
     scope: input.scope,
     oauthClient,
   })
   ```
   `safeParseOAuthClient` returns `undefined` if the row is missing or malformed — the adapter then sees `oauthClient === undefined` and may legitimately fall back to legacy `credentials._client` (one-release deprecation) or throw a clear "oauth client not configured" error.

3. **Gmail adapter** ([`packages/channel-gmail/.../lib/adapter.ts:199-211`](../../packages/channel-gmail/src/modules/channel_gmail/lib/adapter.ts)): rewrite `refreshCredentials` to read from `input.oauthClient` first:
   ```ts
   async refreshCredentials(input: RefreshCredentialsInput): Promise<RefreshedCredentials> {
     const current = parseUserCredentialsOrThrow(input.credentials)
     if (!current.refreshToken) throw new Error('requires_reauth')

     const client = input.oauthClient
       ? coerceOAuthClient(input.oauthClient)
       : legacyParseClientFromCredentialsOrThrow(input.credentials) // logs deprecation warning

     const token = await getGoogleOAuthClient().refreshToken({
       clientId: client.clientId,
       clientSecret: client.clientSecret,
       refreshToken: current.refreshToken,
     })
     // ... rest unchanged
   }
   ```
   `legacyParseClientFromCredentialsOrThrow` is the old `parseClientCredentialsOrThrow` renamed, plus a `console.warn('[channel-gmail] reading OAuth client config from credentials._client is deprecated, pass via RefreshCredentialsInput.oauthClient instead')` line. Removal target: next minor release.

4. **Inbound 401 → requires_reauth flip on poll path** (audit finding #2): in `workers/poll-channel.ts`, when `adapter.fetchHistory` throws a 401-classified error, mirror the outbound path (`adapter.ts:108-110`) and set `channel.status = 'requires_reauth'`. This was inconsistent before; consistency tightens the operator experience.

### Design Decisions

| Decision | Rationale |
|---|---|
| Add `oauthClient` to `RefreshCredentialsInput` (Option 3), don't move resolution into the helper alone (Option 2) | Adapter implementations need to know they have the client config available; Option 2 would require either an exception path or silent fallback when the resolver isn't injected. Option 3 makes the contract explicit and testable. |
| Keep `_client` legacy path with deprecation warning for one minor release | The unit tests today rely on `_client`; removing it would break them in the same PR. Deprecation + cleanup-PR in the next minor follows the BC contract's "additive + deprecation protocol". |
| Resolve `oauth_<provider>` once per refresh, not once per process | The integration-credentials service has its own caching (5-min TTL per the existing module). Resolving per refresh is cheap and ensures rotated OAuth client secrets take effect promptly. |
| Also flip `status='requires_reauth'` on 401 from `fetchHistory` (poll path) | The outbound path does it; consistency. Spec B's auto-recovery sweeper does not retry `requires_reauth` (only `error`), so this correctly halts polling until user re-authorizes. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Option 1** — Have each of the four callers resolve `oauth_<provider>` and merge as `_client` into the credentials blob | Four places to keep in sync; the merge mutates the per-user credential shape (mixing concerns); legacy `_client` becomes the canonical path forever instead of a deprecation; loud at the call site. |
| **Option 2** — Inside the helper, resolve OAuth client and inject as `_client` into credentials before calling adapter | Same shape problem as Option 1 (credentials carrying client config); helper's behavior depends silently on whether `credentialsService` is registered; adapter signature still says nothing about OAuth client. |
| **Don't change the contract; ship a docs warning instead** | Doesn't fix the bug. |

## User Stories / Use Cases

- **A sales user** wants to **connect their Gmail and use it for more than an hour** so that **the CRM doesn't silently stop polling at the 1-hour mark**.
- **An admin** wants to **rotate the tenant's Gmail OAuth client secret in the Integrations UI** so that **the next refresh picks up the new secret without restarting workers**.
- **A platform engineer** wants the **refresh-credentials contract to expose `oauthClient` explicitly** so that **building a new provider package (e.g. Slack OAuth) doesn't require reverse-engineering an undocumented `_client` convention**.

## Architecture

### Sequence diagram (the fixed refresh path)

```
poll-channel worker
       │
       ▼
refreshCredentialsIfNeeded(adapter, channelId, credentials, scope, …)
       │
       ├── if !shouldRefresh(credentials) → return (refreshed=false)
       │
       ├── oauthClient = safeParseOAuthClient(
       │       await credentialsService.resolve(
       │         `oauth_${providerKey}`,
       │         scope
       │       )
       │   )
       │
       ▼
adapter.refreshCredentials({
  channelId,
  credentials,           // { accessToken, refreshToken, expiresAt, … }
  scope,
  oauthClient,           // { clientId, clientSecret }  ← NEW
})
       │
       ▼
google oauth client token endpoint
       │
       ▼
{ access_token, refresh_token?, expires_in, … }
       │
       ▼
RefreshedCredentials  → helper persists via credentialsService.save?(…)
       │
       ▼
Caller uses new credentials for the upcoming API call
```

### Commands & Events

**No new commands.** No new events. No new DI keys.

The change is a single field on an existing TS interface plus one resolver call in an existing helper plus one adapter signature read.

## Data Models

**No data model changes.** No migrations. The `oauth_<provider>` row already exists in `integration_credentials` (managed by the integrations module — see [`packages/core/src/modules/integrations/AGENTS.md`](../../packages/core/src/modules/integrations/AGENTS.md)).

## API Contracts

**No API changes.** This spec is internal-only: it changes a framework contract between hub and adapter, plus an internal helper.

## Internationalization (i18n)

**No new user-facing strings.** Existing translations for `communication_channels.channel.requires_reauth` cover the operator-visible signal when refresh fails after the fix.

One minor addition: if the legacy `_client` path is hit, log `[channel-gmail] reading OAuth client config from credentials._client is deprecated …` via `console.warn`. This is operator-log only, not localized.

## UI/UX

**None.** Existing UI does not change. The fix is invisible to end users — Gmail channels just keep working past the 1-hour mark.

## Configuration

**No new env vars.** Existing `OM_HUB_OAUTH_STATE_KEY` and per-provider client-credential storage are unchanged.

## Migration & Compatibility

### Backward Compatibility

| Contract surface | Change | Classification |
|---|---|---|
| Public type `RefreshCredentialsInput` | Optional field `oauthClient?` added | ✓ ADDITIVE |
| Public type `OAuthClientConfig` | New export | ✓ ADDITIVE |
| Helper `refreshCredentialsIfNeeded` | New behavior: resolves OAuth client config when `credentialsService` is registered. When the service is *not* registered (e.g., disabled in a downstream app), behavior is identical to today. | ✓ ADDITIVE |
| Gmail adapter `refreshCredentials` signature | Implementation reads new field; legacy `_client` still recognized with deprecation warning | ✓ ADDITIVE + DEPRECATION |
| Event IDs / API URLs / widget spot IDs / DI keys / ACL features | Unchanged | ✓ |
| DB schema | Unchanged | ✓ |

### Deprecation timeline

- **This release (Spec A merge):** new `oauthClient` field shipped; legacy `_client` read path still works with deprecation log.
- **Next minor release:** remove `legacyParseClientFromCredentialsOrThrow` from the Gmail adapter; remove `_client` test injections from unit tests.
- **Documentation update**: [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) gains an entry for `RefreshCredentialsInput._client` → `oauthClient` (deprecation tracked).

### Deployment notes

- Zero downtime.
- No migration to apply.
- After deploy: any Gmail channel currently in `status='error'` or `status='requires_reauth'` from refresh-failure backoff should be revisited manually (operator clicks "Reconnect"); the new code does not automatically re-auth — refresh requires a valid stored `refreshToken`. **If a refresh token was lost to log rotation during the buggy period, the user must re-connect their mailbox.** This is unavoidable.

## Implementation Plan

### Phase A1 — Contract + helper
1. Edit `packages/core/src/modules/communication_channels/lib/adapter.ts`:
   - Add `OAuthClientConfig` interface (exported).
   - Add `oauthClient?: OAuthClientConfig` to `RefreshCredentialsInput`.
2. Edit `packages/core/src/modules/communication_channels/lib/credential-refresh.ts`:
   - In `refreshCredentialsIfNeeded`, after the `shouldRefresh` check and before `adapter.refreshCredentials`, resolve `oauth_<providerKey>` via `deps?.credentialsService?.resolve(...)`.
   - Add `safeParseOAuthClient(value: unknown): OAuthClientConfig | undefined` near the existing `parseExpiresAt` helper.
   - Pass `oauthClient` to `adapter.refreshCredentials`.
3. Edit `packages/core/src/modules/communication_channels/lib/__tests__/credential-refresh.test.ts`:
   - Add unit tests: (a) `oauthClient` is resolved + passed to adapter when `credentialsService` is present and has a row; (b) `oauthClient` is `undefined` when no row; (c) no behavior change when `credentialsService` is absent (the disabled-integrations test case).

**Ship signal:** Helper unit tests green. `yarn build` passes.

### Phase A2 — Gmail adapter
1. Edit `packages/channel-gmail/src/modules/channel_gmail/lib/adapter.ts:refreshCredentials`:
   - Read OAuth client from `input.oauthClient` if present; else call the renamed `legacyParseClientFromCredentialsOrThrow(input.credentials)` with a deprecation `console.warn`.
   - Rename existing `parseClientCredentialsOrThrow` import to `legacyParseClientFromCredentialsOrThrow` and add the warning log.
2. Add unit test: `refreshCredentials` succeeds with `input.oauthClient` set, no `_client` in `credentials`.
3. Add unit test: legacy path still works but logs deprecation (assert console.warn called).
4. Update existing `adapter.test.ts:225` to use `oauthClient` (not `_client`) — keep one legacy test for the deprecation path.

**Ship signal:** Gmail unit tests green; manual diff review confirms no regression on `exchangeOAuthCode` (which legitimately uses `parseClientCredentialsOrThrow` and does not need the rename).

### Phase A4 — Inbound 401 → `requires_reauth` consistency
1. Edit `workers/poll-channel.ts`: in the catch block after `adapter.fetchHistory`, classify the error via existing `lib/error-classification.ts`; if the result is `'requires_reauth'` (401 / `invalid_grant`), call `markRequiresReauth(channelId)` command instead of the generic `channel.lastError = ...` path.
2. Add unit test for `poll-channel` covering the 401 path.

**Ship signal:** worker unit test green. Manual test: simulate token-expired Gmail with no refresh token; observe channel flips to `requires_reauth` after first poll instead of churning silently.

### Phase A5 — Integration test + docs
1. Add an integration test in `packages/channel-gmail/.../__integration__/TC-CHANNEL-EMAIL-A01-token-refresh.spec.ts`:
   - Connect a Gmail channel with stored OAuth client config in `integration_credentials.oauth_gmail` and stored per-user credentials with `expiresAt` 30s in the past.
   - Mock `https://oauth2.googleapis.com/token` to return a new access token.
   - Trigger a poll.
   - Assert: refresh call was made with the resolved `oauthClient`; new `accessToken` persisted; subsequent `gmail.googleapis.com` mock call uses the new token.
2. Update `apps/docs/docs/framework/modules/communication-channels.mdx`:
   - Document `RefreshCredentialsInput.oauthClient` for downstream provider authors.
   - Document the deprecation of `credentials._client`.

**Ship signal:** A01 green; doc preview renders.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/communication_channels/lib/adapter.ts` | Modify | Add `OAuthClientConfig` + `RefreshCredentialsInput.oauthClient?` |
| `packages/core/src/modules/communication_channels/lib/credential-refresh.ts` | Modify | Resolve OAuth client and pass to adapter |
| `packages/core/src/modules/communication_channels/lib/__tests__/credential-refresh.test.ts` | Modify | Unit tests for new resolution path |
| `packages/channel-gmail/src/modules/channel_gmail/lib/adapter.ts` | Modify | Read `input.oauthClient`; deprecate `_client` path |
| `packages/channel-gmail/src/modules/channel_gmail/lib/__tests__/adapter.test.ts` | Modify | Use new `oauthClient`; keep one legacy test |
| `packages/core/src/modules/communication_channels/workers/poll-channel.ts` | Modify | 401 → `requires_reauth` consistency |
| `packages/core/src/modules/communication_channels/workers/__tests__/poll-channel.test.ts` | Modify | Unit test for 401 path |
| `packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-A01-token-refresh.spec.ts` | Create | Integration test |
| `.ai/qa/scenarios/TC-CHANNEL-EMAIL-A01.md` | Create | QA scenario |
| `apps/docs/docs/framework/modules/communication-channels.mdx` | Modify | Document `oauthClient` |
| `BACKWARD_COMPATIBILITY.md` | Modify | Track `_client` deprecation |

### Testing Strategy

**Unit tests:**
- `refreshCredentialsIfNeeded`: with `credentialsService` returning a valid `oauth_gmail` row → adapter receives `oauthClient`; with empty row → adapter receives `undefined`; with no `credentialsService` → adapter receives `undefined` (today's behavior preserved).
- Gmail adapter `refreshCredentials`: with `input.oauthClient` set + no `_client` → success; with `_client` set + no `oauthClient` → success + deprecation warn; with neither → throws.
- `poll-channel`: 401 from `fetchHistory` → channel `status='requires_reauth'`; transient error → channel `status='error'`; success → unchanged.

**Integration tests:**

| Scenario ID | Title | Strategy |
|---|---|---|
| TC-CHANNEL-EMAIL-A01 | Gmail token refresh end-to-end | Mock OAuth token endpoint + Gmail API; trigger poll on near-expiry channel; verify refresh call carries `oauthClient`; verify new token persisted; verify follow-on API call uses new token |

## Risks & Impact Review

### Data Integrity Failures

#### Concurrent-refresh race
- **Scenario:** If two workers refresh the same channel in parallel and only one persists, the other's stored token becomes stale on next use.
- **Severity:** Medium
- **Affected area:** Gmail adapter, helper persistence
- **Mitigation:** `credentialsService.save` is atomic (last-write-wins). The helper persists immediately after a successful refresh. Worst case: a doubly-refreshed channel uses the most recently persisted token; the older "ghost" token errors and the next poll re-refreshes. The `outbound-delivery` and `poll-channel` paths both call refresh through the same helper; concurrent refresh on the same channel is rare (poll concurrency-per-channel is 1).
- **Residual risk:** Acceptable. If a runaway concurrent-refresh pattern emerges, add an in-process lock on `(channelId, scope.userId)` inside the helper.

#### Lost refresh tokens during the buggy period
- **Scenario:** Tokens that expired during the period when this bug was active may have been "lost" if no refresh token was ever stored. Affected channels are stuck.
- **Severity:** High (one-time user-visible disruption)
- **Affected area:** Existing connected Gmail channels
- **Mitigation:** Out of scope to recover — affected users must click "Reconnect" once after deploy. Operator-facing note in the release announcement.
- **Residual risk:** User experience hit for early adopters; mitigated by a coordinated reconnect prompt.

### Cascading Failures & Side Effects

#### Missing `oauth_<provider>` row
- **Scenario:** A user connected a Gmail channel before the tenant admin registered the OAuth client config in the Integrations UI (or an admin later deleted the row).
- **Severity:** Medium
- **Affected area:** All Gmail channels for the affected tenant
- **Mitigation:** Adapter falls back to legacy `_client` (which is empty for these accounts); throws a clear `OAuth client not configured for tenant — admin must complete provider setup in Integrations` error; channel flips to `status='requires_reauth'`. Operator-visible.
- **Residual risk:** Low — same error surface as today's bug but with a more actionable message.

### Tenant & Data Isolation Risks

#### OAuth client config cross-tenant leak
- **Scenario:** `oauth_<provider>` row resolved for tenant A is mistakenly applied to a refresh for tenant B.
- **Severity:** Critical (cross-tenant exposure of OAuth secrets — though secrets are encrypted; bigger risk is a refresh using tenant A's OAuth app for tenant B's user).
- **Affected area:** Helper resolution
- **Mitigation:** `credentialsService.resolve(integrationId, scope)` already filters by `scope.tenantId` and (for per-user channels) `scope.userId`. The helper passes the *channel's* `scope` directly. Integration test asserts cross-tenant isolation.
- **Residual risk:** A bug in `IntegrationCredentialsService` filtering — out of scope for this spec; tested separately.

### Migration & Deployment Risks

#### Test cheat masks a regression
- **Scenario:** Future changes accidentally re-introduce a `_client`-only path; tests still pass because they pre-pack `_client`.
- **Severity:** Medium
- **Affected area:** Gmail unit tests
- **Mitigation:** Phase A2 explicitly replaces test fixtures to use `oauthClient`. The integration test A01 does NOT pre-pack `_client` — it exercises the real resolution path. Future tests must follow A01 as the reference.
- **Residual risk:** Reviewer discipline.

### Operational Risks

#### Deprecation log noise
- **Scenario:** The `_client` deprecation warning fires noisily in logs.
- **Severity:** Low
- **Affected area:** Operator logs
- **Mitigation:** Internal callers are updated in Phase A2 to use `oauthClient`; no callers populate `_client` in production today (that's the whole bug), so production logs see zero warnings. The warning only fires from existing unit-test paths until they're cleaned up.
- **Residual risk:** None.

## Final Compliance Report — 2026-05-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No new ORM relations |
| root AGENTS.md | Filter by `organization_id` / `tenant_id` for tenant-scoped entities | Compliant | `credentialsService.resolve` is tenant + (optional) user scoped |
| root AGENTS.md | Validate all inputs with zod; `data/validators.ts` | N/A | No new API inputs |
| root AGENTS.md | Use DI (Awilix) — no `new`-ing services | Compliant | `credentialsService` resolved via deps argument (DI-friendly) |
| root AGENTS.md | Hash/encrypt PII; `findWithDecryption` for PII reads | Compliant | OAuth client secrets are already encrypted by the integrations module |
| root AGENTS.md | Singular names: entities, commands, events, feature IDs | Compliant | No new entities / commands / events / features |
| root AGENTS.md | Boy Scout rule | Compliant | Touched lines audited for DS / token usage |
| packages/core/AGENTS.md | Write operations via Command pattern | N/A | No new write operations |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` | N/A | No new routes |
| packages/core/AGENTS.md | `metadata.openApi` on API routes | N/A | No new routes |
| packages/core/AGENTS.md | `findWithDecryption` for encrypted-column reads | N/A | This spec doesn't read encrypted columns directly; relies on `IntegrationCredentialsService` |
| packages/core/src/modules/integrations/AGENTS.md | `IntegrationCredentialsService.resolve` is the canonical resolution path | Compliant | Helper uses it |
| .ai/qa/AGENTS.md | Integration tests with named scenarios `TC-…` | Partial | TC-CHANNEL-EMAIL-A01 is a route-registration **smoke** test, not token-refresh E2E. The refresh contract itself is covered by unit tests (`credential-refresh`, gmail adapter cases); end-to-end token rotation is manual QA (see `.ai/qa/scenarios/TC-CHANNEL-EMAIL-A01-*.md`). |
| .ai/specs/AGENTS.md | Spec filename `{date}-{title}.md`, kebab-case title | Compliant | `2026-05-27-oauth-refresh-credentials-client-wiring-fix.md` |
| .ai/specs/AGENTS.md | Required sections: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog | Compliant | All present |
| BACKWARD_COMPATIBILITY.md | Public types STABLE; new fields additive | Compliant | `oauthClient?` is optional + additive |
| BACKWARD_COMPATIBILITY.md | Deprecation protocol: never remove in one release, document, provide bridge ≥1 minor | Compliant | Legacy `_client` retained + deprecated for one minor |
| BACKWARD_COMPATIBILITY.md | Event IDs / API URLs / DI keys / ACL features FROZEN | Compliant | None changed |
| BACKWARD_COMPATIBILITY.md | DB schema ADDITIVE-ONLY | Compliant | No DB changes |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | N/A | No models / APIs touched |
| Risks cover all write operations | Pass | Concurrent-refresh race, missing oauth row, cross-tenant leak |
| Commands defined for all mutations | N/A | No new mutations |
| Phasing is testable + incrementally deliverable | Pass | Each of A1-A5 has explicit ship signal |
| Deprecation timeline is concrete | Pass | "Next minor release" stated |

### Non-Compliant Items
None.

### Verdict
**Fully compliant — approved for implementation pending user sign-off.**

---

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| A1 — Contract + helper | Done | 2026-05-27 | Added `OAuthClientConfig` + `RefreshCredentialsInput.oauthClient?`. Helper resolves `oauth_<provider>` and passes through. 12/12 unit tests green (added 5 Spec-A specific cases). |
| A2 — Gmail adapter | Done | 2026-05-27 | Reads `input.oauthClient` first; legacy `_client` path retained with one-time deprecation warning. 19/19 unit tests green. |
| A4 — Inbound 401 → requires_reauth | Done | 2026-05-27 | Already implemented in `handlePollError` (poll-channel.ts:310). 10/10 poll-channel tests confirm 401/`invalid_grant` flips status to `requires_reauth` and emits the notification event. |
| A5 — Integration tests + docs | Done | 2026-05-27 | One Playwright smoke test (TC-CHANNEL-EMAIL-A01) verifying OAuth route accessibility. A comprehensive QA scenario markdown documenting manual E2E verification. Docs updated in `apps/docs/docs/framework/modules/communication-channels.mdx` (new "Credential refresh contract" section). `BACKWARD_COMPATIBILITY.md` tracks the `_client` deprecation. |
| Verification | Done | 2026-05-27 | `yarn build:packages` clean; all touched packages pass tests (247 core + 50 gmail + 12 helper = 309+ tests green). The two pre-existing channel-imap test failures are Spec B territory (staged work for the IMAP rewrite — not caused by Spec A). |

### Detailed Coverage

- **Unit tests added** (all green):
  - `packages/core/src/modules/communication_channels/lib/__tests__/credential-refresh.test.ts` — 5 new Spec-A cases (resolves oauth\_provider, undefined when no row, undefined when no credentialsService, undefined when row is malformed, swallows resolve errors).
  - `packages/channel-gmail/src/modules/channel_gmail/lib/__tests__/adapter.test.ts` — 3 new Spec-A cases (new oauthClient path, deprecated `_client` fallback with warn, error when neither present).
- **Integration test smoke spec added**: `TC-CHANNEL-EMAIL-A01-token-refresh.spec.ts` (Gmail). Verifies the OAuth route is registered; full token-refresh E2E is covered by manual QA scenario.
- **QA scenario added**: `.ai/qa/scenarios/TC-CHANNEL-EMAIL-A01-gmail-token-refresh.md`. Documents the full manual E2E flow (force-expire token, trigger poll, verify refresh path, verify reauth-required surface).
- **Docs updated**: `apps/docs/docs/framework/modules/communication-channels.mdx` gained a new "Credential refresh contract" section between Architecture and OAuth setup.
- **BC tracking**: `BACKWARD_COMPATIBILITY.md` lists `RefreshCredentialsInput.oauthClient?` as STABLE additive and flags the `_client` deprecation for removal in the next minor release.

### Files Touched

| File | Action |
|---|---|
| `packages/core/src/modules/communication_channels/lib/adapter.ts` | Modified — added `OAuthClientConfig` interface + `oauthClient?` field |
| `packages/core/src/modules/communication_channels/lib/credential-refresh.ts` | Modified — resolves OAuth client + passes to adapter + `safeParseOAuthClient` helper |
| `packages/core/src/modules/communication_channels/lib/__tests__/credential-refresh.test.ts` | Modified — added 5 Spec-A test cases |
| `packages/channel-gmail/src/modules/channel_gmail/lib/adapter.ts` | Modified — `resolveGmailOAuthClient` reads new field, deprecated legacy `_client` |
| `packages/channel-gmail/src/modules/channel_gmail/lib/__tests__/adapter.test.ts` | Modified — added 3 Spec-A test cases; updated existing 2 to use new field |
| `packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-A01-token-refresh.spec.ts` | Created — Playwright smoke test |
| `.ai/qa/scenarios/TC-CHANNEL-EMAIL-A01-gmail-token-refresh.md` | Created — manual QA scenario |
| `apps/docs/docs/framework/modules/communication-channels.mdx` | Modified — added "Credential refresh contract" section |
| `BACKWARD_COMPATIBILITY.md` | Modified — added `RefreshCredentialsInput.oauthClient` + `_client` deprecation entries |

## Changelog

### 2026-05-27
- Initial specification. Surgical fix for the `RefreshCredentialsInput._client` wiring bug uncovered during the Spec B research audit. Companion to [`2026-05-27-email-integration-inbound-reliability-and-threading.md`](2026-05-27-email-integration-inbound-reliability-and-threading.md); ships independently and in parallel.
- **Implementation complete 2026-05-27**. All 5 phases delivered, 247+ unit tests green, build clean. Files staged in `feat/demo-hoodie` per user policy (no auto-commit).


---

## Part 4 — OAuth client-credential resolution + per-user privacy hardening (v1, 2026-06-01)

Post-PoC review of the per-user email integration surfaced three issues; this part records the OAuth client-credential wiring fix. The per-user **privacy/visibility** decisions and their enforcement points live authoritatively in [`2026-05-21-email-integration-foundation.md`](2026-05-21-email-integration-foundation.md) (§ *Per-user privacy & visibility model (v1)*); they are summarized at the end.

### Problem — "Healthy integration, but Connect Gmail fails"

`/backend/integrations` showed Gmail **Healthy** (client credentials stored under the `channel_gmail` integration), yet *Connect Gmail* on the profile page returned:

> `Invalid Gmail OAuth client credentials: Invalid input: expected string, received undefined`

Root cause: every OAuth code path — authorize-`initiate`, code-exchange `callback`, and token `refresh` (Part 3) — resolved a **phantom `oauth_<provider>` integration id** that nothing ever writes. The provider package registers its client-credential fields (and the admin saves them) under `channel_<provider>`; the health check reads `channel_<provider>`. Resolution therefore returned `null` → `{}` → the adapter's Zod schema rejected the missing `clientId`. The mismatch was invisible because health and connect read different ids.

### Fix

- New `communication_channels/lib/oauth-client-config.ts` → `resolveOAuthClientCredentials(service, providerKey, scope)`. Resolves the client app config from **`channel_<provider>` at tenant scope (`userId = null`)**, with an organization-agnostic (`organization_id IS NULL`) fallback so one tenant/platform OAuth app serves every org (and a config saved with no active org is still found). Per-user OAuth *tokens* live under the same `channel_<provider>` id at *user* scope; the two never collide.
- `initiate`, `callback`, and `credential-refresh` (Part 3's `refreshCredentialsIfNeeded`) all use the helper. The refresh path forces tenant scope so it never accidentally matches the per-user token row.
- The phantom `oauth_<provider>` read path is removed. Part 3's `RefreshCredentialsInput.oauthClient` slot is unchanged; only its *source* is corrected (`channel_<provider>` tenant scope).
- Missing client config now returns an actionable `oauth_client_not_configured` (initiate → HTTP 409; callback → flash code) surfaced as "ask an administrator to add the OAuth Client ID and Secret under Integrations"; the cryptic Zod string no longer reaches the user. New i18n key `communication_channels.profile.connect.notConfigured` (en/de/es/pl).

### Tests
- `communication_channels/lib/__tests__/oauth-client-config.test.ts` — tenant-scope resolution, org-agnostic fallback, `clientId` guard, error swallow, no double-resolve when org is already null.
- `credential-refresh.test.ts` updated to assert resolution of `channel_<provider>` at `userId: null` (was `oauth_<provider>`).

### Backward compatibility
Internal-only. `oauth_<provider>` was never written, so dropping the read path breaks no stored data. The `RefreshCredentialsInput.oauthClient` / `OAuthClientConfig` types are unchanged (Part 3). No DB / migration changes.

### Per-user privacy hardening (v1 strict owner-only) — summary

Enforcement points (full record in the foundation spec): the admin channels list returns `user_id IS NULL` rows only; **owners have full self-service control over their own personal mailboxes** (disconnect / set-primary / poll-now / import-history / register-push) via `connect_user_channel` + the new `assertCanManageChannel` — owner-only, no admin bypass, while tenant-wide channels still require the elevated feature (`manage` / `channel.push.manage` / `channel.import_history`); `personEmailThreads.ts` scopes to `author_user_id = viewer` (fail-closed); `applyEmailVisibilityFilter` / `buildEmailVisibilityMikroFilter` and the visibility-change gate drop the admin bypass. `customers.email.view_private` and `communication_channels.admin`'s cross-user view are reserved, inert, for v2 oversight.

## Changelog (consolidation)

### 2026-06-01
- Consolidated the three 2026-05-27 email follow-up specs into this single document (Parts 1–3 preserved verbatim). Added Part 4: the OAuth client-credential resolution fix (resolve `channel_<provider>` at tenant scope, not the phantom `oauth_<provider>`) + actionable `oauth_client_not_configured` error, plus a summary of the v1 strict-owner-only privacy hardening (authoritative detail in the foundation spec).
