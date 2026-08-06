// TEMPORARY mutation-gate probe — reverted in the commit that follows.
// Touching an in-scope file is the only way to make the diff-scoped `mutate` job
// execute on this PR, which is the end-to-end runner evidence PR review asked for.
// Deliberately comment-only: it adds no mutants, so the reported score must
// reproduce the Phase 0 pilot's 93.33% for src/lib/boolean.ts exactly. A different
// number means the runner path, not the source, changed.
export const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'])
export const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disable', 'disabled'])

export function parseBooleanToken(raw: string | null | undefined): boolean | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return null
}

export function parseBooleanWithDefault(raw: string | null | undefined, fallback: boolean): boolean {
  const parsed = parseBooleanToken(raw)
  return parsed === null ? fallback : parsed
}

export function parseBooleanFlag(raw?: string): boolean | undefined {
  const parsed = parseBooleanToken(raw)
  return parsed === null ? undefined : parsed
}

export function parseBooleanFromUnknown(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return parseBooleanToken(value)
  return null
}
