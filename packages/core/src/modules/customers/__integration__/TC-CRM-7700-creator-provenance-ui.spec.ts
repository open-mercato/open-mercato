import { randomUUID } from 'node:crypto'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from '@playwright/test'
import { z } from 'zod'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  acknowledgeGlobalNotices,
  login,
} from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

const apiKeyCreateResponseSchema = z.object({
  id: z.string().uuid(),
  secret: z.string().min(1),
}).passthrough()

const dealCreateResponseSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
}).passthrough()

const loginResponseSchema = z.object({
  token: z.string().min(1),
}).passthrough()

const authUsersResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  }).passthrough()),
}).passthrough()

async function createCustomerApiKey(
  request: APIRequestContext,
  token: string,
  input: { name: string; organizationId: string; roleId: string },
): Promise<z.infer<typeof apiKeyCreateResponseSchema>> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token,
    data: {
      name: input.name,
      organizationId: input.organizationId,
      roles: [input.roleId],
    },
  })
  expect(response.status(), 'API key creation should return 201').toBe(201)
  return apiKeyCreateResponseSchema.parse(await readJsonSafe<unknown>(response))
}

async function createDealWithApiKey(
  apiKey: string,
  title: string,
): Promise<string> {
  return withCredentialIsolatedRequest(async (keyRequest) => {
    const response = await keyRequest.post('/api/customers/deals', {
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      data: { title, status: 'open' },
    })
    expect(response.status(), 'API-key deal creation should return 201').toBe(201)
    const body = dealCreateResponseSchema.parse(await readJsonSafe<unknown>(response))
    return expectId(body.id ?? body.entityId ?? body.dealId, 'API-key deal response should include an id')
  })
}

async function deleteApiKeyIfExists(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(id)}`, { token })
    .catch(() => undefined)
}

async function resolveCreatorLabel(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/auth/users?ids=${encodeURIComponent(userId)}&pageSize=1`,
    { token },
  )
  expect(response.status(), 'Creator lookup fixture request should return 200').toBe(200)
  const body = authUsersResponseSchema.parse(await readJsonSafe<unknown>(response))
  const user = body.items.find((item) => item.id === userId)
  expect(user, 'Creator lookup fixture should return the admin').toBeDefined()
  return expectId(
    user?.name?.trim() || user?.display_name?.trim() || user?.email?.trim(),
    'Creator lookup fixture should expose a display label',
  )
}

async function loginWithCredentials(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.context().clearCookies()
  await acknowledgeGlobalNotices(page)
  const response = await page.request.post('/api/auth/login', {
    form: { email, password },
  })
  expect(response.status(), 'Custom viewer login should return 200').toBe(200)
  const body = loginResponseSchema.parse(await readJsonSafe<unknown>(response))
  const scope = getTokenScope(body.token)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    {
      name: 'om_selected_tenant',
      value: scope.tenantId,
      url: baseUrl,
      sameSite: 'Lax',
    },
    {
      name: 'om_selected_org',
      value: scope.organizationId,
      url: baseUrl,
      sameSite: 'Lax',
    },
  ])
}

function creatorFact(page: Page) {
  return page.getByText('Created by', { exact: true }).locator('..')
}

async function expectCreatorFact(
  page: Page,
  path: string,
  expectedValue: string,
  forbiddenUuid?: string,
  expectCrudForm = false,
): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  const fact = creatorFact(page)
  await expect(fact).toBeVisible({ timeout: 20_000 })
  await expect(fact).toContainText(expectedValue)
  if (forbiddenUuid) {
    await expect(fact).not.toContainText(forbiddenUuid)
  }
  await expect(page.locator('[data-crud-field-id="createdByUserId"]')).toHaveCount(0)
  await expect(page.locator('[data-crud-field-id="created_by_user_id"]')).toHaveCount(0)
  await expect(page.locator('form').getByText('Created by', { exact: true })).toHaveCount(0)
  await expect(page.locator('form').getByLabel('Created by', { exact: true })).toHaveCount(0)
  if (expectCrudForm) {
    await expect(page.locator('[data-crud-field-id*="created_by" i], [data-crud-field-id*="createdBy" i]')).toHaveCount(0)
  }
}

function isAuthUsersRequest(request: Request): boolean {
  const url = new URL(request.url())
  return request.method() === 'GET' && url.pathname === '/api/auth/users'
}

test.describe('TC-CRM-7700: CRM record creation provenance UI', () => {
  test.describe.configure({ timeout: 180_000 })

  test('shows the admin creator on v2, deal and legacy details and null creator as unknown', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const adminLabel = await resolveCreatorLabel(request, adminToken, adminScope.userId)
    const marker = randomUUID()
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null
    let keyDealId: string | null = null
    let keyRoleId: string | null = null
    let apiKeyId: string | null = null

    try {
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Creator',
        lastName: marker,
        displayName: `Creator Person ${marker}`,
      })
      companyId = await createCompanyFixture(request, adminToken, `Creator Company ${marker}`)
      dealId = await createDealFixture(request, adminToken, { title: `Creator Deal ${marker}` })

      keyRoleId = await createRoleFixture(request, adminToken, {
        name: `crm-7700-key-ui-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId: keyRoleId,
        features: ['customers.*'],
        organizations: [adminScope.organizationId],
      })
      const apiKey = await createCustomerApiKey(request, adminToken, {
        name: `crm-7700-key-ui-${marker}`,
        organizationId: adminScope.organizationId,
        roleId: keyRoleId,
      })
      apiKeyId = apiKey.id
      keyDealId = await createDealWithApiKey(apiKey.secret, `API Key Deal ${marker}`)

      await login(page, 'admin')
      const creatorRoutes = [
        { path: `/backend/customers/people-v2/${personId}`, expectCrudForm: true },
        { path: `/backend/customers/companies-v2/${companyId}`, expectCrudForm: true },
        { path: `/backend/customers/deals/${dealId}`, expectCrudForm: false },
        { path: `/backend/customers/people/${personId}`, expectCrudForm: false },
        { path: `/backend/customers/companies/${companyId}`, expectCrudForm: false },
      ]
      for (const route of creatorRoutes) {
        await expectCreatorFact(
          page,
          route.path,
          adminLabel,
          adminScope.userId,
          route.expectCrudForm,
        )
      }
      await expectCreatorFact(
        page,
        `/backend/customers/deals/${keyDealId}`,
        'Unknown creator',
      )
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', keyDealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      await deleteApiKeyIfExists(request, adminToken, apiKeyId)
      await deleteRoleIfExists(request, adminToken, keyRoleId)
    }
  })

  test('falls back without auth.users.list and reuses a matching deal owner without a creator lookup', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const marker = randomUUID()
    const viewerName = `CRM 7700 Viewer ${marker}`
    const viewerEmail = `crm-7700-viewer-${marker}@example.test`
    const viewerPassword = `Qa1!${randomUUID()}`
    let roleId: string | null = null
    let viewerId: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let differentOwnerDealId: string | null = null
    let ownDealId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `crm-7700-viewer-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [
          'customers.people.view',
          'customers.companies.view',
          'customers.deals.view',
          'customers.deals.manage',
        ],
        organizations: [adminScope.organizationId],
      })
      viewerId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password: viewerPassword,
        organizationId: adminScope.organizationId,
        roles: [roleId],
        name: viewerName,
      })
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Hidden',
        lastName: marker,
        displayName: `Hidden Creator Person ${marker}`,
      })
      companyId = await createCompanyFixture(request, adminToken, `Hidden Creator Company ${marker}`)
      differentOwnerDealId = await createDealFixture(request, adminToken, {
        title: `Hidden Creator Deal ${marker}`,
        ownerUserId: viewerId,
      })
      const viewerToken = await getAuthToken(request, viewerEmail, viewerPassword)
      ownDealId = await createDealFixture(request, viewerToken, {
        title: `Owner Creator Deal ${marker}`,
        ownerUserId: viewerId,
      })

      await loginWithCredentials(page, viewerEmail, viewerPassword)
      const unknownRoutes = [
        `/backend/customers/people-v2/${personId}`,
        `/backend/customers/companies-v2/${companyId}`,
        `/backend/customers/deals/${differentOwnerDealId}`,
        `/backend/customers/people/${personId}`,
        `/backend/customers/companies/${companyId}`,
      ]
      for (const path of unknownRoutes) {
        await expectCreatorFact(page, path, 'Unknown creator', adminScope.userId)
      }

      const creatorLookups: Request[] = []
      const onRequest = (browserRequest: Request) => {
        if (isAuthUsersRequest(browserRequest)) {
          creatorLookups.push(browserRequest)
        }
      }
      page.on('request', onRequest)
      try {
        await expectCreatorFact(
          page,
          `/backend/customers/deals/${ownDealId}`,
          viewerName,
          viewerId,
        )
        expect(creatorLookups, 'Matching deal owner should avoid the creator lookup').toHaveLength(0)
      } finally {
        page.off('request', onRequest)
      }
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', ownDealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', differentOwnerDealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      await deleteUserIfExists(request, adminToken, viewerId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('resolves creator names through an auth wildcard grant', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const adminLabel = await resolveCreatorLabel(request, adminToken, adminScope.userId)
    const marker = randomUUID()
    const viewerEmail = `crm-7700-wildcard-${marker}@example.test`
    const viewerPassword = `Qa1!${randomUUID()}`
    let roleId: string | null = null
    let viewerId: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let dealId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `crm-7700-wildcard-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [
          'customers.people.view',
          'customers.companies.view',
          'customers.deals.view',
          'customers.deals.manage',
          'auth.*',
        ],
        organizations: [adminScope.organizationId],
      })
      viewerId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password: viewerPassword,
        organizationId: adminScope.organizationId,
        roles: [roleId],
        name: `CRM 7700 Wildcard Viewer ${marker}`,
      })
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Wildcard',
        lastName: marker,
        displayName: `Wildcard Person ${marker}`,
      })
      companyId = await createCompanyFixture(request, adminToken, `Wildcard Company ${marker}`)
      dealId = await createDealFixture(request, adminToken, { title: `Wildcard Deal ${marker}` })

      await loginWithCredentials(page, viewerEmail, viewerPassword)
      const creatorRoutes = [
        `/backend/customers/people-v2/${personId}`,
        `/backend/customers/companies-v2/${companyId}`,
        `/backend/customers/deals/${dealId}`,
      ]
      for (const path of creatorRoutes) {
        await expectCreatorFact(page, path, adminLabel, adminScope.userId)
      }
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      await deleteUserIfExists(request, adminToken, viewerId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
