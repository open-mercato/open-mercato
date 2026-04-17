/**
 * @jest-environment node
 */
import {
  roleWidgetSettingsSchema,
  userWidgetSettingsSchema,
} from '@open-mercato/core/modules/dashboards/data/validators'
import { resolveWidgetAssignmentReadScope } from '@open-mercato/core/modules/dashboards/lib/widgetAssignmentScope'

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

describe('resolveWidgetAssignmentReadScope — GET scope hardening', () => {
  const callerTenant = '55555555-5555-4555-8555-555555555555'
  const callerOrg = '66666666-6666-4666-8666-666666666666'
  const foreignTenant = '77777777-7777-4777-8777-777777777777'
  const foreignOrg = '88888888-8888-4888-8888-888888888888'

  test('non-superadmin: query tenantId/organizationId are ignored, scope pinned to auth', () => {
    const scope = resolveWidgetAssignmentReadScope({
      auth: { tenantId: callerTenant, orgId: callerOrg },
      isSuperAdmin: false,
      queryTenantId: foreignTenant,
      queryOrganizationId: foreignOrg,
    })
    expect(scope).toEqual({ tenantId: callerTenant, organizationId: callerOrg })
  })

  test('non-superadmin with null auth org: scope is null, not query value', () => {
    const scope = resolveWidgetAssignmentReadScope({
      auth: { tenantId: callerTenant, orgId: null },
      isSuperAdmin: false,
      queryTenantId: foreignTenant,
      queryOrganizationId: foreignOrg,
    })
    expect(scope).toEqual({ tenantId: callerTenant, organizationId: null })
  })

  test('superadmin: query override is accepted', () => {
    const scope = resolveWidgetAssignmentReadScope({
      auth: { tenantId: callerTenant, orgId: callerOrg },
      isSuperAdmin: true,
      queryTenantId: foreignTenant,
      queryOrganizationId: foreignOrg,
    })
    expect(scope).toEqual({ tenantId: foreignTenant, organizationId: foreignOrg })
  })

  test('superadmin without query falls back to auth scope', () => {
    const scope = resolveWidgetAssignmentReadScope({
      auth: { tenantId: callerTenant, orgId: callerOrg },
      isSuperAdmin: true,
      queryTenantId: null,
      queryOrganizationId: null,
    })
    expect(scope).toEqual({ tenantId: callerTenant, organizationId: callerOrg })
  })

  test('superadmin with empty-string query falls back to auth scope', () => {
    const scope = resolveWidgetAssignmentReadScope({
      auth: { tenantId: callerTenant, orgId: callerOrg },
      isSuperAdmin: true,
      queryTenantId: '',
      queryOrganizationId: '',
    })
    expect(scope).toEqual({ tenantId: callerTenant, organizationId: callerOrg })
  })
})
