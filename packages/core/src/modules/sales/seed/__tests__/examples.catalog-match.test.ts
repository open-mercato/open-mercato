import { isMissingCatalogMatch, listExampleCatalogReferences } from '../examples'
import { listCatalogExampleKeys } from '../../../catalog/seed/examples'

describe('sales example seed catalog references', () => {
  const catalog = listCatalogExampleKeys()
  const variantSkus = new Set(catalog.variantSkus.map((sku) => sku.toLowerCase()))
  const productHandles = new Set(catalog.productHandles.map((handle) => handle.toLowerCase()))
  const references = listExampleCatalogReferences()

  it('resolves every catalog-backed line to a seeded catalog variant or product', () => {
    const unresolved = references
      .filter((ref) => !ref.custom)
      .filter((ref) => {
        if (ref.variantSku) return !variantSkus.has(ref.variantSku.toLowerCase())
        if (ref.productHandle) return !productHandles.has(ref.productHandle.toLowerCase())
        return true
      })
      .map((ref) => `${ref.document}: ${ref.line}`)
    expect(unresolved).toEqual([])
  })

  it('does not attach catalog references to deliberately custom lines', () => {
    const conflicting = references
      .filter((ref) => ref.custom && (ref.variantSku || ref.productHandle))
      .map((ref) => `${ref.document}: ${ref.line}`)
    expect(conflicting).toEqual([])
  })

  it('links the haircut service lines to the seeded service variant', () => {
    const haircut = references.filter((ref) => ref.line === 'Signature Haircut & Finish')
    expect(haircut.length).toBeGreaterThan(0)
    haircut.forEach((ref) => expect(ref.variantSku).toBe('SERV-HAIR-60-SENIOR'))
  })
})

describe('isMissingCatalogMatch', () => {
  it('warns for unresolved product lines', () => {
    expect(isMissingCatalogMatch({}, { productId: null })).toBe(true)
    expect(isMissingCatalogMatch({ kind: 'product' }, { productId: null })).toBe(true)
  })

  it('does not warn for resolved, custom, or non-product lines', () => {
    expect(isMissingCatalogMatch({}, { productId: 'product-1' })).toBe(false)
    expect(isMissingCatalogMatch({ custom: true }, { productId: null })).toBe(false)
    expect(isMissingCatalogMatch({ kind: 'service' }, { productId: null })).toBe(false)
  })
})
