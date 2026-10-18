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

export function getDealStatusAliases(vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY) {
  const won = Array.from(new Set([...vocabulary.won, ...DEFAULT_DEAL_STATUS_VOCABULARY.won]))
  const lost = Array.from(new Set([...vocabulary.lost, ...DEFAULT_DEAL_STATUS_VOCABULARY.lost]))
  const closed = Array.from(new Set([...vocabulary.closed, ...DEFAULT_DEAL_STATUS_VOCABULARY.closed]))
  return { won, lost, closed, terminal: [...won, ...lost, ...closed] }
}

function matchesAlias(value: string | null | undefined, aliases: string[]): boolean {
  return typeof value === 'string' && aliases.some((alias) => alias.toLowerCase() === value.trim().toLowerCase())
}

export function isWonDealStatus(value: string | null | undefined, vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return value != null && getDealStatusAliases(vocabulary).won.includes(value)
}

export function isLostDealStatus(value: string | null | undefined, vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return value != null && getDealStatusAliases(vocabulary).lost.includes(value)
}

export function isClosedDealStatus(value: string | null | undefined, vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return value != null && getDealStatusAliases(vocabulary).terminal.includes(value)
}

export function isOpenDealStatus(value: string | null | undefined, vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY): boolean {
  return !isClosedDealStatus(value, vocabulary)
}

export function canonicalDealStatus(value: string, vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY): string {
  const aliases = getDealStatusAliases(vocabulary)
  for (const outcome of ['won', 'lost', 'closed'] as const) {
    if (matchesAlias(value, aliases[outcome])) return vocabulary[outcome][0]!
  }
  return value.toLowerCase() === 'open' ? 'open' : value
}

export function expandDealStatusAliases(values: string[], vocabulary: DealStatusVocabulary = DEFAULT_DEAL_STATUS_VOCABULARY): string[] {
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
