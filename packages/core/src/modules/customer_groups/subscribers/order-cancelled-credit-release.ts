import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerCreditLedgerEntry } from '../data/entities'
import { createCustomerCreditService, type CustomerCreditService } from '../services/customerCreditService'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups')

// Release 5 Phase 3 (D-R5-2 hybrid settlement, spec §6.5/§11). Nothing in this release
// settles a credit reservation automatically on payment — that stays a manual `/adjust`
// or an integration calling `settleCredit`. The ONE automatic move is this: when an order
// with a linked (not-yet-settled) reservation is cancelled, its open exposure is released,
// because a cancelled order can never be paid. `linked_order_id` is written by
// `linkCreditReservationToOrder` (checkout, Step 4.2) — until that Step lands this
// subscriber finds nothing and is a no-op, which is the correct behaviour for Phase 1.
//
// Idempotent by construction: `releaseCredit` (Step 1.6, §6.5 idempotency rule 4) keys its
// own entry as `release:{reserveIdempotencyKey}` and is a no-op on redelivery — this
// subscriber does not need its own dedupe.
export const metadata = {
  event: 'sales.order.cancelled',
  persistent: true,
  id: 'customer_groups:order-cancelled-credit-release',
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

// Exported so `order-deleted-credit-release.ts` (#8406) can reuse the exact same release
// logic for `sales.order.deleted` — deleting an on-account order must release its credit
// exposure the same way cancelling it does, and the lookup below is scoped purely by
// `linkedOrderId`/`tenantId`/`organizationId`, with no dependency on the order row itself
// still existing.
export async function handleOrderCreditRelease(
  payload: unknown,
  ctx: SubscriberContext,
  options: { eventId?: string } = {},
): Promise<void> {
  const eventId = options.eventId ?? 'sales.order.cancelled'
  const record = toRecord(payload)
  const orderId = readString(record, 'orderId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  const orderNumber = readString(record, 'orderNumber')

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[customer_groups:order-cancelled-credit-release] skipped incomplete payload', {
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
    logger.error('[customer_groups:order-cancelled-credit-release] failed to initialize persistence', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    throw error
  }

  // #8268 review Major 6: a plain "is the order still deleted?" SELECT only narrows the
  // race, it does not close it — this handler's OWN `em.find` for linked reservations ran
  // AFTER that check, so a redelivery that paused between the two could still observe (and
  // re-release) a reservation `order-confirmed-credit-reinstate.ts` created WHILE this
  // handler was paused. Both that subscriber and this one now take the SAME Postgres
  // advisory transaction lock, keyed by this order, around their entire
  // check-then-act sequence — whichever started first finishes its whole pass (and
  // commits) before the other's pass is even allowed to read, so neither can observe a
  // state the other is mid-way through changing.
  const lockKey = `customer_groups_credit_lifecycle:${orderId}`
  await em.transactional(async (tx) => {
    await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])

    if (eventId === 'sales.order.deleted') {
      // `sales.order.deleted` is persistent (queued/retried), and the undo-of-delete path
      // (`sales/commands/documents.ts#undoOrderGraph`) can recreate this order before (or
      // racing) this event's redelivery. A redelivery arriving after the order exists
      // again must not release a reservation reinstated for the restored order.
      const stillDeleted = await tx.getConnection().execute(
        'select 1 from sales_orders where id = ? and tenant_id = ? and organization_id = ? limit 1',
        [orderId, tenantId, organizationId],
      )
      if (Array.isArray(stillDeleted) && stillDeleted.length > 0) {
        logger.debug('[customer_groups:order-cancelled-credit-release] skipped stale delete redelivery — order exists again', {
          orderId,
          tenantId,
          organizationId,
        })
        return
      }
    }

    // §11: "finds the reservation with linked_order_id = orderId in the event's tenant and
    // organization". An order with no linked reservation (never purchased on account, or
    // checkout hasn't shipped Step 4.2's `linkCreditReservationToOrder` yet) is ignored.
    const reservations = await tx.find(CustomerCreditLedgerEntry, {
      tenantId,
      organizationId,
      entryType: 'reserve',
      linkedOrderId: orderId,
    })
    if (!reservations.length) {
      logger.debug('[customer_groups:order-cancelled-credit-release] no linked reservation for cancelled order', {
        orderId,
        tenantId,
        organizationId,
      })
      return
    }

    const creditService: CustomerCreditService = createCustomerCreditService(tx)
    for (const reservation of reservations) {
      try {
        await creditService.releaseCredit({
          scope: { tenantId, organizationId },
          reserveIdempotencyKey: reservation.idempotencyKey,
          reason: `${eventId}:${orderNumber ?? orderId}`,
        })
      } catch (error) {
        logger.error('[customer_groups:order-cancelled-credit-release] release failed', {
          err: error,
          orderId,
          tenantId,
          organizationId,
          reserveIdempotencyKey: reservation.idempotencyKey,
        })
        throw error
      }
    }
  })
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  return handleOrderCreditRelease(payload, ctx)
}
