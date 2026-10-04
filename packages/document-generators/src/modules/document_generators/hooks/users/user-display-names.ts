const MAX_USER_IDS = 100

export type UserListItem = { id?: unknown; name?: unknown; email?: unknown }

export function normalizeUserIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  const unique = new Set<string>()
  for (const id of ids) {
    const value = typeof id === 'string' ? id.trim() : ''
    if (value) unique.add(value)
  }
  return [...unique].sort().slice(0, MAX_USER_IDS)
}

export function buildUserDisplayNamesUrl(ids: string[]): string {
  const params = new URLSearchParams({ ids: ids.join(','), pageSize: String(Math.max(ids.length, 1)) })
  return `/api/auth/users?${params.toString()}`
}

export function toUserDisplayNames(items: UserListItem[]): Record<string, string> {
  const names: Record<string, string> = {}
  for (const item of items) {
    if (typeof item.id !== 'string') continue
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
    const email = typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null
    const label = name ?? email
    if (label) names[item.id] = label
  }
  return names
}
