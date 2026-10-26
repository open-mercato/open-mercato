# Inbox List — Channel-Thread Visibility for Unassigned Conversations

> **Status:** Implemented on branch `fix/issue-6106-inbox-list-channel-unassigned` — review findings addressed
> **Issue:** [open-mercato#6106](https://github.com/open-mercato/open-mercato/issues/6106) (follow-up to #5645 / #5535)
> **PR:** [open-mercato#6964](https://github.com/open-mercato/open-mercato/pull/6964)
> **Scope:** OSS — `messages` (`api/route.ts`, `api/unread-count/route.ts`, `api/[id]/{route,read,archive}`, `lib/participantScope.ts`, `lib/channelThreadWidening.ts`, `lib/channelInboxRecipient.ts`) and `communication_channels` (`lib/channel-inbox-predicate.ts`, `data/enrichers.ts`, `di.ts`)

## TLDR

**Key Points:**
- An inbound channel message on an **unassigned** conversation has the channel system user as sender and **no** `message_recipients` row. The inbox list (`folder=inbox`, the default) is recipient-only, so such a message can be opened and answered via its direct link (#5645) but never appears in the listing.
- The list gets a second, narrow path expressed **in SQL**: an *inbound* message on an *unassigned* conversation of a channel the caller may work, for a caller who holds `messages.view` and has **no recipient row at all** for it.
- Read state is per operator. The caller's own recipient row is created lazily on their first open or action; until then the list reports the row as `unread`, so a new customer message is flagged as new.
- The same predicate is shared with the `communication_channels.message-channel` enricher, so channel metadata is shown for exactly the messages the list returns.

**Scope:**
- Hub SQL predicate `buildChannelInboxPredicate` (DI: `communicationChannelsBuildChannelInboxPredicate`) — inbound link + unassigned mapping + channel-owner rule, as correlated `EXISTS` subqueries. No id collection, no cap.
- `resolveChannelInboxPredicate` (messages) — `messages.view` RBAC gate, then the hub predicate bound to the caller's scope; absent hub or denied gate → `null`, nothing widens.
- `channelInboxWideningClause` and `applyMessageParticipantScope` — the single clause every call site uses.
- `ensureChannelInboxRecipient` — creates the caller's recipient row on first open / action (read, unread, archive, unarchive, delete).
- Inbox folder, `all` folder, `status=unread` filter and `unread-count` use the clause.

**Concerns:**
- This widens what a whole class of operators can **enumerate**, not just open one record — the issue's stated blast-radius concern. The clause is built so it is never wider than the single-record read rule (§ C).

---

## Overview

#5645 fixed the two single-record guards (`GET /api/messages/{id}`, `POST /api/messages/{id}/reply`) by falling back to channel-thread access when the participant test fails. The list route was deliberately left alone, because widening a listing changes what operators can enumerate. This spec defines that widening and the constraints it must satisfy.

## Problem Statement

`applyMessageParticipantScope` (sender OR non-deleted recipient) and the inbox's recipient join both answer "is this caller a participant?". For a channel-thread message on an unassigned conversation the answer is structurally no for every operator, including a tenant admin. The single-record fallback resolves this per message; the list cannot afford one hub call per row.

## Proposed Solution

### A. Hub predicate: inbound, unassigned, accessible channel

`communication_channels/lib/channel-inbox-predicate.ts` — `buildChannelInboxPredicate(eb, scope, actor)` returns a SQL expression over the outer `messages as m` row:

```
EXISTS (SELECT 1 FROM message_channel_links mcl
        WHERE mcl.message_id = m.id AND mcl.direction = 'inbound' AND mcl.tenant_id = :tenant)
AND EXISTS (SELECT 1 FROM channel_thread_mappings ctm
            JOIN communication_channels cc ON cc.id = ctm.channel_id
            WHERE ctm.message_thread_id = m.thread_id
              AND ctm.tenant_id = :tenant AND ctm.organization_id = :org      -- or IS NULL
              AND ctm.assigned_user_id IS NULL
              AND cc.tenant_id = :tenant AND cc.deleted_at IS NULL
              AND (cc.organization_id = :org OR cc.organization_id IS NULL)
              AND (cc.user_id IS NULL OR cc.user_id = :actor))                -- channel-owner rule
```

- **Inbound only** — an operator's own reply, a `send-as-user` message and an internal note have no inbound link and never match.
- **Unassigned only** — a conversation routed to a colleague stays on that colleague's recipient row.
- **Channel-owner rule** — the SQL twin of `assertCanAccessChannel` / `channelOwnerScopeWhere`: shared channels, or the actor's own. A personal mailbox of someone else never matches (and its conversations are assigned to the owner anyway).
- Tenant/organization scoping mirrors `resolveChannelThreadAccess`. Registered in DI as `communicationChannelsBuildChannelInboxPredicate` (optional module; absent → no widening).
- No thread-id collection, no cap, no per-request scan: the work is a pair of index-backed semi-joins (`message_channel_links_message_idx`, `channel_thread_mappings_thread_idx`) inside the existing list query.

### B. Caller gate and resolver

`messages/lib/channelThreadWidening.ts` — `resolveChannelInboxPredicate(container, scope)`:

- Returns `null` unless the caller holds `messages.view` through RBAC (`canUseChannelThreadFallback`, wildcard-aware). The JWT carries no feature claim, so the check is never read from `ctx.auth`.
- Returns `null` when the hub service is not registered or not callable.
- Runs no query itself; it returns a closure that embeds the hub predicate in the caller's query.

### C. Shared clause (never wider than the read rule)

`messages/lib/participantScope.ts` — `channelInboxWideningClause(eb, userId, predicate)`:

```
m.visibility = 'public'
AND m.source_entity_type = 'communication_channels.external_conversation'
AND NOT EXISTS (SELECT 1 FROM message_recipients rx
                WHERE rx.message_id = m.id AND rx.recipient_user_id = :user)   -- no deleted_at filter
AND <hub predicate>
```

- `public` + `external_conversation` source type are exactly what `resolveMessageReadAccess` / `hasChannelThreadReadAccess` require, so the list never shows a subject, preview or address of a message the detail route would answer 403 for.
- The caller must have **no recipient row at all**, deleted or archived included. A row the caller deleted or archived must not resurface through this branch. (The participant join in `applyMessageParticipantScope` keeps its `deleted_at IS NULL` filter, which is why this needs its own `NOT EXISTS`.)
- `applyMessageParticipantScope(query, userId, predicate?)` adds the clause as a third OR branch next to sender and live recipient.

### D. List route

`messages/api/route.ts` `GET`:

- For `folder` `inbox` or `all`, resolve the predicate first.
- `inbox`: `(r.message_id IS NOT NULL AND r.deleted_at IS NULL AND r.archived_at IS NULL) OR <widening clause>`, plus `is_draft = false`.
- `all`: `applyMessageParticipantScope(q, userId, predicate)`.
- `status=unread`: `r.status = 'unread' OR <widening clause>`.
- A row without a recipient row of someone other than the sender reports `status: 'unread'` (their own rows keep `sent` / `draft`).
- **List cache bypass** when the predicate resolves: cache keys cover scope and filters only, but channel sharing and assignment change who may see a conversation.

### E. Per-operator read state: recipient row on first open / action

`messages/lib/channelInboxRecipient.ts` — `ensureChannelInboxRecipient(container, em, scope, messageId)` re-checks the message against the very same clause (single-row query) and, when it matches, inserts the caller's `message_recipients` row (`status = 'unread'`, type `to`). A concurrent first open hits the `(message_id, recipient_user_id)` unique constraint and simply reads the row back.

It is called:

| Route | When |
|-------|------|
| `GET /api/messages/{id}` | a real open (not `skipMarkRead=1`), before the recipient lookup — the row is created and the existing auto-mark-read marks it read |
| `PUT` / `DELETE /api/messages/{id}/read` | mark read / mark unread, when the caller has no live row |
| `PUT` / `DELETE /api/messages/{id}/archive` | archive / unarchive, same |
| `DELETE /api/messages/{id}` | delete for a non-sender with no live row |

Read/unread rule: every operator who may work the channel sees the message as `unread` until **they** open or act on it. One operator's read, archive or delete never changes another operator's view. After the first action the message takes the normal recipient branch; once archived or deleted by the operator it stays out of their Inbox (the widening clause requires no row at all). `unread-count` adds the same clause, so a new customer message counts toward the badge until it is opened.

### F. Enricher

`communication_channels/data/enrichers.ts` (`messageChannelEnricher`): resolves the same predicate from `ctx.container` and passes it to `applyMessageParticipantScope`, so channel metadata follows the list exactly.

## Architecture

```
GET /api/messages?folder=inbox
  └─ resolveChannelInboxPredicate(container, scope)
       ├─ canUseChannelThreadFallback  → RBAC messages.view   (else null)
       └─ communicationChannelsBuildChannelInboxPredicate  (hub, SQL only)
  └─ inbox predicate: recipient branch OR channelInboxWideningClause
  └─ cache bypassed when the predicate resolves

GET /api/messages/{id} · PUT|DELETE …/read · PUT|DELETE …/archive · DELETE /api/messages/{id}
  └─ no live recipient row → ensureChannelInboxRecipient → same clause, single message → insert row

enricher (message-channel)
  └─ same resolver → applyMessageParticipantScope(…, predicate)
```

## Data Models

No schema change. Reads `messages.thread_id`, `messages.visibility`, `message_recipients`, `channel_thread_mappings`, `communication_channels`.

## API Contracts

`GET /api/messages` — same request and response shapes. Result **membership** changes: for a caller holding `messages.view`, inbound public messages on unassigned conversations of channels they may work, for which they have no recipient row, now appear in `folder=inbox` and `folder=all` with `status: 'unread'`. `status=unread` and `GET /api/messages/unread-count` include them. No field is added, removed or retyped.

`GET /api/messages/{id}` (without `skipMarkRead`), read, archive and delete now create the caller's own recipient row for such a message instead of answering 403 / leaving it unread forever.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Mitigation | Residual |
|------|------------------|----------|------------|----------|
| Over-widening enumeration | Operator lists conversations they should not see | High | RBAC `messages.view` gate **and** the hub's channel-owner rule in SQL; inbound + unassigned + public + `external_conversation` only | Medium — by design (shared channel = shared inbox) |
| Own replies / send-as-user in Inbox | The replier (and every colleague) sees the outbound message | High | Inbound `message_channel_links` row required; outbound, send-as-user and internal messages never match | Low |
| Assigned conversations listed | Messages already routed to a colleague show for every operator | High | `channel_thread_mappings.assigned_user_id IS NULL` in the predicate | Low |
| List wider than the read rule | Subject / preview / address shown for a message the detail route 403s | High | Clause requires `visibility = 'public'` **and** `source_entity_type = communication_channels.external_conversation`, the detail route's conditions | Low |
| Deleted / archived row resurfaces | Owner of a personal mailbox deletes a mail, it reappears under All; deleting it returns 403 | Medium | `NOT EXISTS` on `message_recipients` with no `deleted_at` filter — widen only when the caller has no row at all | Low |
| Rows cannot be acted on | Mark read / archive / delete answer 403, the row never leaves the Inbox | High | Caller's own recipient row created on first open / action (`ensureChannelInboxRecipient`), guarded by the same clause | Low |
| Row reads as already read | New customer message never flagged as new, absent from `unread-count` and `status=unread` | Medium | No-row rows report `unread`; `status=unread` and `unread-count` use the clause | Low |
| Stale list cache | Cached list ignores a newly shared / reassigned channel | Medium | Cache read and write bypassed whenever the predicate resolves | Medium — widening callers (every `messages.view` holder) lose the Inbox/All list cache; the query is index-backed |
| Tenant scale | Thousands of channel threads | Medium | No id collection and no cap: `EXISTS` semi-joins on indexed columns inside the list query | Low |
| Enricher desync | Channel metadata shown for messages the list hides | High | One clause, one resolver, both call sites | Low |
| Hub missing / failing | Widening silently partial | Low | Absent or non-callable hub service → no predicate → participant rule unchanged | Low |
| `unread-count` cost | The badge poll runs one more count query | Low | Skipped without `messages.view`; same clause, index-backed semi-joins | Low |

**N+1 note:** no per-row queries are introduced. The predicate is a correlated `EXISTS` inside one list query; `ensureChannelInboxRecipient` runs once per single-message request.

## Test Plan

- `communication_channels/lib/__tests__/channel-inbox-predicate.test.ts` — compiles the hub predicate: inbound link, unassigned mapping, channel-owner rule, tenant/organization scope with and without an organization.
- `messages/lib/__tests__/channelThreadWidening.test.ts` — predicate only with `messages.view`; absent RBAC, absent hub, non-callable hub each resolve to `null`; the hub is bound lazily.
- `messages/lib/__tests__/participantScope.test.ts` — `applyMessageParticipantScope` with and without the predicate: third OR branch, `public` + source type, `NOT EXISTS` without a `deleted_at` filter.
- `messages/api/__tests__/list-channel-inbox.test.ts` — compiled list SQL for `inbox`, `all`, `status=unread`; `sent` / `drafts` / `archived` never widen; no widening without `messages.view` or without the hub; cache bypass; `unread` status for rows without a recipient row.
- `messages/lib/__tests__/channelInboxRecipient.test.ts`, `messages/api/[id]/**/__tests__`, `messages/api/unread-count/__tests__` — recipient row created only for eligible messages, concurrent creation, 403 stays for everything else, unread count includes widened rows.
- `communication_channels/data/__tests__/enrichers.test.ts` — the enricher gates on the same predicate.
- Integration: `communication_channels/__integration__/TC-CHANNEL-INBOX-001.spec.ts` — real `ingest_inbound_message` on a shared channel (`seedConnectedChannel({ shared: true })`): operator with `messages.view` sees the message in `inbox` and `all` flagged unread; operator without `messages.view`, another user's personal mailbox, an internal note, the operator's own reply and a conversation assigned to a colleague are not listed; read / unread / archive / delete work and a deleted message does not return in `all`.

## Migration & Backward Compatibility

Not a contract-shape change: no route, field, event, DB column or DI name is removed or renamed. The change is an **additive visibility rule** for callers holding `messages.view`:

- New DI name `communicationChannelsBuildChannelInboxPredicate` (additive).
- `applyMessageParticipantScope` gains an optional third argument (additive; its type changed from thread ids to a predicate before first release).
- The test-seed `connect-channel` action gains an optional `shared` flag (test-only, additive).
- Listing membership changes for inbound, unassigned, public channel messages. Operators relying on the old "inbox shows only my recipient rows" behavior for these messages will see additional rows. No client change is required.

## Final Compliance Report

- Spec present and updated with the implementation (AGENTS.md specs rule) — ✓
- Permissions: RBAC gate before any widening; personal channels owner-only; list never wider than the single-record read rule — ✓
- Tenant/organization scoping on every lookup — ✓
- No cross-tenant enumeration: all queries carry `tenantId` and the org scope — ✓
- Integration test for the affected API path — ✓ (`TC-CHANNEL-INBOX-001`)

## Changelog

- 2026-10-06 — Initial spec and implementation for #6106: hub list facade, RBAC-gated resolver, shared predicate for the inbox list and the enricher, list-cache bypass when widening applies.
- 2026-10-26 — Review pass on #6964: widened predicate narrowed to inbound + unassigned + `external_conversation` and moved to a hub SQL `EXISTS` (no id scan, no cap); per-operator recipient row on first open / action and `unread` status / `status=unread` / `unread-count` for rows without one; the `all` folder widens only when the caller has no recipient row at all (deleted included); unit and integration coverage.
