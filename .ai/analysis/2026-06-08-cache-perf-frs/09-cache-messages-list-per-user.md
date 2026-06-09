> Auto-generated cache-performance Feature Request — candidate 9 of 9
> Endpoint: `GET /api/messages` · ROI 58 · Verdict: good
> Source: `packages/core/src/modules/messages/api/route.ts`

## Summary

Add a manual, tenant-scoped, tag-invalidated cache to the custom `GET /api/messages` list handler (`packages/core/src/modules/messages/api/route.ts`). The handler is NOT a `makeCrudRoute` endpoint, so the generic CRUD list cache (`ENABLE_CRUD_API_CACHE`, `packages/shared/src/lib/crud/factory.ts`) never touches it. It runs 5-6 heavy queries per call (Kysely base + count, `findWithDecryption` on `Message`, `em.find` on `MessageObject`, two Kysely `group by` aggregations, and `findWithDecryption` on `User` for sender metadata with per-message decryption). Caching the assembled response per `(user, folder, filter-signature, page)` removes that work for repeat reads (pagination, polling, navigation) within a short TTL window.

This is rated **good**, not a strong-quick-win: the list is **per-user** (folder membership, `recipient_status`, and `read_at` all derive from `scope.userId` via the `message_recipients` join), so cache keys are user-scoped (lower cross-user reuse) and the read-state mutations (`read` / `marked_unread` / `archived`) that change the list are frequent. Reuse comes from a single user re-fetching the same folder/page and from the many filter permutations a single session repeats.

## Why (impact)

- **Hotness**: Loaded on every messages page view, and re-fetched on every pagination, folder switch, and filter change. (Note: the continuously-polled unread badge is a *separate* endpoint, `GET /api/messages/unread-count` — `packages/core/src/modules/messages/api/unread-count/route.ts` — not this list; that endpoint is the better polling-cache candidate and should be a sibling FR.)
- **Cost**: Per request the handler issues: `buildBaseQuery().count` (route.ts:191-194), `buildBaseQuery()` scope page query (route.ts:197-208), `findWithDecryption(Message, …)` (route.ts:213-221, AES decryption per row), `em.find(MessageObject, …)` (route.ts:228-230), attachment-count `group by` (route.ts:238-246), recipient-count `group by` (route.ts:253-261), and `findWithDecryption(User, …)` for sender metadata (route.ts:269-277). The base query is built and executed twice (count + page).
- **Est. win**: A cache hit collapses all of the above to a single `cache.get`, eliminating ~6 DB round-trips and the per-row decryption loop. Effective on repeated same-key reads within the TTL; sharply reduced by the per-user key space.

## Current behavior

File: `packages/core/src/modules/messages/api/route.ts`

- `GET` resolves scope via `resolveMessageContext(req)` (route.ts:59) → `{ tenantId, organizationId, userId }` from `ctx.auth` (`lib/routeHelpers.ts`).
- Input parsed by `listMessagesSchema.parse(params)` (route.ts:63): `folder` (`inbox|archived|sent|drafts|all`), `status`, `type`, `visibility`, `sourceEntityType`, `sourceEntityId`, `externalEmail`, `senderId`, `search`, `since`, `hasObjects`, `hasAttachments`, `hasActions`, `page`, `pageSize`.
- `buildBaseQuery` (route.ts:75-189) joins `message_recipients` against `scope.userId` for folder semantics — **the result set is user-specific**, and `recipient_status` / `read_at` columns (route.ts:201-204, 311, 323) are per-user.
- Response (route.ts:285-332) returns `{ items, page, pageSize, total, totalPages }`.
- No `makeCrudRoute`, no existing cache usage anywhere in the module (`grep` for `resolve('cache')` / `deleteByTags` / `runWithCacheTenant` under `packages/core/src/modules/messages` returns nothing).

## Proposed cache

Cache the full JSON response keyed by tenant + user + folder + a deterministic signature of all filter/pagination inputs. Scope every read/write with `runWithCacheTenant(scope.tenantId, …)` so keys/tags are tenant-namespaced and one tenant can never read another's entry.

```ts
import { runWithCacheTenant } from '@open-mercato/cache'

const MESSAGES_LIST_TAG = 'messages:list'
const MESSAGES_LIST_TTL_MS = 30_000 // 30s backstop; invalidation is the primary mechanism

// after: const input = listMessagesSchema.parse(params)
const cache = ctx.container.resolve('cache') as {
  get(key: string): Promise<unknown>
  set(key: string, val: unknown, opts?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

// Deterministic signature: sort keys so param order never changes the key.
const filterSignature = JSON.stringify(
  Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))
)
const cacheKey = `messages:list:u=${scope.userId}:org=${scope.organizationId ?? 'null'}:f=${input.folder}:${filterSignature}`

const userListTag = `messages:list:user:${scope.userId}`

const response = await runWithCacheTenant(scope.tenantId, async () => {
  const cached = await cache.get(cacheKey)
  if (cached) return cached as Record<string, unknown>

  // ... existing query/assembly producing `payload` (items/page/pageSize/total/totalPages) ...

  await cache.set(cacheKey, payload, {
    ttl: MESSAGES_LIST_TTL_MS,
    tags: [MESSAGES_LIST_TAG, userListTag],
  })
  return payload
})

return Response.json(response)
```

Note the existing handler already returns inline via `Response.json({...})` (route.ts:285); refactor that object into a `payload` const so it can be cached and returned on both miss and hit.

## Cache tags

- `messages:list` — coarse tag on every cached list entry across all users in the tenant. Lets a tenant-wide blunt invalidation (rare; safety hatch) flush all message lists.
- `messages:list:user:<userId>` — per-user tag. Every mutation that changes *this* user's view (a message sent to them, their read/unread/archive state change, a soft-delete affecting their recipient row) invalidates `messages:list:user:<recipientUserId>`. This is the primary invalidation tag and keeps blast radius to the affected user.

(Tenant namespacing is applied automatically by `runWithCacheTenant`, so these literal strings are safe to reuse across tenants.)

## Invalidation

Invalidation must fire **post-commit** (outside `withAtomicFlush`). The cleanest hook is an ephemeral cache-invalidation subscriber (`persistent: false`, per `packages/core/AGENTS.md` → Event Subscribers, which lists cache invalidation as the canonical ephemeral use). All the relevant events are already declared in `packages/core/src/modules/messages/events.ts` with `clientBroadcast: true`. A new subscriber `subscribers/messages-list-cache-invalidate.ts` should resolve `cache` from the container and call `deleteByTags` for the affected user(s). Because the list is per-recipient, the subscriber must invalidate `messages:list:user:<userId>` for **every recipient** of the message (resolve recipient user ids from `message_recipients`), plus the sender for `sent`/`drafts` folders.

| Trigger (route/command/event) | Where to call deleteByTags | Tags invalidated |
|---|---|---|
| Compose/send — command `messages.messages.compose` (route.ts:354) emits `messages.message.sent` | subscriber on `messages.message.sent` (post-commit, ephemeral) | `messages:list:user:<senderUserId>` + `messages:list:user:<each recipientUserId>` |
| Mark read — command `messages.recipients.mark_read` (`api/[id]/read/route.ts:59`) emits `messages.message.read` | subscriber on `messages.message.read` | `messages:list:user:<recipientUserId>` |
| Mark unread — command `messages.recipients.mark_unread` (`api/[id]/read/route.ts:89`) emits `messages.message.marked_unread` | subscriber on `messages.message.marked_unread` | `messages:list:user:<recipientUserId>` |
| Archive — `api/[id]/archive` + `api/[id]/conversation/archive` emit `messages.message.archived` / `messages.message.unarchived` | subscriber on `messages.message.archived` / `messages.message.unarchived` | `messages:list:user:<recipientUserId>` |
| Delete (soft) — emits `messages.message.deleted` | subscriber on `messages.message.deleted` | `messages:list:user:<senderUserId>` + `messages:list:user:<each recipientUserId>` |
| Action taken — emits `messages.message.action_taken` (changes `hasActions`/`actionTaken` in the row) | subscriber on `messages.message.action_taken` | `messages:list:user:<each recipientUserId>` + `messages:list:user:<senderUserId>` |
| Sender profile rename (cross-module) — `auth` user update changing `name`/`email` (affects `senderName`/`senderEmail`, route.ts:294-299) | accept short staleness (TTL backstop). Optional: subscriber on the auth user-updated event flushing `messages:list` tenant-wide. Recommend NOT wiring initially — rare event, covered by 30s TTL. | (optional) `messages:list` |

If the per-event payloads do not already carry the full recipient user-id list, the subscriber must look them up from `message_recipients` (where `deleted_at is null`) for the message id — keep that query lean and tenant/org scoped.

## Implementation steps

- [ ] Refactor the inline `Response.json({...})` at `route.ts:285` into a `payload` object so it can be both cached and returned.
- [ ] In `GET`, after `listMessagesSchema.parse`, resolve `cache` from `ctx.container`, build the deterministic `filterSignature` + `cacheKey`, and wrap the read/compute/set in `runWithCacheTenant(scope.tenantId, …)`. Set `{ ttl: 30_000, tags: ['messages:list', 'messages:list:user:'+scope.userId] }`.
- [ ] Guard the whole cache behind an env flag (e.g. `ENABLE_MESSAGES_LIST_CACHE`, default off) so it can ship dark and be enabled per-tenant/per-env, mirroring the `ENABLE_CRUD_API_CACHE` gating convention.
- [ ] Add `subscribers/messages-list-cache-invalidate.ts` with `metadata = { event: 'messages.message.sent', persistent: false, id: 'messages-list-cache-invalidate-sent' }` (one subscriber per event, or a small shared helper invoked from several subscriber files). Resolve recipient user ids from `message_recipients` when not present in the payload; call `runWithCacheTenant(tenantId, () => cache.deleteByTags([...userTags]))`.
- [ ] Wire subscribers for `messages.message.read`, `messages.message.marked_unread`, `messages.message.archived`, `messages.message.unarchived`, `messages.message.deleted`, `messages.message.action_taken`.
- [ ] Run `yarn generate` so the new subscribers are discovered.
- [ ] Confirm invalidation fires post-commit only (subscribers run after the command's domain write — verify none of the emitting commands emit inside `withAtomicFlush`).
- [ ] Add unit tests: cache miss populates with correct tags; cache hit skips DB; each event subscriber calls `deleteByTags` with the right user tag(s).
- [ ] Add an integration test (`packages/core/src/modules/messages/__integration__/`): send → list (cached) → mark-read → list reflects new `read_at` (proves invalidation), and verify user A's mutation never invalidates/leaks user B's entry.

## Risks & staleness window

- **Per-user correctness is critical**: the list embeds `recipient_status` and `read_at` for the requesting user. The cache key MUST include `scope.userId`; a key collision across users would leak another user's read-state and folder membership. Tenant namespacing via `runWithCacheTenant` plus the explicit `u=<userId>` key segment prevents this — assert it in tests.
- **Staleness window**: bounded by the 30s TTL even if a tag invalidation is missed (best-effort). For a message list (non-financial, read-mostly) a sub-30s convergence window is acceptable; a freshly-read message could briefly still show as unread on a stale hit.
- **Invalidation breadth**: read/unread/archive happen often and each invalidates a user tag — under heavy interaction the hit rate for that user drops, which is why ROI is rated `good` not `strong`. The cache still wins on pagination, folder re-entry, and back-navigation between mutations.
- **Key fragmentation**: many filter/search permutations create many keys; the per-user `messages:list:user:<id>` tag still flushes all of them together, so correctness holds, but memory footprint per active user can grow — the 30s TTL caps it.
- **Search results** (`input.search`) depend on the search index (`findMessageIdsBySearchTokens`); caching them is fine within the TTL but they will not reflect a reindex until expiry — acceptable.

## Acceptance criteria / tests

- [ ] With the flag on, two identical `GET /api/messages` calls for the same user/folder/filters issue the DB queries once; the second is served from cache (assert via spy/profiler).
- [ ] Marking a message read invalidates `messages:list:user:<recipientUserId>` and a subsequent list reflects the new `read_at`/`status` within the same request (no TTL wait).
- [ ] Sending a message invalidates the sender's and every recipient's `messages:list:user:*` tag.
- [ ] User A's read/archive/send never invalidates user B's cached list and never exposes A's `read_at` to B.
- [ ] Cross-tenant isolation: identical keys in two tenants resolve to distinct entries (TTL/tag flush in one tenant does not affect the other).
- [ ] With the flag off, behavior is byte-identical to today.

## Labels

`feature`, `performance`, `priority-low`

