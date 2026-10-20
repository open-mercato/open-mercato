import { describe, expect, test } from '@jest/globals'
import { businessRuleDefinitionSchema } from '../validators'

const validDefinition = {
  ruleId: 'DEAL_WON_GUARD',
  ruleName: 'Block winning deals without value',
  description: 'Deals need a value before they can be won',
  ruleType: 'GUARD',
  ruleCategory: 'sales',
  entityType: 'customers.deal',
  eventType: 'updated',
  conditionExpression: {
    operator: 'AND',
    rules: [
      { field: 'status', operator: '=', value: 'won' },
      { field: 'valueAmount', operator: 'IS_EMPTY', value: null },
    ],
  },
  successActions: [{ type: 'BLOCK_TRANSITION', config: { message: 'Value required' } }],
  failureActions: null,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: '2026-12-31T00:00:00.000Z',
}

describe('businessRuleDefinitionSchema', () => {
  test('accepts a full definition and applies the defaults', () => {
    const parsed = businessRuleDefinitionSchema.parse(validDefinition)
    expect(parsed).toMatchObject({
      ruleId: 'DEAL_WON_GUARD',
      ruleType: 'GUARD',
      entityType: 'customers.deal',
      eventType: 'updated',
      enabled: true,
      priority: 100,
      version: 1,
    })
    expect(parsed.effectiveFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(parsed.effectiveTo).toEqual(new Date('2026-12-31T00:00:00.000Z'))
  })

  test('drops scope and audit fields', () => {
    const parsed = businessRuleDefinitionSchema.parse({
      ...validDefinition,
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-000000000002',
      organizationId: '00000000-0000-4000-8000-000000000003',
      createdBy: 'someone',
    })
    expect(parsed).not.toHaveProperty('id')
    expect(parsed).not.toHaveProperty('tenantId')
    expect(parsed).not.toHaveProperty('organizationId')
    expect(parsed).not.toHaveProperty('createdBy')
  })

  test('turns empty optional strings into null', () => {
    const parsed = businessRuleDefinitionSchema.parse({
      ...validDefinition,
      description: '',
      ruleCategory: '',
      eventType: '',
      effectiveFrom: '',
      effectiveTo: '',
    })
    expect(parsed.description).toBeNull()
    expect(parsed.ruleCategory).toBeNull()
    expect(parsed.eventType).toBeNull()
    expect(parsed.effectiveFrom).toBeNull()
    expect(parsed.effectiveTo).toBeNull()
  })

  test('rejects an invalid condition expression', () => {
    const result = businessRuleDefinitionSchema.safeParse({
      ...validDefinition,
      conditionExpression: { field: 'status', operator: 'BETWEEN', value: 'won' },
    })
    expect(result.success).toBe(false)
  })

  test('rejects an effective window that ends before it starts', () => {
    const result = businessRuleDefinitionSchema.safeParse({
      ...validDefinition,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      effectiveTo: '2026-05-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('effectiveTo')
  })

  test('rejects a definition without its required fields', () => {
    expect(businessRuleDefinitionSchema.safeParse({ ruleId: 'X' }).success).toBe(false)
    expect(businessRuleDefinitionSchema.safeParse(null).success).toBe(false)
  })
})
