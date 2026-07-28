/**
 * Work Inbox — the `workInboxService` DI implementation (BC §9: new DI keys are
 * free to add).
 *
 * It merges every registered source into one queue. A source that throws is
 * logged and contributes nothing rather than failing the whole inbox: one
 * module's outage must not hide another module's work — the same fail-soft
 * stance the response-enricher registry takes.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  selectWorkInboxSources,
  sortWorkInboxRows,
} from './provider'
import type {
  WorkInboxQuery,
  WorkInboxRow,
  WorkInboxSourceContext,
} from './provider'

const logger = createLogger('workflows')

export type WorkInboxListResult = {
  rows: WorkInboxRow[]
  total: number
  /** Kinds that actually answered — the UI offers exactly these as filters. */
  kinds: string[]
  /** Kinds whose provider failed, so the caller can say the view is partial. */
  degradedKinds: string[]
}

/**
 * Merge, sort, then page.
 *
 * Each source is asked for `offset + limit` rows and reports its own true
 * total; the merged window is ordered with the canonical comparator and sliced.
 * With one source that is exactly a normal page. With several it is the honest
 * phase-1 read-model behavior — a cross-source ordered index needs the `Task`
 * entity that resolved question #1 defers.
 */
export async function listWorkInbox(
  query: WorkInboxQuery,
  context: WorkInboxSourceContext,
): Promise<WorkInboxListResult> {
  const entries = selectWorkInboxSources(query)

  const collected: WorkInboxRow[] = []
  const kinds: string[] = []
  const degradedKinds: string[] = []
  let total = 0

  for (const entry of entries) {
    try {
      const result = await entry.provider.list(query, context)
      collected.push(...result.rows)
      total += result.total
      kinds.push(entry.provider.kind)
    } catch (error) {
      degradedKinds.push(entry.provider.kind)
      logger.error('Work inbox source failed', {
        component: 'work-inbox',
        moduleId: entry.moduleId,
        kind: entry.provider.kind,
        err: error,
      })
    }
  }

  const ordered = sortWorkInboxRows(collected)

  return {
    rows: ordered.slice(query.offset, query.offset + query.limit),
    total,
    kinds,
    degradedKinds,
  }
}

/**
 * Claimable candidates for the caller, in inbox order — the queue the
 * claim-next affordance walks. Deliberately a read: the actual claim is a
 * compare-and-set inside `taskHandler`, so a candidate list that is already
 * stale by the time it is used is expected and safe.
 */
export async function listClaimableWorkInbox(
  query: WorkInboxQuery,
  context: WorkInboxSourceContext,
): Promise<WorkInboxRow[]> {
  const result = await listWorkInbox(query, context)
  return result.rows.filter(
    (row) =>
      row.status === 'PENDING' &&
      !row.assignedTo &&
      !row.claimedBy &&
      Array.isArray(row.assignedToRoles) &&
      row.assignedToRoles.length > 0,
  )
}

export type WorkInboxService = {
  listWorkInbox: typeof listWorkInbox
  listClaimableWorkInbox: typeof listClaimableWorkInbox
}
