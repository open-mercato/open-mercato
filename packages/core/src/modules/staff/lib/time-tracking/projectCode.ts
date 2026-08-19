export const PROJECT_CODE_MAX_LENGTH = 20

/**
 * The length a derived code aims for. Task references quote it on every card,
 * drawer title and picker row (`ADS-21`), so a code that reads like a sentence
 * makes the reference unusable as the thing people say to each other.
 *
 * It is a target, not a ceiling: a collision extends the code rather than
 * mangling it, and a hand-typed code is still allowed up to
 * `PROJECT_CODE_MAX_LENGTH`, because the person naming a project knows better
 * than the transliterator does.
 */
export const PROJECT_CODE_TARGET_LENGTH = 3

export const PROJECT_CODE_FALLBACK = 'PRJ'

const WORD_BOUNDARY_BUDGET = PROJECT_CODE_MAX_LENGTH - 1

const COMBINING_MARK_START = 0x300
const COMBINING_MARK_END = 0x36f
const ASCII_END = 0x7f

const SPECIAL_CHARACTERS: Record<string, string> = {
  'ł': 'l',
  'Ł': 'L',
  'đ': 'd',
  'Đ': 'D',
  'ð': 'd',
  'Ð': 'D',
  'ø': 'o',
  'Ø': 'O',
  'æ': 'ae',
  'Æ': 'AE',
  'œ': 'oe',
  'Œ': 'OE',
  'ß': 'ss',
  'þ': 'th',
  'Þ': 'TH',
}

function transliterate(value: string): string {
  let result = ''
  for (const character of value.normalize('NFD')) {
    const code = character.codePointAt(0) ?? 0
    if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) continue
    if (code <= ASCII_END) {
      result += character
      continue
    }
    result += SPECIAL_CHARACTERS[character] ?? character
  }
  return result
}

export function slugifyProjectName(name: string): string {
  return transliterate(typeof name === 'string' ? name : '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function truncateAtWordBoundary(slug: string, budget: number): string {
  if (budget <= 0) return ''
  if (slug.length <= budget) return slug
  let result = ''
  for (const word of slug.split('-')) {
    const next = result ? `${result}-${word}` : word
    if (next.length > budget) break
    result = next
  }
  if (!result) result = slug.slice(0, budget)
  return result.replace(/-+$/g, '')
}

/**
 * The three letters a name reduces to.
 *
 * A multi-word name gives its initials — `Ergo Hestia Korpo` reads as `EHK`,
 * which a person recognises, where the first three characters (`ERG`) do not.
 * A single word gives its first three letters, so `Apollo` is `APO` and a name
 * already at or under three characters (`HBH`) is left exactly as it is.
 */
export function deriveProjectCodeBase(name: string): string {
  const slug = slugifyProjectName(name)
  if (!slug) return PROJECT_CODE_FALLBACK
  const words = slug.split('-').filter((word) => word.length > 0)
  if (words.length === 0) return PROJECT_CODE_FALLBACK

  const initials = words.map((word) => word[0]).join('')
  const base = words.length >= PROJECT_CODE_TARGET_LENGTH
    ? initials.slice(0, PROJECT_CODE_TARGET_LENGTH)
    : words.join('').slice(0, PROJECT_CODE_TARGET_LENGTH)

  return base || PROJECT_CODE_FALLBACK
}

/**
 * Three letters is roughly 17,500 combinations and derived codes cluster hard —
 * `Apollo`, `Aponia` and `Apex` all want `APO` — so a collision is the normal
 * case rather than the exception, and the rule for resolving one has to be
 * boring and predictable. The counter extends the code (`APO` → `APO2`) instead
 * of substituting a letter, because a fourth character is still readable while
 * `APQ` is a different project as far as anybody reading it is concerned.
 */
export function deriveProjectCode(name: string, taken: Set<string> = new Set()): string {
  const base = deriveProjectCodeBase(name)
  const reserved = new Set(Array.from(taken ?? []).map((value) => String(value).toUpperCase()))
  if (!reserved.has(base)) return base

  for (let counter = 2; counter < 10000; counter += 1) {
    const candidate = `${base}${counter}`
    if (candidate.length > PROJECT_CODE_MAX_LENGTH) break
    if (!reserved.has(candidate)) return candidate
  }

  // Every short candidate is taken. Fall back to the long form rather than
  // failing the save — a save that refuses to happen is worse than a long code.
  const longBase =
    truncateAtWordBoundary(slugifyProjectName(name), WORD_BOUNDARY_BUDGET) || PROJECT_CODE_FALLBACK
  if (!reserved.has(longBase)) return longBase
  for (let counter = 2; counter < 10000; counter += 1) {
    const suffix = `-${counter}`
    const stem =
      truncateAtWordBoundary(longBase, PROJECT_CODE_MAX_LENGTH - suffix.length) || PROJECT_CODE_FALLBACK
    const candidate = `${stem}${suffix}`
    if (!reserved.has(candidate)) return candidate
  }
  return longBase
}
