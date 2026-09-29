import { slugifyProjectName } from '../time-tracking/projectCode'

/** Mirrors the `timeSlugSchema` ceiling in `data/validators.ts`. */
export const TASK_STATUS_SLUG_MAX_LENGTH = 60

export const TASK_STATUS_SLUG_FALLBACK = 'status'

/**
 * A column's slug is the stable id filters and saved views hold onto, so it is
 * derived once from the name and then frozen — renaming "W toku" to "In progress"
 * must not break a filter that was saved against it. The derivation reuses the
 * project-code transliteration so `Do przeglądu` becomes `do-przegladu` rather
 * than dropping the diacritics into nothing.
 */
export function slugifyTaskStatusName(name: string): string {
  const slug = slugifyProjectName(name).toLowerCase()
  if (slug.length <= TASK_STATUS_SLUG_MAX_LENGTH) return slug
  return slug.slice(0, TASK_STATUS_SLUG_MAX_LENGTH).replace(/-+$/g, '')
}

function withSuffix(base: string, suffix: string): string {
  const budget = TASK_STATUS_SLUG_MAX_LENGTH - suffix.length
  const stem = base.length <= budget ? base : base.slice(0, budget).replace(/-+$/g, '')
  return `${stem || TASK_STATUS_SLUG_FALLBACK}${suffix}`
}

/**
 * Derives a slug that does not collide with the ones already on the board. The
 * partial unique index is still the authority — this only keeps the common case
 * from reaching it as a constraint violation.
 */
export function deriveTaskStatusSlug(name: string, taken: Iterable<string> = []): string {
  const base = slugifyTaskStatusName(name) || TASK_STATUS_SLUG_FALLBACK
  const reserved = new Set(Array.from(taken, (value) => String(value).toLowerCase()))
  if (!reserved.has(base)) return base

  let candidate = base
  for (let counter = 2; counter < 10000; counter += 1) {
    candidate = withSuffix(base, `-${counter}`)
    if (!reserved.has(candidate)) return candidate
  }
  return candidate
}
