import { getDealStatusAliases, type DealStatusVocabulary } from '../../lib/dealStatus'

export function normalizePipelineStageLabel(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
    : ''
}

const TERMINAL_OUTCOME_LABELS = new Set([
  'won',
  'win',
  'closed won',
  'closed win',
  'lost',
  // Pre-0.7.1 misspelling; unmigrated stage labels still carry it.
  'loose',
  'closed lost',
  'closed loose',
  'stalled',
  'stale',
  'closed stalled',
  'closed stale',
])

export function isTerminalPipelineOutcomeLabel(value: string | null | undefined, vocabulary?: DealStatusVocabulary): boolean {
  const normalized = normalizePipelineStageLabel(value)
  return normalized.length > 0 && (TERMINAL_OUTCOME_LABELS.has(normalized)
    || getDealStatusAliases(vocabulary).terminal.some((alias) => normalizePipelineStageLabel(alias) === normalized))
}
