export const PROJECT_COLORS = [
  { key: 'blue', hex: '#3B82F6' },
  { key: 'green', hex: '#22C55E' },
  { key: 'purple', hex: '#A855F7' },
  { key: 'red', hex: '#EF4444' },
  { key: 'orange', hex: '#F97316' },
  { key: 'yellow', hex: '#EAB308' },
  { key: 'pink', hex: '#EC4899' },
  { key: 'teal', hex: '#14B8A6' },
  { key: 'indigo', hex: '#6366F1' },
  { key: 'cyan', hex: '#06B6D4' },
  { key: 'emerald', hex: '#10B981' },
  { key: 'slate', hex: '#64748B' },
] as const

export type ProjectColorKey = typeof PROJECT_COLORS[number]['key']

export const PROJECT_COLOR_KEYS: ProjectColorKey[] = PROJECT_COLORS.map((c) => c.key)

const COLOR_BY_KEY = new Map<string, string>(PROJECT_COLORS.map((c) => [c.key, c.hex]))

export function isProjectColorKey(value: unknown): value is ProjectColorKey {
  return typeof value === 'string' && COLOR_BY_KEY.has(value)
}

/**
 * Stable, non-cryptographic string hash (djb2). Positive integer output.
 * Used to derive a deterministic fallback color from a project's name.
 */
function hashString(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Returns a stable color for a project based on its name when no explicit
 * color is set. Same name → same color across reloads and devices.
 */
export function autoColorFromName(name: string | null | undefined): { key: ProjectColorKey; hex: string } {
  const safe = (name ?? '').trim().toLowerCase()
  const index = safe.length === 0 ? 0 : hashString(safe) % PROJECT_COLORS.length
  return PROJECT_COLORS[index]
}

/**
 * Resolve the hex for a project, preferring the explicit color key when
 * valid and falling back to the deterministic name-based palette otherwise.
 */
export function resolveProjectColorHex(
  explicitKey: string | null | undefined,
  name: string | null | undefined,
): string {
  if (isProjectColorKey(explicitKey)) return COLOR_BY_KEY.get(explicitKey)!
  return autoColorFromName(name).hex
}
