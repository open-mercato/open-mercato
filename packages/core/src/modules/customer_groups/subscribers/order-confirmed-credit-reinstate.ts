import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../data/entities'
import { createCustomerCreditService, type CustomerCreditService } from '../services/customerCreditService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('customer_groups')

// #8404: undoing an order cancellation re-emits `sales.order.confirmed` the same way the
// original confirmation did (`sales/commands/documents.ts`'s `undoOrderGraph`, mirroring
// `execute()`), which is enough on its own for stock — WMS's sibling
// `sales-order-confirmed-reserve.ts` re-derives the required reservation from the order's
// live lines every time it runs. Credit has no such re-derivation: a reservation that was
// released can never be re-reserved under its OWN idempotency key (idempotency rule 3,
// `customerCreditService.ts` — a key whose reservation was already released is not
// reusable), so an un-cancelled on-account order stayed live with no credit hold at all.
// Always reserves under a FRESH key derived from the released reservation's own key,
// never a replay of it.
//
// #9073: this used to gate on the event payload's own `previousStatus === canceled`,
// which broke the moment staff revived an order through an intermediate status
// (Canceled → On hold → Confirmed) — the final `confirmed` event's `previousStatus` is
// `on_hold`, not `canceled`, so the reinstate never ran and the order stayed live with no
// credit hold. There is no need for that gate at all: the loop below already finds only
// THIS order's own un-reinstated release (scoped by `linkedOrderId`, skipped when no
// `releaseEntry` exists or a `reinstate:` entry is already linked), so it is a safe no-op
// on every order's ordinary first confirmation and correctly fires no matter how many
// intermediate statuses a revival passes through.
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

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const orderId = readString(record, 'orderId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

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
  // #8268 review Major 6: takes the SAME advisory transaction lock, keyed by this order,
  // as `order-cancelled-credit-release.ts`'s release handler — see that file's comment
  // for the exact race this closes. Whichever subscriber (this reinstate, or a delayed
  // release redelivery) acquires the lock first completes and commits its entire
  // check-then-act pass before the other is allowed to read, so a reservation this pass
  // creates can never be observed mid-flight by a release pass that started earlier and
  // paused, nor vice versa.
  const lockKey = `customer_groups_credit_lifecycle:${orderId}`
  await em.transactional(async (tx) => {
    await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])

    // #8268 review Major 3: the advisory lock alone only serializes this handler against
    // `order-cancelled-credit-release.ts` — it does not stop EITHER from acting on a STALE
    // event. Deliver a delayed/redelivered `sales.order.confirmed` AFTER the order was
    // cancelled again (or deleted): without this check the serialized reinstate would
    // still re-reserve credit for an order that is no longer live. Only reinstate when the
    // order still exists and is not currently `canceled`.
    const current = await tx.getConnection().execute(
      'select status from sales_orders where id = ? and tenant_id = ? and organization_id = ? limit 1',
      [orderId, tenantId, organizationId],
    )
    const currentStatus = Array.isArray(current) && current.length > 0
      ? (current[0] as { status?: string | null }).status ?? null
      : null
    if (currentStatus == null || currentStatus === 'canceled') {
      logger.debug('[customer_groups:order-confirmed-credit-reinstate] skipped stale confirmation redelivery — order no longer live', {
        orderId,
        tenantId,
        organizationId,
        currentStatus,
      })
      return
    }

    const reservations = await tx.find(CustomerCreditLedgerEntry, {
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

    const creditService: CustomerCreditService = createCustomerCreditService(tx)
    for (const reservation of reservations) {
      const releaseEntry = await tx.findOne(CustomerCreditLedgerEntry, {
        tenantId,
        relatedEntryId: reservation.id,
        entryType: 'release',
      })
      // Still active (never released) — nothing to reinstate for this one.
      if (!releaseEntry) continue

      const reinstateKey = `reinstate:${reservation.idempotencyKey}`
      const alreadyReinstated = await tx.findOne(CustomerCreditLedgerEntry, {
        tenantId,
        idempotencyKey: reinstateKey,
      })
      // A prior pass can have committed the `reserveCredit` write and then died (or thrown)
      // before `linkCreditReservationToOrder` ran — the reinstate entry exists but was never
      // linked to this order, so the next cancel would never find it to release again. A
      // bare `continue` here would skip the link forever on every future replay; link it now
      // instead, same idempotent CAS `linkCreditReservationToOrder` already performs for a
      // fresh reservation.
      if (alreadyReinstated) {
        if (alreadyReinstated.linkedOrderId == null) {
          await creditService.linkCreditReservationToOrder({ scope, idempotencyKey: reinstateKey, orderId })
        }
        continue
      }

      const account = await tx.findOne(CustomerCreditAccount, {
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
          // A business refusal (limit now exceeded, account on hold, terms revoked) — not a
          // throwable error (retrying would refuse the same way every time), but the undo
          // already committed before this subscriber ran, so the order is live with no
          // credit hold and nothing besides this path will ever surface that. `reportError`
          // makes it visible to telemetry/on-call; `reserveCredit` itself already emits
          // `customer_groups.credit.limit_exceeded` (with this order as `sourceId`), which
          // the notification subscriber now links straight to the order, not just the
          // company.
          logger.warn('[customer_groups:order-confirmed-credit-reinstate] reinstatement refused', {
            orderId,
            tenantId,
            organizationId,
            reason: result.check.reason,
          })
          getTelemetryRuntime()?.reportError(
            new Error(`[internal] credit reinstatement refused on order uncancel: ${result.check.reason}`),
            {
              module: 'customer_groups',
              code: 'customer_groups.order_confirmed_credit_reinstate_refused',
              attributes: { orderId, tenantId, organizationId, reason: result.check.reason },
            },
          )
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
  })
}
