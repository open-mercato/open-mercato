import { z } from 'zod'
import {
  formatIntegrityPath,
  isValidIntegrityPath,
  parseIntegrityPath,
  readAll,
  removeAllAt,
  removeAt,
  validatePathAgainstSchema,
  writeAt,
} from '../lib/guardrails/integrity/paths'

const sample = () => ({
  findings: [
    { ruleId: 'r1', evidence: [{ quote: 'alpha' }, { quote: 'beta' }] },
    { ruleId: 'r2', evidence: [{ quote: 'gamma' }] },
  ],
  meta: { count: 2 },
})

describe('parseIntegrityPath', () => {
  it('parses keys, wildcards and indexes', () => {
    expect(parseIntegrityPath('findings[*].evidence[0].quote')).toEqual([
      { type: 'key', name: 'findings' },
      { type: 'wildcard' },
      { type: 'key', name: 'evidence' },
      { type: 'index', index: 0 },
      { type: 'key', name: 'quote' },
    ])
    expect(parseIntegrityPath('[*].id')).toEqual([{ type: 'wildcard' }, { type: 'key', name: 'id' }])
    expect(parseIntegrityPath('matrix[*][*]')).toEqual([
      { type: 'key', name: 'matrix' },
      { type: 'wildcard' },
      { type: 'wildcard' },
    ])
  })

  it('round-trips through formatIntegrityPath', () => {
    for (const path of ['a', 'a.b', 'a[*].b[2].c', '[*].id', 'm[*][*]']) {
      expect(formatIntegrityPath(parseIntegrityPath(path))).toBe(path)
    }
  })

  it.each(['', 'a..b', 'a.', '.a', 'a[?(@.x)]', 'a[-1]', 'a[*', 'a.**', 'a.b c', 'a.[*]'])('rejects %p', (path) => {
    expect(isValidIntegrityPath(path)).toBe(false)
  })

  it.each(['__proto__', 'a.constructor', 'a[*].prototype.b'])('rejects the unsafe path %p', (path) => {
    expect(() => parseIntegrityPath(path)).toThrow(/unsafe integrity path segment/)
  })
})

describe('readAll', () => {
  it('expands wildcards into concrete paths', () => {
    expect(readAll(sample(), 'findings[*].evidence[*].quote')).toEqual([
      { value: 'alpha', concretePath: 'findings[0].evidence[0].quote' },
      { value: 'beta', concretePath: 'findings[0].evidence[1].quote' },
      { value: 'gamma', concretePath: 'findings[1].evidence[0].quote' },
    ])
  })

  it('reads indexes, nested arrays and root arrays', () => {
    expect(readAll(sample(), 'findings[1].ruleId')).toEqual([{ value: 'r2', concretePath: 'findings[1].ruleId' }])
    expect(readAll({ grid: [[1, 2], [3]] }, 'grid[*][*]').map((match) => match.concretePath)).toEqual([
      'grid[0][0]',
      'grid[0][1]',
      'grid[1][0]',
    ])
    expect(readAll([{ id: 'x' }, { id: 'y' }], '[*].id').map((match) => match.value)).toEqual(['x', 'y'])
  })

  it('yields no match for missing keys, out-of-range indexes and type mismatches', () => {
    expect(readAll(sample(), 'findings[*].missing')).toEqual([])
    expect(readAll(sample(), 'findings[5].ruleId')).toEqual([])
    expect(readAll(sample(), 'meta[*]')).toEqual([])
    expect(readAll(sample(), 'meta.count.deeper')).toEqual([])
    expect(readAll(null, 'a')).toEqual([])
  })

  it('never reads inherited properties', () => {
    expect(readAll({}, 'toString')).toEqual([])
  })
})

describe('writeAt', () => {
  it('returns a copy and leaves the input untouched', () => {
    const input = sample()
    const snapshot = JSON.parse(JSON.stringify(input))
    const output = writeAt(input, 'findings[0].evidence[1].quote', 'BETA') as ReturnType<typeof sample>
    expect(input).toEqual(snapshot)
    expect(output.findings[0].evidence[1].quote).toBe('BETA')
    expect(output.findings[1]).toBe(input.findings[1])
    expect(output.findings[0]).not.toBe(input.findings[0])
  })

  it('creates a missing final key but not missing intermediates', () => {
    const output = writeAt(sample(), 'findings[0].evidence[0].start', 4) as { findings: Array<{ evidence: Array<Record<string, unknown>> }> }
    expect(output.findings[0].evidence[0].start).toBe(4)
    expect(() => writeAt(sample(), 'findings[0].missing.start', 4)).toThrow(/missing/)
    expect(() => writeAt(sample(), 'findings[7].ruleId', 'x')).toThrow(/out of range/)
  })

  it('rejects wildcard and unsafe paths', () => {
    expect(() => writeAt(sample(), 'findings[*].ruleId', 'x')).toThrow(/concrete integrity path expected/)
    expect(() => writeAt({}, '__proto__.polluted', true)).toThrow(/unsafe/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('removeAt / removeAllAt', () => {
  it('drops an array item immutably', () => {
    const input = sample()
    const output = removeAt(input, 'findings[0].evidence[0]') as ReturnType<typeof sample>
    expect(output.findings[0].evidence).toEqual([{ quote: 'beta' }])
    expect(input.findings[0].evidence).toHaveLength(2)
  })

  it('requires the path to end in an index', () => {
    expect(() => removeAt(sample(), 'findings[0].ruleId')).toThrow(/must end in an array index/)
    expect(() => removeAt(sample(), 'findings[9]')).toThrow(/out of range/)
  })

  it('removes several items without index drift', () => {
    const input = sample()
    const output = removeAllAt(input, [
      'findings[0].evidence[0]',
      'findings[0].evidence[1]',
      'findings[1]',
      'findings[1]',
    ]) as ReturnType<typeof sample>
    expect(output).toEqual({ findings: [{ ruleId: 'r1', evidence: [] }], meta: { count: 2 } })
    expect(input.findings).toHaveLength(2)
  })
})

describe('validatePathAgainstSchema', () => {
  const evidence = z.object({ quote: z.string(), start: z.number().int().optional() })
  const schema = z.object({
    kind: z.literal('research'),
    data: z.object({
      findings: z
        .array(
          z.object({
            ruleId: z.string(),
            evidence: z.array(evidence).default([]),
            notes: z.string().nullable().optional(),
          }),
        )
        .optional(),
      extra: z.record(z.string(), z.object({ id: z.string() })),
      loose: z.unknown(),
      later: z.lazy(() => z.object({ value: z.string() })),
      transformed: z.object({ inner: z.string() }).transform((value) => value),
      variant: z.discriminatedUnion('type', [
        z.object({ type: z.literal('a'), alpha: z.string() }),
        z.object({ type: z.literal('b'), beta: z.string() }),
      ]),
      frozen: z.object({ items: z.array(z.string()) }).readonly(),
    }),
  })

  it.each([
    'data.findings[*].evidence[*].quote',
    'data.findings[0].notes',
    'data.extra.anyKey.id',
    'data.loose.anything[*].goes',
    'data.later.value',
    'data.transformed.inner',
    'data.variant.alpha',
    'data.variant.beta',
    'data.frozen.items[*]',
  ])('accepts %p', (path) => {
    expect(validatePathAgainstSchema(schema, path).ok).toBe(true)
  })

  it('returns the unwrapped leaf schemas', () => {
    const check = validatePathAgainstSchema(schema, 'data.findings[*].evidence[*]')
    expect(check.ok).toBe(true)
    if (check.ok) {
      expect(check.leaves).toHaveLength(1)
      expect(validatePathAgainstSchema(check.leaves[0], 'start').ok).toBe(true)
      expect(validatePathAgainstSchema(check.leaves[0], 'missing').ok).toBe(false)
    }
  })

  it('reports the failing segment', () => {
    expect(validatePathAgainstSchema(schema, 'data.findings[*].ruleIds')).toEqual({
      ok: false,
      segment: 'ruleIds',
      segmentIndex: 3,
    })
    expect(validatePathAgainstSchema(schema, 'data.findings.ruleId')).toMatchObject({ ok: false, segment: 'ruleId' })
    expect(validatePathAgainstSchema(schema, 'data.findings[*].ruleId[*]')).toMatchObject({ ok: false, segment: '[*]' })
    expect(validatePathAgainstSchema(schema, 'data.variant.gamma')).toMatchObject({ ok: false, segment: 'gamma' })
  })
})
