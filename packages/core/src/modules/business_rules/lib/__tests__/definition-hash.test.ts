import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { createHash } from 'node:crypto'
import {
  canonicalizeRuleDefinition,
  computeRuleDefinitionHash,
  type RuleDefinitionHashSource,
  type RuleDefinitionSource,
} from '../definition-hash'

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto')
  return { ...actual, createHash: jest.fn(actual.createHash) }
})

const createHashMock = jest.mocked(createHash)

const baseDefinition: RuleDefinitionSource = {
  ruleType: 'ACTION',
  entityType: 'customers.person',
  eventType: 'updated',
  conditionExpression: {
    operator: 'AND',
    rules: [
      { field: 'status', operator: '=', value: 'ACTIVE' },
      { field: 'score', operator: '>', value: 10 },
    ],
  },
  successActions: [
    { type: 'CALL_OPEN_MERCATO', config: { endpoint: '/api/customers/companies', method: 'PUT', apiKeyId: 'key-1' } },
  ],
  failureActions: [{ type: 'LOG', config: { level: 'info', message: 'skipped' } }],
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  enabled: true,
}

describe('computeRuleDefinitionHash', () => {
  test('returns a 64-character lowercase sha256 hex digest', () => {
    expect(computeRuleDefinitionHash(baseDefinition)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('is deterministic across calls', () => {
    expect(computeRuleDefinitionHash(baseDefinition)).toBe(computeRuleDefinitionHash({ ...baseDefinition }))
  })

  test('ignores key order at every nesting level', () => {
    const reordered: RuleDefinitionSource = {
      enabled: true,
      effectiveTo: null,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      failureActions: [{ config: { message: 'skipped', level: 'info' }, type: 'LOG' }],
      successActions: [
        { config: { apiKeyId: 'key-1', method: 'PUT', endpoint: '/api/customers/companies' }, type: 'CALL_OPEN_MERCATO' },
      ],
      conditionExpression: {
        rules: [
          { value: 'ACTIVE', operator: '=', field: 'status' },
          { value: 10, field: 'score', operator: '>' },
        ],
        operator: 'AND',
      },
      eventType: 'updated',
      entityType: 'customers.person',
      ruleType: 'ACTION',
    }
    expect(computeRuleDefinitionHash(reordered)).toBe(computeRuleDefinitionHash(baseDefinition))
  })

  test('changes when the condition expression changes', () => {
    const changed: RuleDefinitionSource = {
      ...baseDefinition,
      conditionExpression: {
        operator: 'AND',
        rules: [
          { field: 'status', operator: '=', value: 'INACTIVE' },
          { field: 'score', operator: '>', value: 10 },
        ],
      },
    }
    expect(computeRuleDefinitionHash(changed)).not.toBe(computeRuleDefinitionHash(baseDefinition))
  })

  test('keeps array order significant', () => {
    const swapped: RuleDefinitionSource = {
      ...baseDefinition,
      conditionExpression: {
        operator: 'AND',
        rules: [
          { field: 'score', operator: '>', value: 10 },
          { field: 'status', operator: '=', value: 'ACTIVE' },
        ],
      },
    }
    expect(computeRuleDefinitionHash(swapped)).not.toBe(computeRuleDefinitionHash(baseDefinition))
  })

  test.each([
    ['ruleType', { ruleType: 'GUARD' }],
    ['entityType', { entityType: 'customers.company' }],
    ['eventType', { eventType: 'created' }],
    ['successActions', { successActions: [] }],
    ['failureActions', { failureActions: null }],
    ['effectiveFrom', { effectiveFrom: new Date('2026-02-01T00:00:00.000Z') }],
    ['effectiveTo', { effectiveTo: new Date('2027-01-01T00:00:00.000Z') }],
    ['enabled', { enabled: false }],
  ] as Array<[string, Partial<RuleDefinitionSource>]>)('changes when %s changes', (_field, override) => {
    const changed: RuleDefinitionSource = { ...baseDefinition, ...override }
    expect(computeRuleDefinitionHash(changed)).not.toBe(computeRuleDefinitionHash(baseDefinition))
  })

  test('ignores fields outside the executable definition', () => {
    const withMetadata = {
      ...baseDefinition,
      ruleName: 'Renamed rule',
      description: 'Only a label change',
      priority: 5,
      version: 7,
      updatedAt: new Date(),
    }
    expect(computeRuleDefinitionHash(withMetadata)).toBe(computeRuleDefinitionHash(baseDefinition))
  })

  test('treats missing and null optional fields the same', () => {
    const withNulls: RuleDefinitionSource = {
      ruleType: 'GUARD',
      entityType: 'sales.order',
      eventType: null,
      conditionExpression: null,
      successActions: null,
      failureActions: null,
      effectiveFrom: null,
      effectiveTo: null,
      enabled: null,
    }
    const withMissing: RuleDefinitionSource = { ruleType: 'GUARD', entityType: 'sales.order' }
    expect(computeRuleDefinitionHash(withMissing)).toBe(computeRuleDefinitionHash(withNulls))
  })

  test('normalizes equivalent date representations', () => {
    const fromString: RuleDefinitionSource = { ...baseDefinition, effectiveFrom: '2026-01-01T00:00:00Z' }
    expect(computeRuleDefinitionHash(fromString)).toBe(computeRuleDefinitionHash(baseDefinition))
  })

  test('drops undefined object members like JSON serialization', () => {
    const withUndefined: RuleDefinitionSource = {
      ...baseDefinition,
      conditionExpression: { operator: 'AND', rules: [], note: undefined },
    }
    const withoutUndefined: RuleDefinitionSource = {
      ...baseDefinition,
      conditionExpression: { operator: 'AND', rules: [] },
    }
    expect(computeRuleDefinitionHash(withUndefined)).toBe(computeRuleDefinitionHash(withoutUndefined))
  })

  test('does not throw on circular structures', () => {
    const circular: Record<string, unknown> = { field: 'status' }
    circular.self = circular
    const definition: RuleDefinitionSource = { ...baseDefinition, conditionExpression: circular }
    expect(() => computeRuleDefinitionHash(definition)).not.toThrow()
    expect(canonicalizeRuleDefinition(definition)).toContain('"[Circular]"')
  })

  test('serializes shared non-circular references in full', () => {
    const shared = { field: 'status', operator: '=', value: 'ACTIVE' }
    const definition: RuleDefinitionSource = {
      ...baseDefinition,
      conditionExpression: { operator: 'OR', rules: [shared, shared] },
    }
    expect(canonicalizeRuleDefinition(definition)).not.toContain('[Circular]')
  })
})

describe('computeRuleDefinitionHash golden digest', () => {
  const goldenCanonical =
    '{"conditionExpression":{"operator":"AND","rules":[{"field":"status","operator":"=","value":"ACTIVE"},' +
    '{"field":"score","operator":">","value":10}]},"effectiveFrom":"2026-01-01T00:00:00.000Z","effectiveTo":null,' +
    '"enabled":true,"entityType":"customers.person","eventType":"updated",' +
    '"failureActions":[{"config":{"level":"info","message":"skipped"},"type":"LOG"}],"hashVersion":1,' +
    '"ruleType":"ACTION","successActions":[{"config":{"apiKeyId":"key-1","endpoint":"/api/customers/companies",' +
    '"method":"PUT"},"type":"CALL_OPEN_MERCATO"}]}'
  const goldenDigest = '244db74be96c3402b8f2d8eb70ca523a8ceca57ffc2d5a0857321f57b95062c6'

  test('canonicalizes a fixed rule definition to the recorded form', () => {
    expect(canonicalizeRuleDefinition(baseDefinition)).toBe(goldenCanonical)
  })

  test('hashes a fixed rule definition to the recorded sha256 digest', () => {
    expect(computeRuleDefinitionHash({ ...baseDefinition })).toBe(goldenDigest)
  })
})

describe('computeRuleDefinitionHash memoization', () => {
  function buildRule(overrides: Partial<RuleDefinitionHashSource> = {}): RuleDefinitionHashSource {
    return {
      ...baseDefinition,
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      version: 3,
      ...overrides,
    }
  }

  beforeEach(() => {
    createHashMock.mockClear()
  })

  test('hashes a rule object once while it is unchanged', () => {
    const rule = buildRule()

    const first = computeRuleDefinitionHash(rule)
    const second = computeRuleDefinitionHash(rule)

    expect(second).toBe(first)
    expect(createHashMock).toHaveBeenCalledTimes(1)
  })

  test('returns the same digest as an unmemoized computation', () => {
    const rule = buildRule()
    computeRuleDefinitionHash(rule)

    expect(computeRuleDefinitionHash(rule)).toBe(computeRuleDefinitionHash(structuredClone(rule)))
  })

  test('keeps memoized digests per rule object', () => {
    const first = buildRule()
    const second = buildRule({ ruleType: 'GUARD' })

    const firstHash = computeRuleDefinitionHash(first)
    const secondHash = computeRuleDefinitionHash(second)

    expect(secondHash).not.toBe(firstHash)
    expect(computeRuleDefinitionHash(first)).toBe(firstHash)
    expect(computeRuleDefinitionHash(second)).toBe(secondHash)
    expect(createHashMock).toHaveBeenCalledTimes(2)
  })

  test('recomputes when updatedAt changes', () => {
    const rule = buildRule()
    computeRuleDefinitionHash(rule)

    rule.updatedAt = new Date('2026-10-02T00:00:00.000Z')
    computeRuleDefinitionHash(rule)

    expect(createHashMock).toHaveBeenCalledTimes(2)
  })

  test('recomputes when the version changes', () => {
    const rule = buildRule()
    computeRuleDefinitionHash(rule)

    rule.version = 4
    computeRuleDefinitionHash(rule)

    expect(createHashMock).toHaveBeenCalledTimes(2)
  })

  test('picks up a reassigned definition field even without an updatedAt bump', () => {
    const rule = buildRule()
    const before = computeRuleDefinitionHash(rule)

    rule.conditionExpression = { field: 'status', operator: '=', value: 'INACTIVE' }
    const after = computeRuleDefinitionHash(rule)

    expect(after).not.toBe(before)
    expect(after).toBe(computeRuleDefinitionHash(structuredClone(rule)))
  })

  test('picks up a changed scalar field even without an updatedAt bump', () => {
    const rule = buildRule()
    const before = computeRuleDefinitionHash(rule)

    rule.enabled = false

    expect(computeRuleDefinitionHash(rule)).not.toBe(before)
  })

  test('reuses the digest when updatedAt is reassigned to an equal timestamp', () => {
    const rule = buildRule()
    computeRuleDefinitionHash(rule)

    rule.updatedAt = new Date('2026-10-01T00:00:00.000Z')
    computeRuleDefinitionHash(rule)

    expect(createHashMock).toHaveBeenCalledTimes(1)
  })
})
