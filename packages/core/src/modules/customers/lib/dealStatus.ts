import { DEFAULT_DEAL_STATUS_VOCABULARY, type DealStatusVocabulary } from '../data/dealStatusVocabulary'

export { DEFAULT_DEAL_STATUS_VOCABULARY, type DealStatusVocabulary } from '../data/dealStatusVocabulary'

export const DEAL_STATUS_WIN = 'win' as const
export const DEAL_STATUS_LOST = 'lost' as const
export const DEAL_STATUS_CLOSED = 'closed' as const

/** @deprecated Use DEAL_STATUS_LOST. Historical alias retained for compatibility until at least 0.9.0. */
export const DEAL_STATUS_LOSE = 'loose' as const

export const WON_DEAL_STATUS_LIST: readonly string[] = DEFAULT_DEAL_STATUS_VOCABULARY.won
export const LOST_DEAL_STATUS_LIST: readonly string[] = DEFAULT_DEAL_STATUS_VOCABULARY.lost
export const CLOSED_DEAL_STATUS_LIST: readonly string[] = [
  ...WON_DEAL_STATUS_LIST,
  ...LOST_DEAL_STATUS_LIST,
  ...DEFAULT_DEAL_STATUS_VOCABULARY.closed,
]

type VocabularyArgument = DealStatusVocabulary | number

function resolveVocabulary(vocabulary: VocabularyArgument): DealStatusVocabulary {
  return typeof vocabulary === 'object' && vocabulary !== null ? vocabulary : DEFAULT_DEAL_STATUS_VOCABULARY
}

const aliasCache = new WeakMap<DealStatusVocabulary, { won: readonly string[]; lost: readonly string[]; closed: readonly string[]; terminal: readonly string[] }>()

export function getDealStatusAliases(input: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY) {
  const vocabulary = resolveVocabulary(input)
  const cached = aliasCache.get(vocabulary)
  if (cached) return cached
  const won = Array.from(new Set([...vocabulary.won, ...DEFAULT_DEAL_STATUS_VOCABULARY.won]))
  const lost = Array.from(new Set([...vocabulary.lost, ...DEFAULT_DEAL_STATUS_VOCABULARY.lost]))
  const closed = Array.from(new Set([...vocabulary.closed, ...DEFAULT_DEAL_STATUS_VOCABULARY.closed]))
  const aliases = Object.freeze({ won: Object.freeze(won), lost: Object.freeze(lost), closed: Object.freeze(closed), terminal: Object.freeze([...won, ...lost, ...closed]) })
  aliasCache.set(vocabulary, aliases)
  return aliases
}

function matchesAlias(value: string | null | undefined, aliases: readonly string[]): boolean {
  return typeof value === 'string' && aliases.some((alias) => alias.trim().toLowerCase() === value.trim().toLowerCase())
}

export function isWonDealStatus(value: string | null | undefined, vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return matchesAlias(value, getDealStatusAliases(vocabulary).won)
}

export function isLostDealStatus(value: string | null | undefined, vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return matchesAlias(value, getDealStatusAliases(vocabulary).lost)
}

export function isClosedDealStatus(value: string | null | undefined, vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return matchesAlias(value, getDealStatusAliases(vocabulary).terminal)
}

export function isOpenDealStatus(value: string | null | undefined, vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return !isClosedDealStatus(value, vocabulary)
}

export function canonicalDealStatus(value: string, vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): string {
  const aliases = getDealStatusAliases(vocabulary)
  for (const outcome of ['won', 'lost', 'closed'] as const) {
    if (matchesAlias(value, aliases[outcome])) return resolveVocabulary(vocabulary)[outcome][0]!
  }
  return value.toLowerCase() === 'open' ? 'open' : value
}

export function dealStatusFilterToken(value: string, vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): string {
  if (isWonDealStatus(value, vocabulary)) return DEAL_STATUS_WIN
  if (isLostDealStatus(value, vocabulary)) return DEAL_STATUS_LOST
  if (isClosedDealStatus(value, vocabulary)) return DEAL_STATUS_CLOSED
  return value
}

export function expandDealStatusAliases(values: string[], vocabulary: VocabularyArgument = DEFAULT_DEAL_STATUS_VOCABULARY): string[] {
  const aliases = getDealStatusAliases(vocabulary)
  const expanded = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (matchesAlias(trimmed, aliases.won)) {
      aliases.won.forEach((alias) => expanded.add(alias))
    } else if (matchesAlias(trimmed, aliases.lost)) {
      aliases.lost.forEach((alias) => expanded.add(alias))
    } else if (matchesAlias(trimmed, aliases.closed)) {
      aliases.terminal.forEach((alias) => expanded.add(alias))
    } else {
      expanded.add(trimmed.toLowerCase())
    }
    expanded.add(trimmed)
  }
  return Array.from(expanded)
}
