export function normalizePipelineStageLabel(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : ''
}

const TERMINAL_OUTCOME_LABELS = new Set([
  'won',
  'win',
  'closed won',
  'closed win',
  'lost',
  'loose',
  'closed lost',
  'closed loose',
  'stalled',
  'stale',
  'closed stalled',
  'closed stale',
])

export function isTerminalPipelineOutcomeLabel(value: string | null | undefined): boolean {
  const normalized = normalizePipelineStageLabel(value)
  return normalized.length > 0 && TERMINAL_OUTCOME_LABELS.has(normalized)
}
