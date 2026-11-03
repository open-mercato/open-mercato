import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../data/entities'
import { createCustomerCreditService, type CustomerCreditService } from '../services/customerCreditService'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups')

// #8404: undoing an order cancellation re-emits `sales.order.confirmed` the same way the
// original confirmation did (`sales/commands/documents.ts`'s `undoOrderGraph`, mirroring
// `execute()`), which is enough on its own for stock — WMS's sibling
// `sales-order-confirmed-reserve.ts` re-derives the required reservation from the order's
// live lines every time it runs. Credit has no such re-derivation: a reservation that was
// released can never be re-reserved under its OWN idempotency key (idempotency rule 3,
// `customerCreditService.ts` — a key whose reservation was already released is not
// reusable), so an un-cancelled on-account order stayed live with no credit hold at all.
// This only fires for a transition OUT of a cancelled status, and always reserves under a
// FRESH key derived from the released reservation's own key, never a replay of it.
export const metadata = {
  event: 'sales.order.confirmed',
  persistent: true,
  id: 'customer_groups:order-confirmed-credit-reinstate',
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveContainer(ctx: SubscriberContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

// Duck-typed against the event payload's own status string — never an import of
// `sales/lib/orderCancellationGuard.ts`, same soft-coupling precedent as this subscriber's
// sibling `order-cancelled-credit-release.ts`.
function isCancelledStatusValue(status: string | null): boolean {
  if (!status) return false
  const normalized = status.trim().toLowerCase()
  return normalized === 'canceled' || normalized === 'cancelled'
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const orderId = readString(record, 'orderId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  const previousStatus = readString(record, 'previousStatus')

  // Only an uncancel transition reinstates credit — the (far more common) initial
  // confirmation at checkout reserves credit itself, before the order is even created.
  if (!isCancelledStatusValue(previousStatus)) return

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[customer_groups:order-confirmed-credit-reinstate] skipped incomplete payload', {
      hasOrderId: Boolean(orderId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  const container = resolveContainer(ctx)
  let em: EntityManager
  try {
    em = container.resolve<EntityManager>('em').fork()
  } catch (error) {
    logger.error('[customer_groups:order-confirmed-credit-reinstate] failed to initialize persistence', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    throw error
  }

  const scope = { tenantId, organizationId }
  const reservations = await em.find(CustomerCreditLedgerEntry, {
    tenantId,
    organizationId,
    entryType: 'reserve',
    linkedOrderId: orderId,
  })
  if (!reservations.length) {
    logger.debug('[customer_groups:order-confirmed-credit-reinstate] no linked reservation for uncancelled order', {
      orderId,
      tenantId,
      organizationId,
    })
    return
  }

  const creditService: CustomerCreditService = createCustomerCreditService(em)
  for (const reservation of reservations) {
    const releaseEntry = await em.findOne(CustomerCreditLedgerEntry, {
      tenantId,
      relatedEntryId: reservation.id,
      entryType: 'release',
    })
    // Still active (never released) — nothing to reinstate for this one.
    if (!releaseEntry) continue

    const reinstateKey = `reinstate:${reservation.idempotencyKey}`
    const alreadyReinstated = await em.findOne(CustomerCreditLedgerEntry, {
      tenantId,
      idempotencyKey: reinstateKey,
    })
    if (alreadyReinstated) continue

    const account = await em.findOne(CustomerCreditAccount, {
      id: reservation.creditAccountId,
      tenantId,
      organizationId,
    })
    if (!account) continue

    try {
      const result = await creditService.reserveCredit({
        scope,
        buyer: { customerId: account.customerId },
        currencyCode: account.currencyCode,
        amount: reservation.amount,
        sourceType: 'order',
        sourceId: orderId,
        idempotencyKey: reinstateKey,
      })
      if (result.reserved) {
        await creditService.linkCreditReservationToOrder({ scope, idempotencyKey: reinstateKey, orderId })
      } else {
        // A business refusal (limit now exceeded, account on hold, terms revoked) — not an
        // error, and retrying would refuse the same way every time.
        logger.warn('[customer_groups:order-confirmed-credit-reinstate] reinstatement refused', {
          orderId,
          tenantId,
          organizationId,
          reason: result.check.reason,
        })
      }
    } catch (error) {
      logger.error('[customer_groups:order-confirmed-credit-reinstate] reinstate failed', {
        err: error,
        orderId,
        tenantId,
        organizationId,
        reinstateKey,
      })
      throw error
    }
  }
}
