import { normalizeProductDimensions, normalizeProductWeight } from '../productForm'

describe('product form measurement normalizers', () => {
  it('normalizes dimensions from object payloads', () => {
    expect(normalizeProductDimensions({ width: '10', height: 5, depth: 1.5, unit: ' cm ' })).toEqual({
      width: 10,
      height: 5,
      depth: 1.5,
      unit: 'cm',
    })
  })

  it('normalizes dimensions from JSON string payloads', () => {
    expect(normalizeProductDimensions('{"width":"9.5","height":4,"unit":"mm"}')).toEqual({
      width: 9.5,
      height: 4,
      unit: 'mm',
    })
  })

  it('normalizes weight from JSON string payloads', () => {
    expect(normalizeProductWeight('{"value":"1.25","unit":"kg"}')).toEqual({
      value: 1.25,
      unit: 'kg',
    })
  })

  it('returns null for invalid JSON string payloads', () => {
    expect(normalizeProductDimensions('not-json')).toBeNull()
    expect(normalizeProductWeight('not-json')).toBeNull()
  })
})
