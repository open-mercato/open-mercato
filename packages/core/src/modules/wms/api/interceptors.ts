import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
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
