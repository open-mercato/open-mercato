import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type {
  ActionLogFieldHistoryEntry,
  ActionLogHistoryCursor,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'

export const EXPLAIN_SCAN_MAX_ENV = 'OM_INSIGHTS_EXPLAIN_SCAN_MAX'
export const EXPLAIN_SCAN_MAX_DEFAULT = 500
export const EXPLAIN_SCAN_MAX_CEILING = 5000
export const EXPLAIN_SCAN_BATCH_SIZE = 100

export function resolveExplainScanMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env[EXPLAIN_SCAN_MAX_ENV]
  if (raw === undefined || raw.trim() === '') return EXPLAIN_SCAN_MAX_DEFAULT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return EXPLAIN_SCAN_MAX_DEFAULT
  return Math.min(parsed, EXPLAIN_SCAN_MAX_CEILING)
}

export type HistoryScanParams = {
  tenantId: string
  organizationIds: string[] | null
  resourceKinds: string[]
  resourceId: string
  includeChildren: boolean
  before: ActionLogHistoryCursor | null
  scanMax: number
}

export type HistoryScanResult = {
  entries: ActionLogFieldHistoryEntry[]
  scanned: number
  truncated: boolean
  lastCursor: ActionLogHistoryCursor | null
}

type FieldHistoryReader = Pick<ActionLogService, 'findFieldHistory'>

/**
 * Reads up to `scanMax` history rows newest-first in batches of 100. The final batch
 * asks for one extra row so `truncated` is exact: it is true only when more rows exist
 * beyond the scanned window.
 */
export async function scanResourceHistory(reader: FieldHistoryReader, params: HistoryScanParams): Promise<HistoryScanResult> {
  const scanMax = Math.max(1, Math.trunc(params.scanMax))
  const entries: ActionLogFieldHistoryEntry[] = []
  let cursor: ActionLogHistoryCursor | null = params.before
  let truncated = false
  while (entries.length < scanMax) {
    const remaining = scanMax - entries.length
    const limit = remaining <= EXPLAIN_SCAN_BATCH_SIZE ? remaining + 1 : EXPLAIN_SCAN_BATCH_SIZE
    const page = await reader.findFieldHistory({
      tenantId: params.tenantId,
      organizationIds: params.organizationIds,
      resourceKinds: params.resourceKinds,
      resourceId: params.resourceId,
      includeChildren: params.includeChildren,
      before: cursor,
      limit,
    })
    if (page.entries.length > remaining) {
      entries.push(...page.entries.slice(0, remaining))
      truncated = true
      break
    }
    entries.push(...page.entries)
    if (!page.nextBefore || page.entries.length < limit) break
    cursor = page.nextBefore
  }
  const last = entries.at(-1)
  return {
    entries,
    scanned: entries.length,
    truncated,
    lastCursor: last ? { at: last.cursorAt, id: last.logId } : null,
  }
}
