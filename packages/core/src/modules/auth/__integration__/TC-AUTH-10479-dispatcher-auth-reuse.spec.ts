import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'

export const integrationMeta = { dependsOnModules: ['auth', 'directory'] }

const PASSWORD = 'Dispatcher-Reuse-Secret-123!'
type Subject = { token: string; setupToken: string; userId: string; organizationId: string; tenantId: string; marker: string }

async function withSubject(request: APIRequestContext, features: string[], run: (subject: Subject) => Promise<void>, ownOrganizationOnly = false) {
  const setupToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(setupToken)
  const marker = `dispatcher-reuse-${randomUUID()}`
  let organizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  try {
    organizationId = await createOrganizationFixture(request, setupToken, { name: marker, tenantId })
    roleId = await createRoleFixture(request, setupToken, { name: marker })
    await setRoleAclFeatures(request, setupToken, { roleId, features, organizations: ownOrganizationOnly ? [organizationId] : null })
    const email = `${marker}@example.com`
    userId = await createUserFixture(request, setupToken, { email, password: PASSWORD, organizationId, roles: [roleId], name: marker })
    const token = await getAuthToken(request, email, PASSWORD)
    await run({ token, setupToken, userId, organizationId, tenantId, marker })
  } finally {
    await deleteUserIfExists(request, setupToken, userId)
    await deleteRoleIfExists(request, setupToken, roleId)
    await deleteOrganizationIfExists(request, setupToken, organizationId)
  }
}

async function listUsers(subject: Subject, token = subject.token, cookie = '') {
  return withCredentialIsolatedRequest(async (request) => {
    const response = await request.get(`/api/auth/users?name=${encodeURIComponent(subject.marker)}&pageSize=100`, {
      headers: { Authorization: `Bearer ${token}`, Cookie: cookie },
    })
    const body = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
    return { status: response.status(), ids: (body?.items ?? []).map((item) => item.id) }
  })
}

function selectedScope(tenantId: string, organizationId: string) {
  return `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=${encodeURIComponent(organizationId)}`
}

test('TC-AUTH-10479: the consuming users route returns the authorized principal fixture', async ({ request }) => {
  await withSubject(request, ['auth.users.list'], async (subject) => {
    expect(await listUsers(subject)).toEqual({ status: 200, ids: [subject.userId] })
  })
})

test('TC-AUTH-10479: dispatcher reuse does not grant a missing route permission', async ({ request }) => {
  await withSubject(request, [], async (subject) => {
    expect(await listUsers(subject, subject.setupToken, selectedScope(subject.tenantId, subject.organizationId)))
      .toEqual({ status: 200, ids: [subject.userId] })
    expect(await listUsers(subject)).toEqual({ status: 403, ids: [] })
  })
})

test('TC-AUTH-10479: a valid MFA-pending credential cannot reach the consuming route', async ({ request }) => {
  await withSubject(request, ['auth.users.list'], async (subject) => {
    const { signJwt, verifyJwt } = await importFromAppRuntime<typeof import('@open-mercato/shared/lib/auth/jwt')>('@open-mercato/shared/lib/auth/jwt')
    const claims: Record<string, unknown> | null = verifyJwt(subject.token)
    expect(claims).not.toBeNull()
    expect(await listUsers(subject, signJwt({ ...claims }))).toEqual({ status: 200, ids: [subject.userId] })
    const pending = signJwt({ ...claims, mfa_pending: true, mfa_verified: false })
    expect(await listUsers(subject, pending)).toEqual({ status: 401, ids: [] })
    expect(await listUsers(subject)).toEqual({ status: 200, ids: [subject.userId] })
  })
})

test('TC-AUTH-10479: revoked sessions are rejected on the next consuming request', async ({ request }) => {
  await withSubject(request, ['auth.users.list'], async (subject) => {
    expect(await listUsers(subject)).toEqual({ status: 200, ids: [subject.userId] })
    await withCredentialIsolatedRequest(async (isolated) => {
      const response = await isolated.post('/api/auth/logout', {
        headers: { Authorization: `Bearer ${subject.token}` }, maxRedirects: 0,
      })
      expect(response.status()).toBe(303)
    })
    expect(await listUsers(subject)).toEqual({ status: 401, ids: [] })
  })
})

test('TC-AUTH-10479: selected organizations constrain the handler browse results', async ({ request }) => {
  await withSubject(request, ['auth.users.list'], async (subject) => {
    let otherOrganizationId: string | null = null
    let otherUserId: string | null = null
    try {
      otherOrganizationId = await createOrganizationFixture(request, subject.setupToken, { name: `other-${subject.marker}`, tenantId: subject.tenantId })
      otherUserId = await createUserFixture(request, subject.setupToken, {
        email: `other-${subject.marker}@example.com`, password: PASSWORD,
        organizationId: otherOrganizationId, roles: [], name: subject.marker,
      })
      expect(await listUsers(subject, subject.token, selectedScope(subject.tenantId, subject.organizationId)))
        .toEqual({ status: 200, ids: [subject.userId] })
      expect(await listUsers(subject, subject.token, selectedScope(subject.tenantId, otherOrganizationId)))
        .toEqual({ status: 200, ids: [otherUserId] })
      expect(await listUsers(subject, subject.token, selectedScope(subject.tenantId, subject.organizationId)))
        .toEqual({ status: 200, ids: [subject.userId] })
    } finally {
      await deleteUserIfExists(request, subject.setupToken, otherUserId)
      await deleteOrganizationIfExists(request, subject.setupToken, otherOrganizationId)
    }
  })
})

test('TC-AUTH-10479: selected tenants cannot expose another tenant to a regular principal', async ({ request }) => {
  await withSubject(request, ['auth.users.list'], async (subject) => {
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null
    let foreignUserId: string | null = null
    try {
      const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: subject.setupToken, data: { name: `foreign-${subject.marker}` },
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      foreignTenantId = expectId(body?.id, 'Tenant fixture should include an id')
      expect(response.status()).toBe(201)
      foreignOrganizationId = await createOrganizationFixture(request, subject.setupToken, { name: subject.marker, tenantId: foreignTenantId })
      foreignUserId = await createUserFixture(request, subject.setupToken, {
        email: `foreign-${subject.marker}@example.com`, password: PASSWORD,
        organizationId: foreignOrganizationId, roles: [], name: subject.marker,
      })
      const foreignScope = selectedScope(foreignTenantId, foreignOrganizationId)
      expect(await listUsers(subject, subject.setupToken, foreignScope)).toEqual({ status: 200, ids: [foreignUserId] })
      expect(await listUsers(subject, subject.setupToken, selectedScope(subject.tenantId, subject.organizationId)))
        .toEqual({ status: 200, ids: [subject.userId] })
      expect(await listUsers(subject, subject.token, foreignScope)).toEqual({ status: 200, ids: [subject.userId] })
    } finally {
      await deleteUserIfExists(request, subject.setupToken, foreignUserId)
      await deleteOrganizationIfExists(request, subject.setupToken, foreignOrganizationId)
      await deleteGeneralEntityIfExists(request, subject.setupToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})

test('TC-AUTH-10479: a restricted principal cannot select an unauthorized organization', async ({ request }) => {
  await withSubject(request, ['auth.users.list'], async (subject) => {
    let otherOrganizationId: string | null = null
    let otherUserId: string | null = null
    try {
      otherOrganizationId = await createOrganizationFixture(request, subject.setupToken, { name: `restricted-other-${subject.marker}`, tenantId: subject.tenantId })
      otherUserId = await createUserFixture(request, subject.setupToken, {
        email: `restricted-other-${subject.marker}@example.com`, password: PASSWORD,
        organizationId: otherOrganizationId, roles: [], name: subject.marker,
      })
      const otherScope = selectedScope(subject.tenantId, otherOrganizationId)
      expect(await listUsers(subject, subject.setupToken, otherScope)).toEqual({ status: 200, ids: [otherUserId] })
      expect(await listUsers(subject, subject.token, selectedScope(subject.tenantId, subject.organizationId)))
        .toEqual({ status: 200, ids: [subject.userId] })
      expect(await listUsers(subject, subject.token, otherScope)).toEqual({ status: 200, ids: [subject.userId] })
    } finally {
      await deleteUserIfExists(request, subject.setupToken, otherUserId)
      await deleteOrganizationIfExists(request, subject.setupToken, otherOrganizationId)
    }
  }, true)
})
