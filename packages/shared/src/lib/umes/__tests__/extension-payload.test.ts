import {
  EXTENSION_PAYLOAD_TRANSPORT_KEY,
  extractExtensionPayload,
  mergeExtensionPayload,
  sanitizeExtensionPayload,
} from '../extension-payload'

describe('sanitizeExtensionPayload', () => {
  it('never re-parents the payload when a module id is a prototype key', () => {
    const hostile = JSON.parse('{"__proto__":{"hasOwnProperty":1,"toString":2},"relations":{"a":1}}')

    const sanitized = sanitizeExtensionPayload(hostile)

    expect(sanitized).toEqual({ relations: { a: 1 } })
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype)
    expect(sanitized!.hasOwnProperty('relations')).toBe(true)
    expect(String(sanitized)).toBe('[object Object]')
    expect(({} as Record<string, unknown>).hasOwnProperty).toBe(Object.prototype.hasOwnProperty)
  })

  it('never re-parents nested module payloads through prototype keys', () => {
    const hostile = JSON.parse('{"relations":{"__proto__":{"toString":1},"a":{"__proto__":{"toString":2},"b":1}}}')

    const sanitized = sanitizeExtensionPayload(hostile)

    expect(sanitized).toEqual({ relations: { a: { b: 1 } } })
    expect(Object.getPrototypeOf(sanitized!.relations)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(sanitized!.relations.a as object)).toBe(Object.prototype)
  })

  it('drops module payloads that only carry prototype keys', () => {
    expect(sanitizeExtensionPayload(JSON.parse('{"__proto__":{"toString":1}}'))).toBeUndefined()
  })

  it('counts array elements against the key cap', () => {
    const sanitized = sanitizeExtensionPayload({ relations: { items: Array.from({ length: 5000 }, (_, index) => index) } })

    expect((sanitized!.relations.items as unknown[]).length).toBe(200)
  })

  it('counts array elements nested in objects against the same budget', () => {
    const sanitized = sanitizeExtensionPayload({
      relations: { first: Array.from({ length: 150 }, () => 'x'), second: Array.from({ length: 150 }, () => 'y') },
    })

    const first = sanitized!.relations.first as unknown[]
    const second = sanitized!.relations.second as unknown[]
    expect(first.length + second.length).toBeLessThanOrEqual(200)
    expect(second.length).toBeLessThan(150)
  })
})

describe('mergeExtensionPayload', () => {
  it('never re-parents the merged payload when a module id is a prototype key', () => {
    const merged = mergeExtensionPayload(
      JSON.parse('{"__proto__":{"toString":1},"relations":{"a":1}}'),
      JSON.parse('{"__proto__":{"toString":2},"relations":{"b":2}}'),
    )

    expect(merged).toEqual({ relations: { a: 1, b: 2 } })
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(String(merged)).toBe('[object Object]')
  })
})

describe('extractExtensionPayload', () => {
  it('sanitizes the transport payload before any interceptor sees it', () => {
    const { entityBody, extensionPayload } = extractExtensionPayload(
      JSON.parse(`{"title":"x","${EXTENSION_PAYLOAD_TRANSPORT_KEY}":{"__proto__":{"hasOwnProperty":1},"relations":{"a":1}}}`),
    )

    expect(entityBody).toEqual({ title: 'x' })
    expect(extensionPayload).toEqual({ relations: { a: 1 } })
    expect(Object.getPrototypeOf(extensionPayload)).toBe(Object.prototype)
  })
})
