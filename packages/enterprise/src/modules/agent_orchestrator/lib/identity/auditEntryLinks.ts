import { PROPOSAL_CORRELATION_KEY, RUN_CORRELATION_KEY } from './runActionCorrelation'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AuditEntryCorrelation = {
  agentRunId: string | null
  proposalId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readId(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null
}

/**
 * Reads the run and proposal ids stamped on an audit_logs action row (`context.correlation`,
 * written by the command bus from `auditCorrelation`). Non-UUID values are ignored so a
 * malformed or foreign correlation never becomes a navigation target.
 */
export function readAuditEntryCorrelation(row: unknown): AuditEntryCorrelation {
  const context = isRecord(row) ? row.context : undefined
  const correlation = isRecord(context) ? context.correlation : undefined
  if (!isRecord(correlation)) return { agentRunId: null, proposalId: null }
  return {
    agentRunId: readId(correlation, RUN_CORRELATION_KEY),
    proposalId: readId(correlation, PROPOSAL_CORRELATION_KEY),
  }
}

export function buildRunTraceHref(runId: string): string {
  return `/backend/traces/${encodeURIComponent(runId)}`
}

export function buildProposalHref(proposalId: string): string {
  return `/backend/caseload/${encodeURIComponent(proposalId)}`
}

export function buildAuditEntryHref(actionLogId: string): string {
  return `/backend/audit-logs?logId=${encodeURIComponent(actionLogId)}`
}
