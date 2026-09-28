import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { MAX_USER_LOOKUP_IDS } from '@open-mercato/core/modules/auth/lib/userIdFilter'

export type HrUserOption = {
  value: string
  label: string
}

type AuthUserItem = {
  id?: unknown
  name?: unknown
  email?: unknown
}

const SEARCH_PAGE_SIZE = 20

/**
 * Two label styles on purpose: a picker suggestion has to disambiguate two people with the same
 * display name and nothing between the combobox and the label can show an email, while a
 * resolved column label is read next to a request where the email is noise.
 */
type LabelStyle = 'search' | 'compact'

function toOption(item: AuthUserItem | null | undefined, style: LabelStyle): HrUserOption[] {
  if (!item || typeof item.id !== 'string' || !item.id.trim()) return []
  const id = item.id.trim()
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
  const email = typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null
  const label = style === 'search' && name && email ? `${name} — ${email}` : name ?? email ?? id
  return [{ value: id, label }]
}

// `approvals.action` does not imply `auth.users.list`, so a forbidden lookup must not bounce the
// whole page to /login (`x-om-forbidden-redirect: 0`) and must not be remembered as a permanent
// blank: `null` means the call failed, which callers retry, while `[]` means it answered nobody.
async function fetchUsers(
  params: URLSearchParams,
  style: LabelStyle,
  signal?: AbortSignal,
): Promise<HrUserOption[] | null> {
  const call = await apiCall<{ items?: AuthUserItem[] }>(
    `/api/auth/users?${params.toString()}`,
    { headers: { 'x-om-forbidden-redirect': '0' }, signal },
    { fallback: null },
  ).catch(() => null)
  if (!call || !call.ok) return null
  return (call.result?.items ?? []).flatMap((item) => toOption(item, style))
}

/** Suggestions for the reassignment picker; a failed lookup is simply an empty list. */
export async function loadHrUserOptions(query?: string): Promise<HrUserOption[]> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', String(SEARCH_PAGE_SIZE))
  const trimmed = query?.trim()
  if (trimmed) params.set('search', trimmed)
  return (await fetchUsers(params, 'search')) ?? []
}

/**
 * Roles for the step configuration's approver picker.
 *
 * A failed lookup is an empty list, like the user picker: the form then cannot offer that approver
 * type, which is honest — a step whose role does not resolve can never be decided.
 */
export async function loadHrRoleOptions(): Promise<HrUserOption[]> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', '100')
  const call = await apiCall<{ items?: Array<{ id?: unknown; name?: unknown }> }>(
    `/api/auth/roles?${params.toString()}`,
    { headers: { 'x-om-forbidden-redirect': '0' } },
    { fallback: null },
  ).catch(() => null)
  if (!call || !call.ok) return []
  return (call.result?.items ?? []).flatMap((role) => {
    if (typeof role.id !== 'string' || !role.id.trim()) return []
    const name = typeof role.name === 'string' && role.name.trim() ? role.name.trim() : role.id.trim()
    return [{ value: role.id.trim(), label: name }]
  })
}

export type HrUserLookup = {
  options: HrUserOption[]
  /** The ids the server actually answered for; callers cache on these, so a failure is retried. */
  resolvedIds: string[]
}

/**
 * Batch id → label resolution for names already on screen, so a requester who never appeared in
 * a search result still renders as a person instead of a UUID.
 */
export async function resolveHrUserLabels(ids: string[], signal?: AbortSignal): Promise<HrUserLookup> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (unique.length === 0) return { options: [], resolvedIds: [] }
  const options: HrUserOption[] = []
  const resolvedIds: string[] = []
  for (let offset = 0; offset < unique.length; offset += MAX_USER_LOOKUP_IDS) {
    const batch = unique.slice(offset, offset + MAX_USER_LOOKUP_IDS)
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', String(batch.length))
    // The route caps `?ids=` at its page size; `URLSearchParams` encodes on `toString()`.
    params.set('ids', batch.join(','))
    const batchOptions = await fetchUsers(params, 'compact', signal)
    // One failed batch must not cost the batches that did answer.
    if (batchOptions === null) continue
    options.push(...batchOptions)
    resolvedIds.push(...batch)
  }
  return { options, resolvedIds }
}

/**
 * Resolves ids already known to be missing from the cache, in one place, for the list's
 * requester column and the history dialog's actor column.
 */
export function useHrUserLabels(ids: string[]): Map<string, string> {
  const [labels, setLabels] = React.useState<Map<string, string>>(new Map())
  const resolvedRef = React.useRef<Set<string>>(new Set())
  const key = React.useMemo(() => Array.from(new Set(ids.filter(Boolean))).sort().join(','), [ids])

  React.useEffect(() => {
    if (!key) return
    const requested = key.split(',').filter((id) => id && !resolvedRef.current.has(id))
    if (requested.length === 0) return
    const controller = new AbortController()
    void (async () => {
      const lookup = await resolveHrUserLabels(requested, controller.signal)
      if (controller.signal.aborted) return
      for (const id of lookup.resolvedIds) resolvedRef.current.add(id)
      if (lookup.options.length === 0) return
      setLabels((previous) => {
        const next = new Map(previous)
        for (const option of lookup.options) next.set(option.value, option.label)
        return next
      })
    })()
    return () => controller.abort()
  }, [key])

  return labels
}
