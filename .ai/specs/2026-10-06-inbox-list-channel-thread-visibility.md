# Inbox List — Channel-Thread Visibility for Unassigned Conversations

> **Status:** Implemented on branch `fix/issue-6106-inbox-list-channel-unassigned` — awaiting review
> **Issue:** [open-mercato#6106](https://github.com/open-mercato/open-mercato/issues/6106) (follow-up to #5645 / #5535)
> **Scope:** OSS — `messages` (`api/route.ts`, `lib/participantScope.ts`, `lib/channelThreadWidening.ts`) and `communication_channels` (`lib/channel-thread-access.ts`, `data/enrichers.ts`, `di.ts`)

## TLDR

**Key Points:**
- An inbound channel message on an **unassigned** conversation has the channel system user as sender and **no** `message_recipients` row. The inbox list (`folder=inbox`, the default) is recipient-only, so such a message can be opened and answered via its direct link (#5645) but never appears in the listing.
- The list gets a second, narrow path: a **public** message on a channel thread the caller may act on, for a caller who holds `messages.view`, is listed even with no recipient row.
- The same predicate is shared with the `communication_channels.message-channel` enricher, so channel metadata is shown for exactly the messages the list returns.

**Scope:**
- Hub facade `listAccessibleChannelThreadIds` — one bounded query returning the thread ids the actor may act on (list-shaped counterpart of #5645's per-thread `resolveChannelThreadAccess`).
- `resolveChannelThreadWideningIds` (messages) — `messages.view` RBAC gate, then the hub facade; any failure widens nothing.
- `applyMessageParticipantScope` and `channelThreadVisibilityClause` — the single predicate both call sites use.
- Inbox folder: recipient branch OR (no recipient row AND channel-thread widening). `all` folder: the shared predicate with the widening clause.

**Concerns:**
- This widens what a whole class of operators can **enumerate**, not just open one record — the issue's stated blast-radius concern. Mitigations are listed in § Risks.
- A tenant with more than 5000 channel threads gets no widening (fail closed) rather than a truncated, misleading list.

---

## Overview

#5645 fixed the two single-record guards (`GET /api/messages/{id}`, `POST /api/messages/{id}/reply`) by falling back to channel-thread access when the participant test fails. The list route was deliberately left alone, because widening a listing changes what operators can enumerate. This spec defines that widening and the constraints it must satisfy.

## Problem Statement

`applyMessageParticipantScope` (sender OR non-deleted recipient) and the inbox's recipient join both answer "is this caller a participant?". For a channel-thread message on an unassigned conversation the answer is structurally no for every operator, including a tenant admin. The single-record fallback resolves this per message; the list cannot afford one hub call per row.

## Proposed Solution

### A. Hub facade: channel threads the actor may act on

`communication_channels/lib/channel-thread-access.ts` — `listAccessibleChannelThreadIds(container, scope, actor)`:

1. Load `ChannelThreadMapping` rows for the caller's tenant/organization, `limit = CHANNEL_THREAD_LIST_LIMIT + 1` (5000 + 1).
2. If more than 5000 rows → return `null` (fail closed; caller widens nothing).
3. Load the referenced `CommunicationChannel`s in the same scope (not deleted).
4. Keep only channels for which `assertCanAccessChannel` passes for the actor — personal mailboxes stay owner-only; shared channels pass for any caller the route already gated.
5. Return the `messageThreadId`s of the mappings on accessible channels.

Registered in DI as `communicationChannelsListAccessibleChannelThreadIds` (optional module; absent → no widening).

### B. Caller gate and resolver

`messages/lib/channelThreadWidening.ts` — `resolveChannelThreadWideningIds(container, scope)`:

- Returns `[]` unless the caller holds `messages.view` through RBAC (`canUseChannelThreadFallback`, wildcard-aware). The JWT carries no feature claim, so the check is never read from `ctx.auth`.
- Returns `[]` when the hub is not registered, the hub throws, or the hub returns `null`.

### C. Shared predicate

`messages/lib/participantScope.ts`:

- `channelThreadVisibilityClause(eb, ids)` = `m.thread_id IN ids AND m.visibility = 'public'`. Only messages explicitly `public` widen — the same "not explicitly public stays participant-only" rule the detail route applies. Internal notes never widen.
- `applyMessageParticipantScope(query, userId, channelThreadIds = [])` adds that clause to the sender-OR-recipient disjunction when `ids` is non-empty.

### D. List route

`messages/api/route.ts` `GET`:

- For `folder` `inbox` or `all`, resolve the widening ids first.
- `inbox`: `(r.message_id IS NOT NULL AND r.deleted_at IS NULL AND r.archived_at IS NULL) OR (r.message_id IS NULL AND <channel clause>)`, plus `is_draft = false`. The `r.message_id IS NULL` term means the caller has **no** row for the message, so an archived or deleted row cannot resurface through the widened branch.
- `all`: `applyMessageParticipantScope(q, userId, ids)`.
- **List cache bypass** when `ids` is non-empty: cache keys cover scope and filters only, but channel sharing changes who may see a thread. Widened responses are neither read from nor written to the list cache.

### E. Enricher

`communication_channels/data/enrichers.ts` (`messageChannelEnricher`): resolves the same ids from `ctx.container` / `ctx.userId` / `ctx.userFeatures` and passes them to `applyMessageParticipantScope`, so channel metadata follows the list exactly.

## Architecture

```
GET /api/messages?folder=inbox
  └─ resolveChannelThreadWideningIds(container, scope)
       ├─ canUseChannelThreadFallback  → RBAC messages.view   (else [])
       └─ communicationChannelsListAccessibleChannelThreadIds  (hub)
            └─ mappings(tenant/org, ≤5000) → channels → assertCanAccessChannel → thread ids
  └─ inbox predicate: recipient branch OR (no-row AND channelThreadVisibilityClause)
  └─ cache bypassed when ids ≠ []

enricher (message-channel)
  └─ same resolver → applyMessageParticipantScope(…, ids)
```

## Data Models

No schema change. Reads `messages.thread_id`, `messages.visibility`, `message_recipients`, `channel_thread_mappings`, `communication_channels`.

## API Contracts

`GET /api/messages` — same request and response shapes. Result **membership** changes: for a caller holding `messages.view`, public messages on accessible channel threads with no recipient row now appear in `folder=inbox` and `folder=all`. No field is added, removed or retyped.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Mitigation | Residual |
|------|------------------|----------|------------|----------|
| Over-widening enumeration | Operator lists channel threads they should not see | High | Gated by RBAC `messages.view` **and** the hub's own `assertCanAccessChannel`; personal mailboxes owner-only; public-only | Medium — by design (shared channel = shared inbox) |
| Internal notes surface | Non-public message on a channel thread listed to a non-participant | High | `visibility = 'public'` in the clause; internal branch never widens | Low |
| Archived row resurfaces | Operator archived a channel message, widened branch brings it back | Medium | `r.message_id IS NULL` confines widening to no-row messages | Low |
| Stale list cache | Cached list ignores a newly shared channel, or keeps showing a revoked one | Medium | Cache read and write bypassed whenever widening applies | Low |
| Enricher desync | Channel metadata shown for messages the list hides (or the reverse) | High | One predicate, one resolver, both call sites | Low |
| Tenant scale | Thousands of channel threads make the list slow | Medium | Hard cap 5000; over cap → fail closed | Medium — large tenants get no widening until a SQL-side access model exists |
| Hub missing / failing | Widening silently partial | Low | Any failure resolves to `[]`, participant rule unchanged | Low |

## Test Plan

- `communication_channels/lib/__tests__/channel-thread-list-access.test.ts` — only accessible channels' threads returned; tenant/org scope on the lookup; empty tenant → `[]`; over the limit → `null`.
- `messages/lib/__tests__/channelThreadWidening.test.ts` — widening only with `messages.view`; no hub call without the gate; RBAC absent, hub absent, hub throws, hub `null` each widen nothing.
- Existing `messages` and `communication_channels` suites: 161 suites / 1363 tests passing with the new predicate and inbox branch (route tests stub the new gate to "off").
- **Integration coverage (AGENTS.md § integration tests): not included in this change.** It needs a live channel-thread fixture (an ingested unassigned message on a shared channel, and a personal-mailbox counter-case). Tracked as a follow-up on this PR. Until it lands, the list branch is covered at unit level only.

## Migration & Backward Compatibility

Not a contract-shape change: no route, field, event, DB column or DI name is removed or renamed. The change is an **additive visibility rule** for callers holding `messages.view`:

- New DI name `communicationChannelsListAccessibleChannelThreadIds` (additive).
- `applyMessageParticipantScope` gains an optional third argument (additive).
- Listing membership changes for channel-linked, unassigned, public messages. Operators relying on the old "inbox shows only my recipient rows" behavior for these messages will see additional rows. No client change is required.

## Final Compliance Report

- Spec present and updated with the implementation (AGENTS.md specs rule) — ✓
- Permissions: RBAC gate before any widening; personal channels owner-only — ✓
- Tenant/organization scoping on every lookup — ✓
- No cross-tenant enumeration: all queries carry `tenantId` and the org scope — ✓
- Integration test for the affected API path — **pending** (see § Test Plan)

## Changelog

- 2026-10-06 — Initial spec and implementation for #6106: hub list facade, RBAC-gated resolver, shared predicate for the inbox list and the enricher, list-cache bypass when widening applies.
