import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || null

export const BUSINESS_RULES_TEST_PASSWORD = 'Secret123!'

export type BusinessRulePayload = {
  ruleId: string
  ruleName: string
  description?: string | null
  ruleType: 'GUARD' | 'VALIDATION' | 'CALCULATION' | 'ACTION' | 'ASSIGNMENT'
  ruleCategory?: string | null
  entityType: string
  eventType?: string | null
  conditionExpression?: unknown
  successActions?: unknown
  failureActions?: unknown
  enabled?: boolean
  priority?: number
}

export type ExecutionRuleEntry = {
  ruleId?: string
  ruleName?: string
  conditionResult?: boolean
  actionsExecuted?: {
    success?: boolean
    results?: Array<{ type?: string; success?: boolean; error?: string }>
  } | null
  logId?: string
}

export type LogListItem = {
  id: string
  ruleId: string
  entityId: string
  entityType: string
  executionResult: 'SUCCESS' | 'FAILURE' | 'ERROR'
  executedAt: string
  organizationId?: string | null
  outputContext?: {
    conditionResult?: boolean
    actionsExecuted?: Array<{ type?: string; success?: boolean; error?: string }>
  } | null
}

export function buildBusinessRulePayload(
  stamp: string | number,
  overrides: Partial<BusinessRulePayload> = {},
): BusinessRulePayload {
  return {
    ruleId: `QA_BR_${stamp}`,
    ruleName: `QA Business Rule ${stamp}`,
    ruleType: 'GUARD',
    entityType: 'QaBusinessRuleEntity',
    eventType: 'beforeSave',
    conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
    successActions: null,
    failureActions: null,
    enabled: true,
    priority: 100,
    ...overrides,
  }
}

export async function expectForbidden(response: APIResponse, feature: string, label: string): Promise<void> {
  expect(response.status(), label).toBe(403)
  const body = await readJsonSafe<{ requiredFeatures?: string[] }>(response)
  expect(body?.requiredFeatures, `${label} should report the missing feature`).toContain(feature)
}

export async function createBusinessRulesUser(
  request: APIRequestContext,
  adminToken: string,
  input: {
    email: string
    organizationId: string
    features: string[]
    password?: string
    roleName?: string
  },
): Promise<{ token: string; roleId: string; userId: string }> {
  const password = input.password ?? BUSINESS_RULES_TEST_PASSWORD
  const roleId = await createRoleFixture(request, adminToken, {
    name: input.roleName ?? `Business Rules Test Role ${Date.now()}`,
  })
  const userId = await createUserFixture(request, adminToken, {
    email: input.email,
    password,
    organizationId: input.organizationId,
    roles: [roleId],
  })
  await setUserAclVisibility(request, adminToken, {
    userId,
    features: input.features,
    organizations: null,
  })
  const token = await getAuthToken(request, input.email, password)
  return { token, roleId, userId }
}

export async function cleanupBusinessRulesUser(
  request: APIRequestContext,
  adminToken: string | null,
  userId: string | null,
  roleId: string | null,
): Promise<void> {
  await deleteUserAclInDb(userId ?? '').catch(() => undefined)
  await deleteUserIfExists(request, adminToken, userId)
  await deleteRoleIfExists(request, adminToken, roleId)
}

export async function listRuleLogs(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<{ status: number; items: LogListItem[] }> {
  const response = await apiRequest(request, 'GET', `/api/business_rules/logs${query}`, { token })
  const body = await readJsonSafe<{ items?: LogListItem[] }>(response)
  return { status: response.status(), items: body?.items ?? [] }
}

export function scopeCookie(tenantId: string, organizationId: string | null): string {
  const parts = [`om_selected_tenant=${encodeURIComponent(tenantId)}`]
  parts.push(`om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`)
  return parts.join('; ')
}

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

export async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

export async function createTenantFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Tenant creation response should include id')
}

export async function createOrganizationInTenant(
  request: APIRequestContext,
  token: string,
  cookie: string,
  tenantId: string,
  name: string,
): Promise<string> {
  const response = await apiRequestWithCookie(request, 'POST', '/api/directory/organizations', {
    token,
    cookie,
    data: { name, tenantId },
  })
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Organization creation response should include id')
}

export async function setRoleAclFeaturesForTenant(
  request: APIRequestContext,
  token: string,
  input: { roleId: string; tenantId: string; features: string[]; organizations?: string[] | null },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: {
      roleId: input.roleId,
      tenantId: input.tenantId,
      features: input.features,
      organizations: input.organizations ?? null,
    },
  })
  const body = await readJsonSafe<{ ok?: boolean }>(response)
  expect(response.status(), 'PUT /api/auth/roles/acl should return 200').toBe(200)
  expect(body?.ok, 'Role ACL update should report ok=true').toBe(true)
}
