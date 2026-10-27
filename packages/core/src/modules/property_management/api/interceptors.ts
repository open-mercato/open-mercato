import type { EntityManager } from '@mikro-orm/postgresql'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { E } from '#generated/entities.ids.generated'
import { decodeProductUseIntent, PRODUCT_USE_INTENT_HEADER, type ProductUseIntent } from '../lib/productUseIntent'
import { assertProductUseChangeAllowed, loadProductUseRecord, toProductUseState } from '../commands/product-use'

function recordIdOf(body: Record<string, unknown> | undefined): string | null {
  const id = body?.id
  return typeof id === 'string' && id.trim().length ? id : null
}

function nextState(intent: ProductUseIntent) {
  return intent.use && intent.billingUnit ? { use: intent.use, billingUnit: intent.billingUnit } : null
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'property_management.catalog-products.product-use-sync',
    targetRoute: 'catalog/products',
    methods: ['POST', 'PUT'],
    features: ['property_management.manage'],
    priority: 110,
    async before(request, context) {
      const intent = decodeProductUseIntent(request.headers[PRODUCT_USE_INTENT_HEADER])
      if (!intent || intent.sourceEntityId !== E.catalog.catalog_product) return { ok: true }
      const productId = request.method === 'PUT' ? recordIdOf(request.body) : null
      if (productId) {
        const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
        const em = (context.em as EntityManager).fork()
        try {
          const current = toProductUseState(await loadProductUseRecord(em, scope, productId))
          await assertProductUseChangeAllowed(em, scope, productId, current, nextState(intent))
        } catch (err) {
          if (isCrudHttpError(err)) {
            const message = typeof err.body?.error === 'string' ? err.body.error : undefined
            return { ok: false, statusCode: err.status, message }
          }
          throw err
        }
      }
      return { ok: true, metadata: { productUseIntent: intent } }
    },
    async after(request, response, context) {
      if (response.statusCode >= 400) return {}
      const intent = (context.metadata as { productUseIntent?: ProductUseIntent } | undefined)?.productUseIntent
      if (!intent) return {}
      const productId = recordIdOf(response.body) ?? recordIdOf(request.body)
      if (!productId) return {}
      const ctx: CommandRuntimeContext = {
        container: context.container,
        auth: { sub: context.userId, userId: context.userId, tenantId: context.tenantId, orgId: context.organizationId },
        organizationScope: null,
        selectedOrganizationId: context.organizationId,
        organizationIds: [context.organizationId],
      }
      const commandBus = context.container.resolve('commandBus') as CommandBus
      await commandBus.execute('property_management.product_use.set', {
        input: {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          catalogProductId: productId,
          use: intent.use,
          billingUnit: intent.billingUnit,
        },
        ctx,
      })
      return {}
    },
  },
]

export default interceptors
