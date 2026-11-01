import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AssistedSellingThread } from '../data/entities'
import { resolveEffectiveAssistedSellingSettings } from './settings'
import { eraseAssistedSellingThread } from './retention'
import { emitAssistedSellingEvent } from '../events'

const logger = createLogger('assisted_selling')

// Step 6.1 (§5.10, S7 gap-fill). Step 4.5 shipped the three EVENT-DRIVEN erasure triggers
// (`lib/erasureSubscribers.ts`) and explicitly deferred the two TIME-based sweepers this
// file adds — but §5.10's own text is unconditional: "Release 5 ships all of §5.10 together
// with the first route that stores text about a buyer (S7): the staff message route of
// Phase 1 and the buyer routes of Phase 2 item 1 do not ship without the two sweepers and
// the three erasure subscribers." Both routes already shipped (Steps 4.1/4.5), so this Step
// closes the gap rather than accepting it — the three-triggers-only state was never a
// compliant end state, only an intermediate one.
//
// `idle_close_days`/`conversation_retention_days` are PER-STORE settings
// (`AssistedSellingStoreSettings`), so neither sweep can push a single threshold into one
// `WHERE` clause across a whole organization — each walks the DISTINCT `storeId`s it has
// open/closed threads for, resolves that store's own effective window once
// (`resolveEffectiveAssistedSellingSettings`, same default-on-missing-row behavior the
// settings route already uses), and only then pages through that store's threads with the
// resulting threshold. Organization-scoped, same granularity
// `customer_groups`'s sibling `credit-exposure-audit` schedule already uses (`setup.ts`),
// since both the thread rows and the settings row they join against are organization-scoped.

export type AssistedSellingSweepScope = { tenantId: string; organizationId: string }

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 200
// Defensive circuit breaker, mirrors `customer_groups/lib/expireApprovals.ts`'s own
// `MAX_PAGES_PER_TICK`: one tick must never loop forever against a pathological backlog.
const MAX_PAGES_PER_TICK = 1000

export type SweepIdleThreadsResult = { closedCount: number }
export type SweepRetentionResult = { erasedCount: number }

async function distinctStoreIds(
  em: EntityManager,
  scope: AssistedSellingSweepScope,
  status: 'open' | 'closed',
): Promise<string[]> {
  const rows = await em.find(
    AssistedSellingThread,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, status, deletedAt: null },
    { fields: ['storeId'] },
  )
  return Array.from(new Set(rows.map((row) => row.storeId)))
}

/**
 * §5.10's idle sweeper ("An open thread with `last_activity_at` older than the store's
 * `idle_close_days` is closed by the idle sweeper, which starts its retention clock"). CAS
 * per row (`status = 'open'` in the `WHERE`), same race-safety `expirePendingApprovals`
 * already establishes — a buyer/rep message landing between this sweep's own `find` and its
 * `nativeUpdate` bumps `lastActivityAt` and loses the `WHERE` match, so an active thread is
 * never closed out from under a live conversation. Emits `assisted_selling.thread.closed`
 * (§6.8) for every thread THIS call actually transitions.
 */
export async function sweepIdleThreads(
  em: EntityManager,
  scope: AssistedSellingSweepScope,
  now: Date = new Date(),
): Promise<SweepIdleThreadsResult> {
  let closedCount = 0
  const storeIds = await distinctStoreIds(em, scope, 'open')

  for (const storeId of storeIds) {
    const settings = await resolveEffectiveAssistedSellingSettings(em, { ...scope, storeId })
    const threshold = new Date(now.getTime() - settings.idleCloseDays * DAY_MS)

    for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
      const candidates = await em.find(
        AssistedSellingThread,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          storeId,
          status: 'open',
          deletedAt: null,
          lastActivityAt: { $lte: threshold },
        },
        { limit: PAGE_SIZE, orderBy: { id: 'asc' } },
      )
      if (candidates.length === 0) break

      for (const candidate of candidates) {
        const affected = await em.nativeUpdate(
          AssistedSellingThread,
          { id: candidate.id, tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'open' },
          { status: 'closed', closedAt: now, updatedAt: now },
        )
        // A message/join/leave landed between the `find` above and this `nativeUpdate` and
        // bumped `lastActivityAt` (or another tick already closed it) — the row no longer
        // matches `status = 'open'`. Skipped, never reported as an error.
        if (affected === 0) continue

        closedCount += 1
        try {
          await emitAssistedSellingEvent(
            'assisted_selling.thread.closed',
            {
              threadId: candidate.id,
              tenantId: candidate.tenantId,
              organizationId: candidate.organizationId,
              reason: 'idle',
            },
          )
        } catch (error) {
          logger.warn('[assisted_selling:idle-close] failed to emit thread.closed', {
            threadId: candidate.id,
            error: error instanceof Error ? error.message : error,
          })
        }
      }

      if (candidates.length < PAGE_SIZE) break
    }
  }

  return { closedCount }
}

/**
 * §5.10's retention sweeper ("A closed thread with `closed_at` older than
 * `conversation_retention_days` is hard-deleted ... by the retention sweeper"). Reuses the
 * ONE erase routine (`lib/retention.ts#eraseAssistedSellingThread`) the three event-driven
 * triggers already call, so this sweep never drifts from their behavior. Idempotent by
 * construction: `eraseAssistedSellingThread`'s own `deletedAt: null` guard means a thread a
 * concurrent trigger already erased is simply skipped (returns `false`), never
 * double-processed.
 */
export async function sweepRetention(
  em: EntityManager,
  scope: AssistedSellingSweepScope,
  now: Date = new Date(),
): Promise<SweepRetentionResult> {
  let erasedCount = 0
  const storeIds = await distinctStoreIds(em, scope, 'closed')

  for (const storeId of storeIds) {
    const settings = await resolveEffectiveAssistedSellingSettings(em, { ...scope, storeId })
    const threshold = new Date(now.getTime() - settings.conversationRetentionDays * DAY_MS)

    for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
      const candidates = await em.find(
        AssistedSellingThread,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          storeId,
          status: 'closed',
          deletedAt: null,
          closedAt: { $lte: threshold },
        },
        { limit: PAGE_SIZE, orderBy: { id: 'asc' } },
      )
      if (candidates.length === 0) break

      for (const candidate of candidates) {
        try {
          const erased = await eraseAssistedSellingThread(em, scope, candidate.id)
          if (erased) erasedCount += 1
        } catch (error) {
          logger.warn('[assisted_selling:retention] failed to erase thread', {
            threadId: candidate.id,
            error: error instanceof Error ? error.message : error,
          })
        }
      }

      if (candidates.length < PAGE_SIZE) break
    }
  }

  return { erasedCount }
}
