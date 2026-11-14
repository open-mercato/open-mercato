import { register } from '../di'
import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from '../data/entities'
import { DefaultCatalogOmnibusService } from '../services/catalogOmnibusService'

describe('catalog di.ts', () => {
  it('exposes the product, price and variant entity classes for soft-resolving modules', () => {
    const registerMock = jest.fn()

    register({ register: registerMock } as unknown as Parameters<typeof register>[0])

    const registrations = registerMock.mock.calls[0][0] as Record<string, { resolve: (container: unknown) => unknown }>
    expect(registrations.CatalogProduct.resolve({})).toBe(CatalogProduct)
    expect(registrations.CatalogProductPrice.resolve({})).toBe(CatalogProductPrice)
    expect(registrations.CatalogProductVariant.resolve({})).toBe(CatalogProductVariant)
  })

  it('registers catalogOmnibusService and tolerates absent config and cache services', () => {
    const registerMock = jest.fn()

    register({ register: registerMock } as unknown as Parameters<typeof register>[0])

    const registrations = registerMock.mock.calls[0][0] as Record<string, { resolve: (container: unknown) => unknown }>
    const cradle = new Proxy(
      {},
      {
        get: () => {
          throw new Error('not registered')
        },
      },
    )
    const service = registrations.catalogOmnibusService.resolve({ cradle, resolve: () => undefined })
    expect(service).toBeInstanceOf(DefaultCatalogOmnibusService)
  })
})
