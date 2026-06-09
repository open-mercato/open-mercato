> Auto-generated cache-performance Feature Request — candidate 9 of 9
> Endpoint: `GET /api/messages` · ROI 58 · Verdict: good
> Source: `packages/core/src/modules/messages/api/route.ts`
> Revised 2026-06-09: invalidation now piggybacks on the **already-flushed** `crud:messages.message:*` tags from the command bus — the previously proposed 7 event subscribers and the per-recipient tag fan-out are dropped.

## Summary

Add a manual, tenant-scoped cache to the custom `GET /api/messages` list handler. The handler is NOT a `makeCrudRoute` endpoint, so the generic CRUD list cache never touches it. It runs 5-6 heavy queries per call (Kysely base + count, `findWithDecryption` on `Message`, `em.find` on `MessageObject`, two Kysely `group by` aggregations, and `findWithDecryption` on `User` for sender metadata).

**Key simplification:** every write that changes this list — compose/send, mark read, mark unread, archive/unarchive, delete, action taken — is a **command** with `resourceKind: 'messages.message'` (verified: `commands/messages.ts:444/667/822/974/1088`, `commands/recipients.ts:64`, `commands/actions.ts:144`, `commands/confirmations.ts:135`, `commands/attachments.ts:86/175`, `commands/shared.ts:350`). The command bus already flushes `crud:messages.message:tenant:<T>:org:<O>:collection` + record tags after every execute/undo, post-commit (`command-bus.ts:610/642`). Tag the cached list entries with that collection tag and **all seven previously-proposed subscribers become unnecessary**.

The trade: the existing flush is org-wide, not per-recipient — any message write in the org flushes every user's cached list. At a 30 s TTL on a read-mostly list this coarseness is fine (a flush just means the next read recomputes), and it eliminates the per-recipient tag fan-out, the recipient-lookup query in subscribers, and the risk of missing a recipient.

## Why (impact)

- **Hotness**: loaded on every messages page view, pagination, folder switch, and filter change. (The continuously-polled unread badge is `GET /api/messages/unread-count` — covered by FR 10.)
- **Cost**: per request: `buildBaseQuery().count` (route.ts:191-194), the page query (route.ts:197-208), `findWithDecryption(Message, …)` (route.ts:213-221, AES per row), `em.find(MessageObject)` (route.ts:228-230), two `group by` aggregations (route.ts:238-261), `findWithDecryption(User, …)` (route.ts:269-277).
- **Est. win**: a hit collapses ~6 DB round-trips + per-row decryption into one cache `get`, for repeat reads (pagination, folder re-entry, back-navigation) within the window.

## Current behavior

File: `packages/core/src/modules/messages/api/route.ts` — `resolveMessageContext(req)` (route.ts:59), `listMessagesSchema.parse` (route.ts:63), `buildBaseQuery` joins `message_recipients` against `scope.userId` (route.ts:75-189) — **the result set is per-user** (`recipient_status`, `read_at`). Response `{ items, page, pageSize, total, totalPages }` (route.ts:285-332). No cache usage anywhere in the module today.

## Proposed cache

Key = tenant (via dispatcher namespace) + user + org + folder + deterministic filter signature. Gate on `isCrudCacheEnabled()` — the tag this cache relies on is only flushed when `ENABLE_CRUD_API_CACHE` is on (see Safety).

```ts
import { buildCollectionTags, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const MESSAGES_LIST_TTL_MS = 30_000 // backstop; the crud:* flush carries correctness

// after: const input = listMessagesSchema.parse(params)
const cacheEnabled = isCrudCacheEnabled()
const cache = cacheEnabled ? (() => { try { return ctx.container.resolve('cache') } catch { return null } })() : null
const filterSignature = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
const cacheKey = `messages:list:u=${scope.userId}:org=${scope.organizationId ?? 'null'}:${filterSignature}`

if (cache) {
  const cached = await cache.get(cacheKey)
  if (cached) return Response.json(cached)
}
// ... existing query/assembly producing `payload` ...
if (cache) {
  try {
    await cache.set(cacheKey, payload, {
      ttl: MESSAGES_LIST_TTL_MS,
      tags: buildCollectionTags('messages.message', scope.tenantId, [scope.organizationId ?? null]),
    })
  } catch {}
}
return Response.json(payload)
```

(The handler runs inside the API dispatcher's `runWithCacheTenant(auth.tenantId, …)` wrapper — same namespace `invalidateCrudCache` flushes into.)

## Cache tags

- `crud:messages.message:tenant:<T>:org:<O>:collection` — **reused, already flushed** by the command bus after every message command execute/undo. Built with the shared `buildCollectionTags('messages.message', …)` helper so the shape cannot drift.

No new tags. No subscribers.

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| Compose/send (`messages.messages.compose`) | command bus `invalidateCacheAfterExecute` — existing | `crud:messages.message:…:collection` + record |
| Mark read / unread (`messages.recipients.mark_read` / `mark_unread`, resourceKind `messages.message`) | same — existing | same |
| Archive / unarchive, delete (soft), action taken, confirmations, attachments | same — existing (all log `resourceKind: 'messages.message'`) | same |
| Command undo/redo | `invalidateCacheAfterUndo` — existing | same |
| Sender profile rename (cross-module `auth` user update) | not flushed — affects only `senderName`/`senderEmail` cosmetics | 30 s TTL backstop |

**Nothing to add on the write side.**

## Safety / non-invalidation risks (double-checked)

- **Per-user leakage — the critical one:** the payload embeds the requesting user's `recipient_status`/`read_at` and folder membership. The key MUST include `scope.userId` (it does: `u=<userId>`); the org axis is also in the key. A key collision across users is impossible; assert in tests.
- **`ENABLE_CRUD_API_CACHE` gate:** the `crud:*` flush no-ops when the flag is off (`cache.ts:180`), so this cache is gated on `isCrudCacheEnabled()` — flag off ⇒ no caching ⇒ today's behavior. Never ship ungated.
- **Org-axis mismatch:** `null`-org messages are tagged/flushed under `org:null`; org-scoped under `org:<O>`. A command whose metadata resolves a different org than the read scope leaves the entry until TTL (30 s). Message commands carry `organizationId` in their identifiers; residual drift is TTL-bounded.
- **Coarse flush ⇒ lower hit rate, never staleness:** any org member's message activity flushes all members' lists. That only costs recomputes, never correctness.
- **`messages.conversation` resourceKind:** conversation-level archive/read routes log `resourceKind 'messages.message'` via the shared command helpers (`commands/shared.ts:350`); verify during implementation that no conversation command logs only `messages.conversation` — if one does, add `cacheAliases: ['messages.message']` to its metadata (one line, same mechanism as FR 06).
- **Search staleness:** cached search results won't reflect a reindex until expiry — acceptable at 30 s.
- **Key fragmentation:** many filter permutations per user; the org-collection tag flushes them all and the TTL caps memory.

## Implementation steps

- [ ] Refactor the inline `Response.json({...})` at `route.ts:285` into a `payload` object.
- [ ] Add the gated get-then-set (sketch above) with `buildCollectionTags('messages.message', scope.tenantId, [scope.organizationId ?? null])`.
- [ ] Audit conversation-level commands for resourceKind coverage (see Safety); add a `cacheAliases` line if needed.
- [ ] Unit tests: key includes user+org; tags match the command-bus flush shape; no caching when flag off.
- [ ] Integration (`packages/core/src/modules/messages/__integration__/`): send → list (cached) → mark-read → list reflects new `read_at` immediately (command-bus flush, not TTL); user A's mutation never leaks user B's entry.

## Acceptance criteria / tests

- [ ] With the flag on, two identical `GET /api/messages` calls issue the DB queries once.
- [ ] Marking a message read → subsequent list reflects the new `read_at` without waiting for TTL.
- [ ] Sending a message → all org members' next list reads recompute (coarse flush).
- [ ] User A never reads user B's cached entry; cross-tenant isolation holds.
- [ ] With the flag off, behavior is byte-identical to today.

## Labels

`feature`, `performance`, `priority-low`
