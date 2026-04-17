/**
 * @jest-environment node
 */
import {
  roleWidgetSettingsSchema,
  userWidgetSettingsSchema,
} from '@open-mercato/core/modules/dashboards/data/validators'

describe('dashboards role/user widget settings schema — mass-assign scope', () => {
  // Zod v4 .uuid() requires versioned UUID (v1-v8 variant bits).
  const validRoleId = '11111111-1111-4111-8111-111111111111'
  const validUserId = '22222222-2222-4222-8222-222222222222'
  const foreignTenant = '33333333-3333-4333-8333-333333333333'
  const foreignOrg = '44444444-4444-4444-8444-444444444444'

  test('roleWidgetSettingsSchema strips tenantId/organizationId from body', () => {
    const result = roleWidgetSettingsSchema.safeParse({
      roleId: validRoleId,
      tenantId: foreignTenant,
      organizationId: foreignOrg,
      widgetIds: ['widget-a'],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).not.toHaveProperty('tenantId')
    expect(result.data).not.toHaveProperty('organizationId')
    expect(result.data.widgetIds).toEqual(['widget-a'])
  })

  test('userWidgetSettingsSchema strips tenantId/organizationId from body', () => {
    const result = userWidgetSettingsSchema.safeParse({
      userId: validUserId,
      tenantId: foreignTenant,
      organizationId: foreignOrg,
      mode: 'override',
      widgetIds: ['widget-b'],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).not.toHaveProperty('tenantId')
    expect(result.data).not.toHaveProperty('organizationId')
    expect(result.data.mode).toBe('override')
  })

  test('userWidgetSettingsSchema defaults mode to inherit', () => {
    const result = userWidgetSettingsSchema.safeParse({
      userId: validUserId,
      widgetIds: [],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.mode).toBe('inherit')
  })
})
