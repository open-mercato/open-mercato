import type { RunParameter } from '../adapter'
import {
  getApplicableRunParameters,
  isReservedRunParameterKey,
  normalizeRunParameters,
} from '../run-parameters'

const params: RunParameter[] = [
  { key: 'dryRun', label: 'Dry run', type: 'boolean', defaultValue: false },
  { key: 'startId', label: 'Start id', type: 'number', min: 0 },
  { key: 'note', label: 'Note', type: 'string' },
  { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a' }, { value: 'b' }] },
  { key: 'exportOnly', label: 'Export only', type: 'boolean', direction: 'export' },
]

describe('getApplicableRunParameters', () => {
  it('includes direction-agnostic params and only matching directional params', () => {
    expect(getApplicableRunParameters(params, 'import').map((p) => p.key)).toEqual([
      'dryRun', 'startId', 'note', 'mode',
    ])
    expect(getApplicableRunParameters(params, 'export').map((p) => p.key)).toContain('exportOnly')
  })

  it('returns empty array when nothing is declared', () => {
    expect(getApplicableRunParameters(undefined, 'import')).toEqual([])
  })

  it('scopes params to entity types, keeping unscoped params for every entity', () => {
    const scoped: RunParameter[] = [
      { key: 'shared', label: 'Shared', type: 'boolean' },
      { key: 'bulk', label: 'Bulk', type: 'boolean', entityType: 'orders' },
      { key: 'refData', label: 'Ref data', type: 'boolean', entityType: ['products', 'customers'] },
    ]
    expect(getApplicableRunParameters(scoped, 'import', 'orders').map((p) => p.key)).toEqual(['shared', 'bulk'])
    expect(getApplicableRunParameters(scoped, 'import', 'products').map((p) => p.key)).toEqual(['shared', 'refData'])
    expect(getApplicableRunParameters(scoped, 'import', 'customers').map((p) => p.key)).toEqual(['shared', 'refData'])
    // No entity provided → entity scoping is skipped, everything applicable is returned.
    expect(getApplicableRunParameters(scoped, 'import').map((p) => p.key)).toEqual(['shared', 'bulk', 'refData'])
  })
})

describe('normalizeRunParameters', () => {
  it('coerces values to declared types and drops undeclared keys', () => {
    const result = normalizeRunParameters(params, 'import', {
      dryRun: 'true',
      startId: '42',
      note: '  hello  ',
      mode: 'b',
      unexpected: 'ignored',
    })
    expect(result).toEqual({
      ok: true,
      values: { dryRun: true, startId: 42, note: 'hello', mode: 'b' },
    })
  })

  it('applies defaults for blank values and omits params without a default', () => {
    const result = normalizeRunParameters(params, 'import', { startId: '', note: '' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values).toEqual({ dryRun: false })
    }
  })

  it('errors when a required value is blank with no default', () => {
    const required: RunParameter[] = [{ key: 'cursor', label: 'Cursor', type: 'string', required: true }]
    const result = normalizeRunParameters(required, 'import', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].key).toBe('cursor')
  })

  it('rejects out-of-range numbers and invalid select values', () => {
    const low = normalizeRunParameters(params, 'import', { startId: '-1' })
    expect(low.ok).toBe(false)
    const badSelect = normalizeRunParameters(params, 'import', { mode: 'z' })
    expect(badSelect.ok).toBe(false)
  })

  it('ignores params that do not apply to the run direction', () => {
    const result = normalizeRunParameters(params, 'import', { exportOnly: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect('exportOnly' in result.values).toBe(false)
  })

  it('ignores params scoped to a different entity, even required ones', () => {
    const scoped: RunParameter[] = [
      { key: 'bulk', label: 'Bulk', type: 'boolean', entityType: 'orders' },
      { key: 'refCursor', label: 'Ref cursor', type: 'string', required: true, entityType: 'products' },
    ]
    // Running the `orders` entity: the products-only required param is dropped, not enforced.
    const result = normalizeRunParameters(scoped, 'import', { bulk: 'true', refCursor: 'x' }, 'orders')
    expect(result).toEqual({ ok: true, values: { bulk: true } })
  })
})

describe('machine-readable error codes', () => {
  it('reports a code and interpolation params alongside the English message', () => {
    const result = normalizeRunParameters(params, 'import', { startId: '-1' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toEqual({
        key: 'startId',
        code: 'min',
        params: { label: 'Start id', min: 0 },
        message: 'Start id must be at least 0.',
      })
    }
  })

  it('emits the right code for each failure kind', () => {
    const declared: RunParameter[] = [
      { key: 'need', label: 'Need', type: 'string', required: true },
      { key: 'num', label: 'Num', type: 'number', max: 5 },
      { key: 'pick', label: 'Pick', type: 'select', options: [{ value: 'a' }] },
    ]
    const codeFor = (raw: Record<string, unknown>) => {
      const result = normalizeRunParameters(declared, 'import', raw)
      return result.ok ? null : result.errors[0].code
    }
    expect(codeFor({ num: 3, pick: 'a' })).toBe('required')
    expect(codeFor({ need: 'x', num: 'abc', pick: 'a' })).toBe('type')
    expect(codeFor({ need: 'x', num: 9, pick: 'a' })).toBe('max')
    expect(codeFor({ need: 'x', num: 3, pick: 'z' })).toBe('select')
  })
})

describe('declared defaults are validated like submitted values', () => {
  it('rejects a select default that is not among its own options', () => {
    const result = normalizeRunParameters(
      [{ key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a' }], defaultValue: 'zzz' }],
      'import',
      {},
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].code).toBe('select')
  })

  it('rejects a number default below its own min', () => {
    const result = normalizeRunParameters(
      [{ key: 'n', label: 'N', type: 'number', min: 10, defaultValue: 1 }],
      'import',
      {},
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].code).toBe('min')
  })

  it('still accepts a valid default', () => {
    const result = normalizeRunParameters(
      [{ key: 'n', label: 'N', type: 'number', min: 0, defaultValue: 7 }],
      'import',
      {},
    )
    expect(result).toEqual({ ok: true, values: { n: 7 } })
  })
})

describe('inherited object properties', () => {
  // A parameter named after an Object.prototype member must read as absent when
  // the caller omits it — otherwise the inherited function leaks in as a value.
  const inherited: RunParameter[] = [
    { key: 'toString', label: 'To string', type: 'string' },
    { key: 'valueOf', label: 'Value of', type: 'string', required: true },
  ]

  it('treats an omitted inherited key as blank rather than reading the prototype', () => {
    const result = normalizeRunParameters(inherited, 'import', {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // `valueOf` is required and absent → required, not a coerced function body.
      expect(result.errors).toEqual([
        expect.objectContaining({ key: 'valueOf', code: 'required' }),
      ])
    }
  })

  it('still reads an inherited-name key the caller actually sent', () => {
    const result = normalizeRunParameters(
      [{ key: 'toString', label: 'To string', type: 'string' }],
      'import',
      { toString: 'mine' },
    )
    expect(result).toEqual({ ok: true, values: { toString: 'mine' } })
  })
})

describe('reserved parameter keys', () => {
  // Assigning a primitive to `__proto__` on an object literal is silently
  // discarded, so such a param would disappear between the form and the
  // adapter. It is rejected at declaration instead of vanishing later.
  const reserved: RunParameter[] = [
    { key: '__proto__', label: 'Proto', type: 'string' },
    { key: 'safe', label: 'Safe', type: 'string' },
  ]

  it('flags only __proto__ as reserved', () => {
    expect(isReservedRunParameterKey('__proto__')).toBe(true)
    expect(isReservedRunParameterKey('constructor')).toBe(false)
    expect(isReservedRunParameterKey('startId')).toBe(false)
  })

  it('drops a reserved key from the applicable set', () => {
    expect(getApplicableRunParameters(reserved, 'import').map((p) => p.key)).toEqual(['safe'])
  })

  it('never emits a reserved key from the normalizer', () => {
    const result = normalizeRunParameters(reserved, 'import', { __proto__: 'x', safe: 'ok' })
    expect(result).toEqual({ ok: true, values: { safe: 'ok' } })
  })

  it('does not enforce a reserved key declared as required', () => {
    const result = normalizeRunParameters(
      [{ key: '__proto__', label: 'Proto', type: 'string', required: true }],
      'import',
      {},
    )
    expect(result).toEqual({ ok: true, values: {} })
  })

  it('leaves Object.prototype untouched and allows constructor as an ordinary key', () => {
    const result = normalizeRunParameters(
      [{ key: 'constructor', label: 'Ctor', type: 'string' }],
      'import',
      { constructor: 'plain' },
    )
    expect(result).toEqual({ ok: true, values: { constructor: 'plain' } })
    expect((({}) as Record<string, unknown>).polluted).toBeUndefined()
  })
})
