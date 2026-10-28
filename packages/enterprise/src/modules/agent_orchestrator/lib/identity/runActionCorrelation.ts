export const RUN_ACTIONS_MAX_PAGE_SIZE = 100

export const RUN_CORRELATION_KEY = 'agentRunId'
export const PROPOSAL_CORRELATION_KEY = 'proposalId'

export function buildRunActionCorrelationKeys(runId: string, proposalIds: readonly string[]): string[] {
  const keys = [`${RUN_CORRELATION_KEY}:${runId}`]
  for (const proposalId of proposalIds) {
    const key = `${PROPOSAL_CORRELATION_KEY}:${proposalId}`
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

export function parseCorrelationKeys(keys: readonly string[] | null | undefined): Record<string, string> {
  const correlation: Record<string, string> = {}
  for (const entry of keys ?? []) {
    if (typeof entry !== 'string') continue
    const separator = entry.indexOf(':')
    if (separator <= 0 || separator === entry.length - 1) continue
    const key = entry.slice(0, separator)
    if (!(key in correlation)) correlation[key] = entry.slice(separator + 1)
  }
  return correlation
}

export function readCorrelationValue(keys: readonly string[] | null | undefined, key: string): string | null {
  return parseCorrelationKeys(keys)[key] ?? null
}
