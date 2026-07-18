import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ProductPlanningParams, ProductionOrder } from '../data/entities.js'
import { isMtoAutoDraftEnabled } from '../lib/mtoAutoDraftConfig.js'

const logger = createLogger('production').child({ component: 'sales-order-created-mto' })

/**
 * Optional sales -> production soft integration (spec § Sales integration).
 * Listens for `sales.order.created` (owned by the sales module, not
 * imported statically — cross-module coupling stays FK-id + DI-key only,
 * never a direct entity import) and, when the tenant has opted in via
 * `production.mto_auto_draft` (OFF by default), drafts a production order
 * for every make-flagged line.
 *
 * No-ops silently (never throws) when: sales is absent (no `SalesOrderLine`
 * DI registration), the opt-in is off, the order has no lines, none of the
 * lines are make-flagged, or a draft order for that source+product already
 * exists (re-delivery safe).
 */
export const metadata = {
  event: 'sales.order.created',
  persistent: true,
  id: 'production:sales-order-mto-draft',
}

type SalesOrderCreatedPayload = {
  id: string
  organizationId?: string | null
  tenantId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type SalesOrderLineRecord = {
  id: string
  productId?: string | null
  productVariantId?: string | null
  quantity: string
  quantityUnit?: string | null
}

function tryResolve<T>(ctx: ResolverContext, name: string): T | undefined {
  try {
    return ctx.resolve<T>(name)
  } catch {
    return undefined
  }
}

export default async function handle(payload: SalesOrderCreatedPayload, ctx: ResolverContext): Promise<void> {
  try {
    const orderId = payload?.id
    const tenantId = payload?.tenantId ?? null
    const organizationId = payload?.organizationId ?? null
    if (!orderId || !tenantId || !organizationId) return

    const enabled = await isMtoAutoDraftEnabled(ctx, tenantId)
    if (!enabled) return

    // Optional peer: resolve the sales order-line entity class by DI key
    // only. Absent when the sales module is disabled -- silent no-op.
    const SalesOrderLine = tryResolve<new (...args: unknown[]) => unknown>(ctx, 'SalesOrderLine')
    if (!SalesOrderLine) return

    const em = tryResolve<EntityManager>(ctx, 'em')
    const commandBus = tryResolve<CommandBus>(ctx, 'commandBus')
    if (!em || !commandBus) return

    const fork = em.fork()
    const lines = (await fork.find(SalesOrderLine as never, {
      order: orderId,
      deletedAt: null,
    } as never)) as SalesOrderLineRecord[]
    if (!lines.length) return

    const productIds = Array.from(
      new Set(lines.map((line) => line.productId).filter((value): value is string => typeof value === 'string')),
    )
    if (!productIds.length) return

    const planningParams = await fork.find(ProductPlanningParams, {
      tenantId,
      organizationId,
      productId: { $in: productIds },
      procurement: 'make',
      deletedAt: null,
    })
    const makeProductIds = new Set(planningParams.map((row) => row.productId))
    if (!makeProductIds.size) return

    const makeLines = lines.filter(
      (line) => typeof line.productId === 'string' && makeProductIds.has(line.productId),
    )
    if (!makeLines.length) return

    // Idempotency (re-delivery safe): skip a product that already has a
    // draft order for this same sales order source.
    const existingDrafts = await fork.find(ProductionOrder, {
      tenantId,
      organizationId,
      sourceType: 'sales_order',
      sourceId: orderId,
      status: 'draft',
      deletedAt: null,
    })
    const draftedProductIds = new Set(existingDrafts.map((row) => row.productId))

    const container = {
      resolve: ctx.resolve,
      cradle: new Proxy({}, { get: (_target, prop: string) => ctx.resolve(prop) }),
    } as unknown as AwilixContainer

    const commandCtx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      systemActor: true,
    }

    for (const line of makeLines) {
      if (!line.productId || draftedProductIds.has(line.productId)) continue
      try {
        await commandBus.execute('production.orders.create', {
          input: {
            productId: line.productId,
            variantId: line.productVariantId ?? null,
            qtyPlanned: Number(line.quantity) || 0,
            uom: line.quantityUnit || 'pcs',
            priority: 0,
            sourceType: 'sales_order',
            sourceId: orderId,
          },
          ctx: commandCtx,
        })
        draftedProductIds.add(line.productId)
      } catch (err) {
        logger.error('production.sales-order-mto-draft.line_failed', { err, orderId, productId: line.productId })
      }
    }
  } catch (err) {
    logger.error('production.sales-order-mto-draft.failed', { err })
  }
}
