import { describe, test, expect, jest, beforeEach } from '@jest/globals'

type CapturedLogCall = { msg: string; fields?: Record<string, unknown> }

const mockDebugCalls: CapturedLogCall[] = []

jest.mock('@open-mercato/shared/lib/logger', () => {
  const makeLogger = () => ({
    debug: (msg: string, fields?: Record<string, unknown>) => {
      mockDebugCalls.push({ msg, fields })
    },
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => makeLogger(),
  })
  return { createLogger: () => makeLogger(), isLevelEnabled: () => true }
})

import { evaluateExpression, type SimpleCondition } from '../expression-evaluator'
import { evaluateSingleRule } from '../rule-evaluator'
import type { BusinessRule } from '../../data/entities'

const createTestRule = (overrides: Partial<BusinessRule> = {}): BusinessRule =>
  ({
    id: 'test-id',
    ruleId: 'TEST-001',
    ruleName: 'Test Rule',
    ruleType: 'GUARD',
    entityType: 'customers_person',
    conditionExpression: { field: 'primary_email', operator: '=', value: 'john.doe@example.com' },
    enabled: true,
    priority: 100,
    version: 1,
    tenantId: 'tenant-123',
    organizationId: 'org-456',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as BusinessRule

const piiData = {
  primary_email: 'john.doe@example.com',
  phone_number: '+48600100200',
  street_address: '1 Secret Street',
}

const piiCondition: SimpleCondition = {
  field: 'primary_email',
  operator: '=',
  value: 'john.doe@example.com',
}

const serializedCalls = (): string[] => mockDebugCalls.map((call) => JSON.stringify(call))

describe('rule evaluation logging hygiene', () => {
  beforeEach(() => {
    mockDebugCalls.length = 0
  })

  test('simple condition debug logs carry no raw entity values', () => {
    const passed = evaluateExpression(piiCondition, piiData, {})
    expect(passed).toBe(true)
    expect(mockDebugCalls.length).toBeGreaterThan(0)

    for (const payload of serializedCalls()) {
      expect(payload).not.toContain('john.doe@example.com')
      expect(payload).not.toContain('+48600100200')
      expect(payload).not.toContain('1 Secret Street')
    }

    const loggedKeys = mockDebugCalls.flatMap((call) => Object.keys(call.fields ?? {}))
    expect(loggedKeys).not.toContain('actualValue')
    expect(loggedKeys).not.toContain('expectedValue')

    const conditionLog = mockDebugCalls.find((call) => call.msg === 'Simple condition evaluated')
    expect(conditionLog).toBeDefined()
    expect(conditionLog?.fields).toMatchObject({
      field: 'primary_email',
      operator: '=',
      passed: true,
    })
  })

  test('single rule evaluation logs do not expose condition expressions or entity values', async () => {
    const rule = createTestRule({ conditionExpression: piiCondition })

    const result = await evaluateSingleRule(rule, piiData, {})
    expect(result.conditionsPassed).toBe(true)
    expect(mockDebugCalls.length).toBeGreaterThan(0)

    for (const payload of serializedCalls()) {
      expect(payload).not.toContain('john.doe@example.com')
      expect(payload).not.toContain('+48600100200')
      expect(payload).not.toContain('1 Secret Street')
    }

    const loggedKeys = mockDebugCalls.flatMap((call) => Object.keys(call.fields ?? {}))
    expect(loggedKeys).not.toContain('conditions')

    const evaluatingLog = mockDebugCalls.find((call) => call.msg === 'Evaluating rule')
    expect(evaluatingLog).toBeDefined()
    expect(evaluatingLog?.fields).toMatchObject({ ruleId: 'TEST-001', ruleType: 'GUARD' })
  })
})
