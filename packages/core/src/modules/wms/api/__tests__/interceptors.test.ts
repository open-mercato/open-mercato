import { E } from '#generated/entities.ids.generated'
import interceptors from '../interceptors'
import {
  WMS_CATALOG_PROFILE_HEADER,
  encodeCatalogInventoryProfileIntent,
} from '../../lib/catalogInventoryProfileIntent'
import type { InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'

const [productInterceptor, variantInterceptor] = interceptors

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
  it('product interceptor honors an intent computed by the product form', async () => {
    const result = await productInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product),
      {} as never,
    )
    expect(result.metadata?.intent).toBeTruthy()
  })

  it('product interceptor ignores an intent leaked from a different host form', async () => {
    const result = await productInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product_variant),
      {} as never,
    )
    expect(result.metadata).toBeUndefined()
  })

  it('variant interceptor honors an intent computed by the variant form', async () => {
    const result = await variantInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product_variant),
      {} as never,
    )
    expect(result.metadata?.intent).toBeTruthy()
  })

  it('variant interceptor ignores an intent leaked from the product form (the duplicate-profile bug, #7434)', async () => {
    const result = await variantInterceptor.before!(
      requestWithIntent(E.catalog.catalog_product),
      {} as never,
    )
    expect(result.metadata).toBeUndefined()
  })
})
