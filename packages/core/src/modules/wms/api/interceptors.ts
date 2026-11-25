import type { ApiInterceptor, InterceptorBeforeResult, InterceptorContext, InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { E } from '#generated/entities.ids.generated'
import {
  decodeCatalogInventoryProfileIntent,
  WMS_CATALOG_PROFILE_HEADER,
} from '../lib/catalogInventoryProfileIntent'
import { assertCommandFeatures } from '../commands/featureGuard'
import { buildCatalogInventoryProfileCommandContext, syncCatalogInventoryProfile } from '../lib/catalogInventoryProfileSync'

function resolveRecordId(
  requestBody: Record<string, unknown> | undefined,
  responseBody: Record<string, unknown> | undefined,
): string | null {
  const responseId = responseBody?.id
  if (typeof responseId === 'string' && responseId.trim().length > 0) {
    return responseId
  }

  const requestId = requestBody?.id
  if (typeof requestId === 'string' && requestId.trim().length > 0) {
    return requestId
  }

  return null
}

async function prepareCatalogInventoryProfile(
  request: InterceptorRequest,
  context: InterceptorContext,
  target: 'product' | 'variant',
): Promise<InterceptorBeforeResult> {
  const rawHeader = request.headers[WMS_CATALOG_PROFILE_HEADER]
  if (!rawHeader) return { ok: true }

  const targetEntityId = target === 'product' ? E.catalog.catalog_product : E.catalog.catalog_product_variant
  const intent = decodeCatalogInventoryProfileIntent(rawHeader)
  if (intent?.sourceEntityId !== targetEntityId) return { ok: true }

  try {
    await assertCommandFeatures(buildCatalogInventoryProfileCommandContext(context), [['wms.manage_inventory']])
  } catch (error) {
    if (!isCrudHttpError(error)) throw error
    return { ok: false, statusCode: error.status, message: error.message }
  }

  return { ok: true, metadata: { intent, target } }
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'wms.catalog-products.inventory-profile-sync',
    targetRoute: 'catalog/products',
    methods: ['POST', 'PUT'],
    priority: 120,
    before(request, context) {
      return prepareCatalogInventoryProfile(request, context, 'product')
    },
    async after(request, response, context) {
      if (response.statusCode >= 400) return {}

      const metadata = context.metadata as
        | { intent?: ReturnType<typeof decodeCatalogInventoryProfileIntent>; target?: 'product' | 'variant' }
        | undefined
      if (!metadata?.intent) return {}

      const recordId = resolveRecordId(request.body, response.body)
      if (!recordId) return {}

      await syncCatalogInventoryProfile({
        intent: metadata.intent,
        target: 'product',
        recordId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        userId: context.userId,
        container: context.container,
      })

      return {}
    },
  },
  {
    id: 'wms.catalog-variants.inventory-profile-sync',
    targetRoute: 'catalog/variants',
    methods: ['POST', 'PUT'],
    priority: 120,
    before(request, context) {
      return prepareCatalogInventoryProfile(request, context, 'variant')
    },
    async after(request, response, context) {
      if (response.statusCode >= 400) return {}

      const metadata = context.metadata as
        | { intent?: ReturnType<typeof decodeCatalogInventoryProfileIntent>; target?: 'product' | 'variant' }
        | undefined
      if (!metadata?.intent) return {}

      const recordId = resolveRecordId(request.body, response.body)
      if (!recordId) return {}

      await syncCatalogInventoryProfile({
        intent: metadata.intent,
        target: 'variant',
        recordId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        userId: context.userId,
        container: context.container,
      })

      return {}
    },
  },
]

export default interceptors
