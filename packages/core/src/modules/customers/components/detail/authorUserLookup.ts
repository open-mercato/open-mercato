"use client"

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { MAX_USER_LOOKUP_IDS } from '@open-mercato/core/modules/auth/lib/userIdFilter'

type AuthUserItem = {
  id?: unknown
  name?: unknown
  display_name?: unknown
  email?: unknown
}

// Imported rather than restated: `parseIdsParam` slices past the route's cap without complaining,
// so a client batch larger than the server accepts loses the overflow ids silently.
const MAX_IDS_PER_LOOKUP = MAX_USER_LOOKUP_IDS

/**
 * The outcome of a batch lookup. `resolvedIds` lists the ids the server actually answered for —
 * an id that came back without a row (deleted user) still counts as resolved, an id whose request
 * failed does not. Callers cache on `resolvedIds`, so a transient failure is retried rather than
 * remembered as a permanent blank.
 */
export type AuthorUserLookup = {
  names: Map<string, string>
  resolvedIds: string[]
}

function toName(item: AuthUserItem | null | undefined): [string, string] | null {
  if (!item || typeof item.id !== 'string' || !item.id.trim()) return null
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
  const displayName = typeof item.display_name === 'string' && item.display_name.trim()
    ? item.display_name.trim()
    : null
  const email = typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null
  const label = name ?? displayName ?? email
  return label ? [item.id.trim(), label] : null
}

// A viewer of a customer record does not necessarily hold `auth.users.list`, so this lookup must be
// allowed to fail: `x-om-forbidden-redirect: 0` keeps a 403 from bouncing the whole detail page to
// /login, and `null` signals that the call itself failed. Callers must not confuse that with a
// successful call that matched nobody — caching the former would remember a transient error forever.
async function fetchBatch(ids: string[], signal?: AbortSignal): Promise<AuthUserItem[] | null> {
  const params = new URLSearchParams()
  params.set('page', '1')
  // The route's pageSize defaults to 50, so a batch larger than that would be truncated by
  // pagination even after it survived the `?ids=` cap.
  params.set('pageSize', String(ids.length))
  // URLSearchParams encodes on toString(); pre-encoding here would double-escape the commas.
  params.set('ids', ids.join(','))
  const call = await apiCall<{ items?: AuthUserItem[] }>(
    `/api/auth/users?${params.toString()}`,
    { headers: { 'x-om-forbidden-redirect': '0' }, signal },
    { fallback: null },
  ).catch(() => null)
  if (!call || !call.ok) return null
  return call.result?.items ?? []
}

/**
 * Batch id → display-name resolution for activity authors already on screen, so an author whose
 * name was not denormalized onto the activity still renders a name instead of a bare UUID.
 */
export async function resolveAuthorUserNames(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<AuthorUserLookup> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  const names = new Map<string, string>()
  const resolvedIds: string[] = []
  for (let offset = 0; offset < unique.length; offset += MAX_IDS_PER_LOOKUP) {
    if (signal?.aborted) break
    const batch = unique.slice(offset, offset + MAX_IDS_PER_LOOKUP)
    const items = await fetchBatch(batch, signal)
    // One failed batch must not cost the batches that did answer, and its ids stay unresolved so
    // the next render retries them.
    if (items === null) continue
    for (const item of items) {
      const entry = toName(item)
      if (entry) names.set(entry[0], entry[1])
    }
    resolvedIds.push(...batch)
  }
  return { names, resolvedIds }
}
