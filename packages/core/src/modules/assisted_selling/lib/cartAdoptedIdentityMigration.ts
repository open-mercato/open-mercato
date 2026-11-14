import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { AssistedSellingThread } from '../data/entities'

const logger = createLogger('assisted_selling')

// #8268 review Major 5 (follow-up from issue #9392). `cart.cart.adopted` is emitted only
// when a login merge's §7.1 row-1 "adopt" strategy keeps the guest cart as the live one
// (`cart/commands/merge.ts`'s own `strategy === 'replace'` branch, survivorCart === the
// guest cart G) and fills in the buyer identity on that SAME cart id — unlike an ordinary
// merge, `buyerCartId` never changes here, so `reauthorOnMerge.ts`'s `migrateOrCloseThreadOnMerge`
// (which looks for a thread on the MERGED-AWAY source cart) finds nothing and does nothing.
// G's own open thread — already pointed at the right cart id — would otherwise keep null
// `customerId`/`customerUserId` forever: later proposal authoring would resolve guest
// assortment for an identified buyer, and customer erasure's `customerUserId` filter
// (`erasureSubscribers.ts`) would never find this conversation.

export type CartAdoptedSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Idempotent on redelivery: once the thread's `customerId`/`customerUserId` match the
 * payload, the atomic flush below is a no-op write (same values), so a `persistent: true`
 * redelivery after a transient failure never double-applies anything observable.
 */
export async function handleCartAdoptedForAssistedSellingIdentity(
  payload: unknown,
  ctx: CartAdoptedSubscriberContext,
): Promise<void> {
  const record = toRecord(payload)
  const cartId = readString(record, 'cartId')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  const customerId = readString(record, 'customerId')
  const customerUserId = readString(record, 'customerUserId')

  if (!cartId || !tenantId || !organizationId) {
    logger.debug('[assisted_selling:cart-adopted-identity-migration] skipped incomplete payload', {
      hasCartId: Boolean(cartId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  const container = ctx.container ?? { resolve: ctx.resolve }

  try {
    const em = container.resolve<EntityManager>('em').fork()
    // Scoped the same way `migrateOrCloseThreadOnMerge` scopes its own source-thread
    // lookup — the adopted cart's own open, non-deleted thread, never a closed/historical one.
    const thread = await em.findOne(AssistedSellingThread, {
      tenantId,
      organizationId,
      buyerCartId: cartId,
      status: 'open',
      deletedAt: null,
    })
    if (!thread) return

    await withAtomicFlush(
      em,
      [
        () => {
          thread.customerId = customerId
          thread.customerUserId = customerUserId
        },
      ],
      { transaction: true, label: 'assisted_selling.thread.adopt_identity' },
    )
  } catch (err) {
    logger.warn('[assisted_selling:cart-adopted-identity-migration] failed to migrate buyer identity', {
      cartId,
      error: err instanceof Error ? err.message : err,
    })
    getTelemetryRuntime()?.reportError(err, { module: 'assisted_selling', code: 'assisted_selling.cart_adopted_identity_migration_failed' })
    // Persistent subscriber: a transient failure (lock timeout, dropped connection) must
    // retry via redelivery, never silently leave the thread's buyer identity unresolved.
    throw err
  }
}
