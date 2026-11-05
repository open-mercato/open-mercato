import { truncateResult } from '../truncate'

describe('truncateResult', () => {
  it('serializes simple values', () => {
    expect(truncateResult(42)).toBe('42')
    expect(truncateResult('hello')).toBe('"hello"')
    expect(truncateResult(true)).toBe('true')
    expect(truncateResult(null)).toBe('null')
  })

  it('returns "undefined" for undefined', () => {
    expect(truncateResult(undefined)).toBe('undefined')
  })

  it('serializes objects with pretty printing', () => {
    const result = truncateResult({ a: 1, b: 2 })
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
    expect(result).toContain('\n') // pretty printed
  })

  it('serializes arrays', () => {
    const result = truncateResult([1, 2, 3])
    expect(JSON.parse(result)).toEqual([1, 2, 3])
  })

  it('truncates large output', () => {
    const largeArray = Array.from({ length: 10000 }, (_, i) => ({
      id: `item-${i}`,
      name: `Item number ${i} with some extra text`,
    }))
    const result = truncateResult(largeArray)
    expect(result.length).toBeLessThanOrEqual(40_100) // ~40K + truncation message
    expect(result).toContain('truncated')
  })

  it('respects custom maxChars', () => {
    const data = { message: 'x'.repeat(200) }
    const result = truncateResult(data, 100)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result).toContain('truncated')
  })

  it('does not truncate small output', () => {
    const data = { name: 'test', count: 42 }
    const result = truncateResult(data)
    expect(result).not.toContain('truncated')
    expect(JSON.parse(result)).toEqual(data)
  })

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { name: 'test' }
    obj.self = obj
    const result = truncateResult(obj)
    expect(result).toContain('[Circular]')
    expect(result).toContain('test')
  })

  it('handles non-serializable values', () => {
    const result = truncateResult(BigInt(42))
    expect(typeof result).toBe('string')
  })

  it('handles nested objects', () => {
    const data = {
      company: {
        name: 'ACME',
        address: { city: 'New York', country: 'US' },
        contacts: [{ name: 'John' }, { name: 'Jane' }],
      },
    }
    const result = truncateResult(data)
    const parsed = JSON.parse(result)
    expect(parsed.company.address.city).toBe('New York')
    expect(parsed.company.contacts).toHaveLength(2)
  })
})
