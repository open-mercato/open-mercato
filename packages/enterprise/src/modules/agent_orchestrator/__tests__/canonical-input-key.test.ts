/** @jest-environment node */
import { canonicalInputKey } from '../lib/eval/canonicalInputKey'

describe('canonicalInputKey', () => {
  it('is stable across top-level object key order', () => {
    expect(canonicalInputKey({ a: 1, b: 2 })).toBe(canonicalInputKey({ b: 2, a: 1 }))
  })

  it('is stable across nested object key order', () => {
    const left = { outer: { x: 1, y: { m: 1, n: 2 } }, list: [1, 2] }
    const right = { list: [1, 2], outer: { y: { n: 2, m: 1 }, x: 1 } }
    expect(canonicalInputKey(left)).toBe(canonicalInputKey(right))
  })

  it('distinguishes different values', () => {
    expect(canonicalInputKey({ a: 1 })).not.toBe(canonicalInputKey({ a: 2 }))
  })

  it('treats array order as significant', () => {
    expect(canonicalInputKey({ list: [1, 2] })).not.toBe(canonicalInputKey({ list: [2, 1] }))
  })

  it('handles primitives and null deterministically', () => {
    expect(canonicalInputKey('x')).toBe(canonicalInputKey('x'))
    expect(canonicalInputKey(null)).toBe(canonicalInputKey(null))
    expect(canonicalInputKey(undefined)).toBe(canonicalInputKey(null))
    expect(canonicalInputKey(1)).not.toBe(canonicalInputKey('1'))
  })

  it('ignores undefined-valued keys (JSON.stringify parity)', () => {
    expect(canonicalInputKey({ a: 1, b: undefined })).toBe(canonicalInputKey({ a: 1 }))
  })

  it('returns a 64-char sha-256 hex digest', () => {
    expect(canonicalInputKey({ claim: 'CLM-1' })).toMatch(/^[0-9a-f]{64}$/)
  })
})
