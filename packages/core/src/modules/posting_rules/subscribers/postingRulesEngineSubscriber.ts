// =============================================================================
// PostingRulesEngineSubscriber — the module's core, real-time behavior.
// =============================================================================
//
// Subscribes to `ledger.journal_entry.posted` (#5663, ephemeral — see the
// spec's Design Decisions, "Real-time, not batch — through an event, not a
// shared transaction"). Not atomic with the source posting: a microscopic
// window exists between the two commits, and there is no automatic retry if
// this handler throws — `commands/reconcileCostRing.ts` is what closes that
// gap within a bounded window (Invariant 1: "eventual, not immediate").
// =============================================================================

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { LedgerJournalEntryPostedPayload } from '../../ledger/events'
import { RECLASSIFICATION_REFERENCE_TYPE, reclassifyLine, type ReclassifyCandidate } from '../lib/reclassify'

export const metadata = {
  event: 'ledger.journal_entry.posted',
  // Ephemeral, not persistent: this handler is a best-effort, in-process
  // reaction (see Design Decisions above) — `reconcileCostRing` is the
  // durable repair path, not at-least-once redelivery of this event.
  persistent: false,
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

  // Invariant 3 — ignore this engine's own prior output before touching any
  // line at all (Design Decisions, "The engine's own postings carry a
  // distinct `referenceType`"). `reclassifyLine` re-checks this per line
  // too (defense in depth for `reconcileCostRing`'s own call path), but
  // checking once here avoids even loading account classifications for an
  // event this handler should never have reacted to.
  if (event.referenceType === RECLASSIFICATION_REFERENCE_TYPE) return

  const container = resolveContainer(ctx) as AwilixContainer
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { organizationId, tenantId }
  const { translate } = await resolveTranslations()

  // The event payload doesn't carry `currencyId` (see
  // `LedgerJournalEntryPostedPayload`) — re-fetch the entry's own currency
  // once, directly, rather than guessing at a default, since every
  // reclassification for this entry must post in the same currency as the
  // source entry.
  const { JournalEntry } = await import('../../ledger/data/entities')
  const entry = await em.findOne(JournalEntry, {
    id: event.journalEntryId,
    organizationId,
    tenantId,
  })
  if (!entry) return

  for (const line of event.lines) {
    const candidate: ReclassifyCandidate = {
      entry: {
        id: event.journalEntryId,
        operationDate: event.operationDate ?? '',
        currencyId: entry.currencyId,
        type: event.type ?? 'NORMAL',
        referenceType: event.referenceType ?? null,
        referenceId: event.referenceId ?? null,
      },
      line: {
        id: line.id,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
      },
    }
    await reclassifyLine({ container, em, scope, translate }, candidate)
  }
}
