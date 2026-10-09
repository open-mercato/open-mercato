/**
 * Phase 2b — pure formatting helpers for the AccessAuditPanel injection widget.
 *
 * Kept dependency-free (no React, no I/O) so the row-shaping logic is unit
 * testable in isolation. The panel renders the access-audit trail returned by
 * `GET /api/forms/submissions/:submissionId/access-audit`.
 */

export type AccessAuditPurpose = 'view' | 'export' | 'revert' | 'anonymize' | 'reopen'

export type AccessAuditApiRow = {
  id: string
  accessedBy: string
  accessedAt: string
  accessPurpose: AccessAuditPurpose
  ip: string | null
  revisionId: string | null
}

export type FormattedAuditRow = {
  id: string
  actorShort: string
  purpose: AccessAuditPurpose
  purposeKey: string
  timestampMs: number | null
  ip: string | null
}

const PURPOSES: ReadonlySet<string> = new Set(['view', 'export', 'revert', 'anonymize', 'reopen'])

function shortenActor(accessedBy: string): string {
  if (typeof accessedBy !== 'string' || accessedBy.length === 0) return 'system'
  return accessedBy.length > 8 ? `${accessedBy.slice(0, 8)}…` : accessedBy
}

function parseTimestamp(value: string): number | null {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export function isAccessAuditPurpose(value: unknown): value is AccessAuditPurpose {
  return typeof value === 'string' && PURPOSES.has(value)
}

export function formatAuditRow(row: AccessAuditApiRow): FormattedAuditRow {
  const purpose: AccessAuditPurpose = isAccessAuditPurpose(row.accessPurpose) ? row.accessPurpose : 'view'
  return {
    id: row.id,
    actorShort: shortenActor(row.accessedBy),
    purpose,
    purposeKey: `forms.compliance.audit.purpose.${purpose}`,
    timestampMs: typeof row.accessedAt === 'string' ? parseTimestamp(row.accessedAt) : null,
    ip: typeof row.ip === 'string' && row.ip.length > 0 ? row.ip : null,
  }
}

export function formatAuditRows(rows: AccessAuditApiRow[]): FormattedAuditRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map(formatAuditRow)
}
