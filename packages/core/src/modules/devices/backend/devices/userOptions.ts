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
// bouncing the whole page to /login, and every failure degrades to an empty result instead.
async function fetchUsers(
  params: URLSearchParams,
  style: LabelStyle,
  signal?: AbortSignal,
): Promise<DeviceUserOption[]> {
  const call = await apiCall<{ items?: AuthUserItem[] }>(
    `/api/auth/users?${params.toString()}`,
    { headers: { 'x-om-forbidden-redirect': '0' }, signal },
    { fallback: null },
  ).catch(() => null)
  if (!call || !call.ok) return []
  return (call.result?.items ?? []).flatMap((item) => toOption(item, style))
}

export async function loadDeviceUserOptions(query?: string): Promise<DeviceUserOption[]> {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('pageSize', String(SEARCH_PAGE_SIZE))
  const trimmed = query?.trim()
  if (trimmed) params.set('search', trimmed)
  return fetchUsers(params, 'search')
}

// Batch id → label resolution for rows already on screen, so a device whose owner never appeared in
// a search result still renders a name instead of a bare UUID.
export async function resolveDeviceUserOptions(ids: string[], signal?: AbortSignal): Promise<DeviceUserOption[]> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (unique.length === 0) return []
  const resolved: DeviceUserOption[] = []
  for (let offset = 0; offset < unique.length; offset += MAX_IDS_PER_LOOKUP) {
    const batch = unique.slice(offset, offset + MAX_IDS_PER_LOOKUP)
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', String(batch.length))
    // URLSearchParams encodes on toString(); pre-encoding here would double-escape the commas.
    params.set('ids', batch.join(','))
    resolved.push(...(await fetchUsers(params, 'compact', signal)))
  }
  return resolved
}
