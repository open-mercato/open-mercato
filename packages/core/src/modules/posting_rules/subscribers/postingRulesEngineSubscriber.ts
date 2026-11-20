// =============================================================================
// PostingRulesEngineSubscriber — the module's core, real-time behavior.
// =============================================================================
//
// Subscribes to `ledger.journal_entry.posted` (#5663), declared
// `persistent: true`: #5663's Events section names this subscriber as a
// write-side, idempotent consumer that must be persistent, so delivery is
// retried on failure. That makes idempotency this module's responsibility
// (`reclassifyLine`: per-line advisory lock, existence check, ensure tag).
// Errors a retry cannot fix are logged and the line is left to
// `commands/reconcileCostRing.ts` and the period-close guard; only transient
// errors are thrown so that delivery retries them.
// =============================================================================

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { LedgerJournalEntryPostedPayload } from '../../ledger/events'
import {
  RECLASSIFICATION_REFERENCE_TYPE,
  isNonRetryableError,
  isTriggerEntryType,
  loadCandidatesForEntry,
  reclassifyLine,
} from '../lib/reclassify'

const logger = createLogger('posting_rules').child({ component: 'posting-rules-engine-subscriber' })

export const metadata = {
  event: 'ledger.journal_entry.posted',
  persistent: true,
  id: 'posting_rules:posting-rules-engine-subscriber',
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type ResolverContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function resolveContainer(ctx: ResolverContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

function toRecord(value: unknown): Partial<LedgerJournalEntryPostedPayload> {
  return value && typeof value === 'object' ? (value as Partial<LedgerJournalEntryPostedPayload>) : {}
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const event = toRecord(payload)
  if (!event.journalEntryId || !event.lines || !Array.isArray(event.lines)) return

  const tenantId = event.tenantId ?? ctx.tenantId ?? null
  const organizationId = event.organizationId ?? ctx.organizationId ?? null
  if (!tenantId || !organizationId) return

  // Source set, conditions 1 and 2 — decided from the payload alone, before
  // touching the database: only `NORMAL` and `REVERSAL` entries are
  // reclassified (`CLOSING`/`OPENING` are skipped), and the engine's own
  // output is ignored (Invariant 3).
  if (!event.type || !isTriggerEntryType(event.type)) return
  if (event.referenceType === RECLASSIFICATION_REFERENCE_TYPE) return

  const container = resolveContainer(ctx) as AwilixContainer
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { organizationId, tenantId }
  const { translate } = await resolveTranslations()

  // The payload carries neither `currencyId`, `exchangeRate` nor each line's
  // `amountCurrency`, which a reclassification copies — load them with the
  // same loader the sweeper uses.
  const lineIds = event.lines.map((line) => line.id)
  const candidates = await loadCandidatesForEntry(em, event.journalEntryId, scope, lineIds)

  let transientError: unknown = null
  for (const candidate of candidates) {
    try {
      await reclassifyLine({ container, em, scope, translate }, candidate)
    } catch (err) {
      if (isNonRetryableError(err)) {
        // No retry can fix this (clearing account unset, no target account,
        // locked period). Logged with its named error; the line stays visible
        // to `reconcileCostRing` and the period-close guard.
        logger.warn('Reclassification skipped, left to reconcileCostRing', {
          journalEntryId: event.journalEntryId,
          lineId: candidate.line.id,
          err,
        })
        continue
      }
      transientError = transientError ?? err
    }
  }
  if (transientError) throw transientError
}
