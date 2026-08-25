import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type DeviceUserOption = {
  value: string
  label: string
  description?: string | null
}

type AuthUserItem = {
  id?: unknown
  name?: unknown
  email?: unknown
}

// `/api/auth/users` caps `pageSize` at 100 and `?ids=` at the shared MAX_IDS_PER_REQUEST.
const SEARCH_PAGE_SIZE = 20
const MAX_IDS_PER_LOOKUP = 100

/**
 * Two label styles on purpose. A picker suggestion has to disambiguate two people with the same
 * display name, and `CrudForm`'s combobox drops the option description — so the email has to live in
 * the label there. A resolved column label is read next to a device, where the email is noise.
 */
type LabelStyle = 'search' | 'compact'

function toOption(item: AuthUserItem | null | undefined, style: LabelStyle): DeviceUserOption[] {
  if (!item || typeof item.id !== 'string' || !item.id.trim()) return []
  const id = item.id.trim()
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
  const email = typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null
  const label = style === 'search' && name && email ? `${name} — ${email}` : name ?? email ?? id
  return [{ value: id, label, description: email && email !== label ? email : null }]
}

// Devices admins may not hold `auth.users.list`; `x-om-forbidden-redirect: 0` keeps a 403 from
// bouncing the whole page to /login. `null` means the call itself failed, which callers must not
// confuse with a successful call that matched nobody — a caller caching "already resolved" would
// otherwise remember a transient network error forever.
async function fetchUsers(
  params: URLSearchParams,
  style: LabelStyle,
  signal?: AbortSignal,
): Promise<DeviceUserOption[] | null> {
  const call = await apiCall<{ items?: AuthUserItem[] }>(
    `/api/auth/users?${params.toString()}`,
    { headers: { 'x-om-forbidden-redirect': '0' }, signal },
    { fallback: null },
  ).catch(() => null)
  if (!call || !call.ok) return null
  return (call.result?.items ?? []).flatMap((item) => toOption(item, style))
}

export async function loadDeviceUserOptions(query?: string): Promise<DeviceUserOption[]> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', String(SEARCH_PAGE_SIZE))
  const trimmed = query?.trim()
  if (trimmed) params.set('search', trimmed)
  // A picker has nothing to cache, so a failed lookup is just an empty suggestion list.
  return (await fetchUsers(params, 'search')) ?? []
}

/**
 * The outcome of a batch lookup. `resolvedIds` lists the ids the server actually answered for —
 * an id that came back without a row (deleted user) still counts as resolved, an id whose request
 * failed does not. Callers cache on `resolvedIds`, so a transient failure is retried rather than
 * remembered as a permanent blank.
 */
export type DeviceUserLookup = {
  options: DeviceUserOption[]
  resolvedIds: string[]
}

// Batch id → label resolution for rows already on screen, so a device whose owner never appeared in
// a search result still renders a name instead of a bare UUID.
export async function resolveDeviceUserOptions(ids: string[], signal?: AbortSignal): Promise<DeviceUserLookup> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (unique.length === 0) return { options: [], resolvedIds: [] }
  const options: DeviceUserOption[] = []
  const resolvedIds: string[] = []
  for (let offset = 0; offset < unique.length; offset += MAX_IDS_PER_LOOKUP) {
    const batch = unique.slice(offset, offset + MAX_IDS_PER_LOOKUP)
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', String(batch.length))
    // URLSearchParams encodes on toString(); pre-encoding here would double-escape the commas.
    params.set('ids', batch.join(','))
    const batchOptions = await fetchUsers(params, 'compact', signal)
    // One failed batch must not cost the batches that did answer.
    if (batchOptions === null) continue
    options.push(...batchOptions)
    resolvedIds.push(...batch)
  }
  return { options, resolvedIds }
}
