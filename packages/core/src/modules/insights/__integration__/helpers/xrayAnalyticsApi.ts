import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { QA_USER_PASSWORD, createQaDeal, deleteQaDealIfExists, uniqueSuffix, updateQaDeal } from './explainApi'
import { deleteXrayOrganizationState, putXraySettings, runXrayBackfill } from './xrayApi'

export const XRAY_ANALYTICS_BASE = '/api/insights/xray'
export const XRAY_INDIVIDUALS_RESOURCE_KIND = 'insights.xray.individuals'
export const DEAL_ACTOR_FEATURES = ['customers.deals.view', 'customers.deals.manage']
export const DEAL_STATUS_PATH = ['open', 'qa_review', 'win'] as const

export type XrayHttpResult<TBody = Record<string, unknown>> = { status: number; text: string; body: TBody | null }

/** Everything a spec created, recorded as soon as it exists so `finally` can clean it up. */
export type XrayAnalyticsFixture = {
  adminToken: string | null
  superadminToken: string | null
  tenantId: string | null
  organizationIds: string[]
  roleIds: string[]
  userIds: string[]
  privilegedRoleIds: string[]
  privilegedUserIds: string[]
  deals: Array<{ id: string; organizationId: string }>
}

export function createXrayAnalyticsFixture(): XrayAnalyticsFixture {
  return {
    adminToken: null,
    superadminToken: null,
    tenantId: null,
    organizationIds: [],
    roleIds: [],
    userIds: [],
    privilegedRoleIds: [],
    privilegedUserIds: [],
    deals: [],
  }
}

/**
 * Roles granting a feature the admin does not hold (`insights.xray.view_individuals` is
 * super-admin only by default) are created by the super administrator, in the admin's tenant.
 */
async function privilegedToken(request: APIRequestContext, fixture: XrayAnalyticsFixture): Promise<string> {
  if (!fixture.superadminToken) fixture.superadminToken = await getAuthToken(request, 'superadmin')
  return fixture.superadminToken
}

function isPrivileged(features: string[]): boolean {
  return features.some((feature) => feature === 'insights.xray.view_individuals' || feature === 'insights.xray.*' || feature === 'insights.*' || feature === '*')
}

async function readResult<TBody>(response: APIResponse): Promise<XrayHttpResult<TBody>> {
  const text = await response.text()
  let body: TBody | null = null
  if (text) {
    try {
      body = JSON.parse(text) as TBody
    } catch {
      body = null
    }
  }
  return { status: response.status(), text, body }
}

/** Calls an X-Ray analytics route as `token` (optionally with a selected organization cookie). */
export async function xrayCall<TBody = Record<string, unknown>>(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  options: { selectedOrgId?: string; data?: unknown } = {},
): Promise<XrayHttpResult<TBody>> {
  const response = options.selectedOrgId
    ? await apiRequestWithSelectedOrg(request, method, path, { token, selectedOrgId: options.selectedOrgId, data: options.data })
    : await apiRequest(request, method, path, { token, data: options.data })
  return readResult<TBody>(response)
}

/** A fresh organization of the admin's tenant (one per spec, so thresholds and counts are deterministic). */
export async function createXrayOrganization(request: APIRequestContext, fixture: XrayAnalyticsFixture, label: string): Promise<string> {
  if (!fixture.adminToken) {
    fixture.adminToken = await getAuthToken(request, 'admin')
    fixture.tenantId = getTokenScope(fixture.adminToken).tenantId
  }
  const organizationId = await createOrganizationInDb({ name: `QA ${label} ${uniqueSuffix()}`, tenantId: fixture.tenantId as string })
  fixture.organizationIds.push(organizationId)
  return organizationId
}

/** A role with exactly `features`, restricted to `organizations`. */
export async function createXrayRole(
  request: APIRequestContext,
  fixture: XrayAnalyticsFixture,
  input: { label: string; features: string[]; organizations: string[] },
): Promise<string> {
  const privileged = isPrivileged(input.features)
  const token = privileged ? await privilegedToken(request, fixture) : fixture.adminToken as string
  const roleId = await createRoleFixture(request, token, { name: `QA ${input.label} ${uniqueSuffix()}`, tenantId: fixture.tenantId ?? undefined })
  if (privileged) fixture.privilegedRoleIds.push(roleId)
  else fixture.roleIds.push(roleId)
  await setRoleAclFeatures(request, token, { roleId, features: input.features, organizations: input.organizations })
  return roleId
}

/** A user of `organizationId` holding only `roleId`, logged in. */
export async function createXrayUser(
  request: APIRequestContext,
  fixture: XrayAnalyticsFixture,
  input: { label: string; organizationId: string; roleId: string },
): Promise<{ token: string; userId: string; email: string; password: string }> {
  const email = `qa-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uniqueSuffix()}@example.com`
  const privileged = fixture.privilegedRoleIds.includes(input.roleId)
  const userId = await createUserFixture(request, privileged ? await privilegedToken(request, fixture) : fixture.adminToken as string, {
    email,
    password: QA_USER_PASSWORD,
    organizationId: input.organizationId,
    roles: [input.roleId],
    name: `QA ${input.label}`,
  })
  if (privileged) fixture.privilegedUserIds.push(userId)
  else fixture.userIds.push(userId)
  return { token: await getAuthToken(request, email, QA_USER_PASSWORD), userId, email, password: QA_USER_PASSWORD }
}

/**
 * Seeds `dealsPerActor` deals per actor token in the organization, each walking the status path
 * `open → qa_review → win` (a completed case of one variant), configures the organization for
 * deterministic analytics (k = 5, no debounce, optional per-person switch) and backfills it.
 */
export async function seedDealProcess(
  request: APIRequestContext,
  fixture: XrayAnalyticsFixture,
  input: { organizationId: string; actorTokens: string[]; dealsPerActor: number; individualsEnabled?: boolean; label: string },
): Promise<void> {
  const adminToken = fixture.adminToken as string
  const settings = await putXraySettings(request, adminToken, {
    kAnonymity: 5,
    debounceSeconds: 0,
    individualsEnabled: input.individualsEnabled === true,
  }, { selectedOrgId: input.organizationId })
  expect(settings.status, `PUT X-Ray settings of the fixture organization: ${settings.text}`).toBe(200)
  for (const [actorIndex, token] of input.actorTokens.entries()) {
    for (let index = 0; index < input.dealsPerActor; index += 1) {
      const dealId = await createQaDeal(request, token, { title: `QA ${input.label} ${actorIndex}-${index} ${uniqueSuffix()}`, status: DEAL_STATUS_PATH[0] })
      fixture.deals.push({ id: dealId, organizationId: input.organizationId })
      for (const status of DEAL_STATUS_PATH.slice(1)) await updateQaDeal(request, token, dealId, { status })
    }
  }
  await runXrayBackfill(request, adminToken, { selectedOrgId: input.organizationId })
}

export async function countIndividualsAccessRows(organizationId: string, actorUserId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ total: string }>(
      'select count(*)::text as total from access_logs where resource_kind = $1 and organization_id = $2 and actor_user_id = $3',
      [XRAY_INDIVIDUALS_RESOURCE_KIND, organizationId, actorUserId],
    )
    return Number(result.rows[0]?.total ?? 0)
  })
}

/** Removes every record the spec created (deals, X-Ray rows, access log rows, users, roles, organizations). */
export async function cleanupXrayAnalyticsFixture(request: APIRequestContext, fixture: XrayAnalyticsFixture): Promise<void> {
  const adminToken = fixture.adminToken
  for (const deal of fixture.deals) {
    await deleteQaDealIfExists(request, adminToken, deal.id, { selectedOrgId: deal.organizationId })
  }
  for (const userId of fixture.userIds) await deleteUserIfExists(request, adminToken, userId)
  for (const roleId of fixture.roleIds) await deleteRoleIfExists(request, adminToken, roleId)
  for (const userId of fixture.privilegedUserIds) await deleteUserIfExists(request, fixture.superadminToken, userId)
  for (const roleId of fixture.privilegedRoleIds) await deleteRoleIfExists(request, fixture.superadminToken, roleId)
  for (const organizationId of fixture.organizationIds) {
    await deleteXrayOrganizationState(organizationId).catch(() => undefined)
    await withClient(async (client) => {
      await client.query('delete from access_logs where organization_id = $1 and resource_kind = $2', [organizationId, XRAY_INDIVIDUALS_RESOURCE_KIND])
    }).catch(() => undefined)
    await deleteOrganizationInDb(organizationId).catch(() => undefined)
  }
}

/**
 * A role with exactly `features` in every organization of the tenant (no organization
 * restriction), created by the super administrator so the admin's own grant scope never limits it.
 */
export async function createTenantWideXrayRole(
  request: APIRequestContext,
  fixture: XrayAnalyticsFixture,
  input: { label: string; features: string[] },
): Promise<string> {
  const token = await privilegedToken(request, fixture)
  const roleId = await createRoleFixture(request, token, { name: `QA ${input.label} ${uniqueSuffix()}`, tenantId: fixture.tenantId ?? undefined })
  fixture.privilegedRoleIds.push(roleId)
  await setRoleAclFeatures(request, token, { roleId, features: input.features, organizations: null })
  return roleId
}

/** A user of `organizationId` holding exactly `roleIds`, logged in (created by the super administrator when any role is privileged). */
export async function createXrayUserWithRoles(
  request: APIRequestContext,
  fixture: XrayAnalyticsFixture,
  input: { label: string; organizationId: string; roleIds: string[] },
): Promise<{ token: string; userId: string }> {
  const email = `qa-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uniqueSuffix()}@example.com`
  const privileged = input.roleIds.some((roleId) => fixture.privilegedRoleIds.includes(roleId))
  const userId = await createUserFixture(request, privileged ? await privilegedToken(request, fixture) : fixture.adminToken as string, {
    email,
    password: QA_USER_PASSWORD,
    organizationId: input.organizationId,
    roles: input.roleIds,
    name: `QA ${input.label}`,
  })
  if (privileged) fixture.privilegedUserIds.push(userId)
  else fixture.userIds.push(userId)
  return { token: await getAuthToken(request, email, QA_USER_PASSWORD), userId }
}
