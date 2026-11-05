/**
 * @jest-environment node
 */
import {
  updateRuleSetSchema,
  updateBusinessRuleSchema,
  createLocalizedUpdateBusinessRuleSchema,
} from '@open-mercato/core/modules/business_rules/data/validators'

const validId = '11111111-1111-4111-8111-111111111111'
const foreignTenant = '22222222-2222-4222-8222-222222222222'
const foreignOrg = '33333333-3333-4333-8333-333333333333'

const identityTranslator = ((_key: string, fallback?: string) => fallback ?? _key) as any

describe('business_rules update schemas — mass-assign scope', () => {
  test('updateRuleSetSchema strips tenantId/organizationId/createdBy from body', () => {
    const result = updateRuleSetSchema.safeParse({
      id: validId,
      setName: 'hijacked',
      tenantId: foreignTenant,
      organizationId: foreignOrg,
      createdBy: 'attacker@evil.test',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).not.toHaveProperty('tenantId')
    expect(result.data).not.toHaveProperty('organizationId')
    expect(result.data).not.toHaveProperty('createdBy')
    expect(result.data.setName).toBe('hijacked')
  })

  test('updateBusinessRuleSchema strips tenantId/organizationId/createdBy from body', () => {
    const result = updateBusinessRuleSchema.safeParse({
      id: validId,
      ruleName: 'hijacked-rule',
      tenantId: foreignTenant,
      organizationId: foreignOrg,
      createdBy: 'attacker@evil.test',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).not.toHaveProperty('tenantId')
    expect(result.data).not.toHaveProperty('organizationId')
    expect(result.data).not.toHaveProperty('createdBy')
    expect(result.data.ruleName).toBe('hijacked-rule')
  })

  test('createLocalizedUpdateBusinessRuleSchema strips tenantId/organizationId/createdBy from body', () => {
    const schema = createLocalizedUpdateBusinessRuleSchema(identityTranslator)
    const result = schema.safeParse({
      id: validId,
      ruleName: 'hijacked-localized',
      tenantId: foreignTenant,
      organizationId: foreignOrg,
      createdBy: 'attacker@evil.test',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).not.toHaveProperty('tenantId')
    expect(result.data).not.toHaveProperty('organizationId')
    expect(result.data).not.toHaveProperty('createdBy')
    expect(result.data.ruleName).toBe('hijacked-localized')
  })
})
