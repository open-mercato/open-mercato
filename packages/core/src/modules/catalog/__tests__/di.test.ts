import { register } from '../di'
import { CatalogProduct, CatalogProductPrice, CatalogProductVariant } from '../data/entities'

describe('catalog di.ts', () => {
  it('exposes the product, price and variant entity classes for soft-resolving modules', () => {
    const registerMock = jest.fn()

    register({ register: registerMock } as unknown as Parameters<typeof register>[0])

    const registrations = registerMock.mock.calls[0][0] as Record<string, { resolve: (container: unknown) => unknown }>
    expect(registrations.CatalogProduct.resolve({})).toBe(CatalogProduct)
    expect(registrations.CatalogProductPrice.resolve({})).toBe(CatalogProductPrice)
    expect(registrations.CatalogProductVariant.resolve({})).toBe(CatalogProductVariant)
  })
})
