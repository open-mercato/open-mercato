import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import interceptors from '../interceptors'
import {
  WMS_CATALOG_PROFILE_HEADER,
  encodeCatalogInventoryProfileIntent,
} from '../../lib/catalogInventoryProfileIntent'
import type { InterceptorContext, InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'

const [productInterceptor, variantInterceptor] = interceptors

function contextWithFeatures(allowed: boolean) {
  const userHasAllFeatures = jest.fn(async () => allowed)
  const container = createContainer().register('rbacService', asValue({ userHasAllFeatures }))
  const context: InterceptorContext = {
    userId: 'catalog-user',
    tenantId: 'tenant',
    organizationId: 'selected-organization',
    em: {} as EntityManager,
    container,
  }
  return { context, userHasAllFeatures }
}

function requestWithIntent(sourceEntityId: string): InterceptorRequest {
  return {
    method: 'POST',
    url: '/api/catalog/variants',
    body: {},
    headers: {
      [WMS_CATALOG_PROFILE_HEADER]: encodeCatalogInventoryProfileIntent({
        sourceEntityId,
        manageInventory: true,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      }),
    },
  }
}

describe('wms catalog inventory-profile interceptors (#7434)', () => {
  it.each([
    { interceptor: productInterceptor, entityId: E.catalog.catalog_product },
    { interceptor: variantInterceptor, entityId: E.catalog.catalog_product_variant },
  ])('refuses a recognized intent without inventory access', async ({ interceptor, entityId }) => {
    const { context, userHasAllFeatures } = contextWithFeatures(false)

    const result = await interceptor.before!(requestWithIntent(entityId), context)

    expect(result).toMatchObject({ ok: false, statusCode: 403 })
    expect(result.metadata).toBeUndefined()
    expect(userHasAllFeatures).toHaveBeenCalledWith(context.userId, ['wms.manage_inventory'], {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
  })

  it('product interceptor honors an intent computed by the product form', async () => {
    const result = await productInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product),
      contextWithFeatures(true).context,
    )
    expect(result.metadata?.intent).toBeTruthy()
  })

  it('product interceptor ignores an intent leaked from a different host form', async () => {
    const result = await productInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product_variant),
      contextWithFeatures(true).context,
    )
    expect(result.metadata).toBeUndefined()
  })

  it('variant interceptor honors an intent computed by the variant form', async () => {
    const result = await variantInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product_variant),
      contextWithFeatures(true).context,
    )
    expect(result.metadata?.intent).toBeTruthy()
  })

  it('variant interceptor ignores an intent leaked from the product form (the duplicate-profile bug, #7434)', async () => {
    const result = await variantInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product),
      contextWithFeatures(true).context,
    )
    expect(result.metadata).toBeUndefined()
  })
})
