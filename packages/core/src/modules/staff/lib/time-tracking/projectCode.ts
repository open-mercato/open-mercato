export const PROJECT_CODE_MAX_LENGTH = 20

export const PROJECT_CODE_FALLBACK = 'PROJECT'

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

export function deriveProjectCode(name: string, taken: Set<string> = new Set()): string {
  const base = truncateAtWordBoundary(slugifyProjectName(name), WORD_BOUNDARY_BUDGET) || PROJECT_CODE_FALLBACK
  const reserved = new Set(Array.from(taken ?? []).map((value) => String(value).toUpperCase()))
  if (!reserved.has(base)) return base

  let candidate = base
  for (let counter = 2; counter < 10000; counter += 1) {
    const suffix = `-${counter}`
    const stem =
      truncateAtWordBoundary(base, PROJECT_CODE_MAX_LENGTH - suffix.length) || PROJECT_CODE_FALLBACK
    candidate = `${stem}${suffix}`
    if (!reserved.has(candidate)) return candidate
  }
  return candidate
}
