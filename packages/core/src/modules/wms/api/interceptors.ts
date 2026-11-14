import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { E } from '#generated/entities.ids.generated'
import {
  decodeCatalogInventoryProfileIntent,
  WMS_CATALOG_PROFILE_HEADER,
} from '../lib/catalogInventoryProfileIntent'
import {
  syncCatalogInventoryProfile,
} from '../lib/catalogInventoryProfileSync'

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

export const interceptors: ApiInterceptor[] = [
  {
    id: 'wms.catalog-products.inventory-profile-sync',
    targetRoute: 'catalog/products',
    methods: ['POST', 'PUT'],
    priority: 120,
    async before(request) {
      const rawHeader = request.headers[WMS_CATALOG_PROFILE_HEADER]
      if (!rawHeader) return { ok: true }

      const intent = decodeCatalogInventoryProfileIntent(rawHeader)
      // CrudForm scopes `onBeforeSave` request headers around the whole
      // `onSubmit` callback, so a page whose submit handler also creates
      // other records (e.g. the product-create wizard implicitly creating
      // its default variant) can leak this header onto those unrelated
      // requests. Only honor an intent the product form itself computed.
      if (intent?.sourceEntityId !== E.catalog.catalog_product) return { ok: true }
      return {
        ok: true,
        metadata: { intent, target: 'product' },
      }
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
    async before(request) {
      const rawHeader = request.headers[WMS_CATALOG_PROFILE_HEADER]
      if (!rawHeader) return { ok: true }

      const intent = decodeCatalogInventoryProfileIntent(rawHeader)
      // See the product interceptor's `before` for why this check exists.
      if (intent?.sourceEntityId !== E.catalog.catalog_product_variant) return { ok: true }
      return {
        ok: true,
        metadata: { intent, target: 'variant' },
      }
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
