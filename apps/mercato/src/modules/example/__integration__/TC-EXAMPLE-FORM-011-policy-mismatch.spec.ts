import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildCrudFormSectionPolicyHeaders,
  crudFormSectionPolicyHeaderNames,
} from '@open-mercato/shared/lib/crud/form-sections/policy-headers'
import {
  crudFormSectionPolicyMismatchResponseSchema,
  readyResolveCrudFormSectionsResponseSchema,
} from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { readReadyShowcasePolicy, showcaseHeaders, test } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example'] }

test('TC-EXAMPLE-FORM-011 refuses three policy mismatches without any write', async ({ page, request, showcaseTodo }) => {
  const resolver = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/extensions/crud-form-sections/resolve' &&
    response.request().method() === 'POST')
  await showcaseTodo.open()
  const accepted = await resolver
  expect(accepted.status()).toBe(200)
  const parsed = readyResolveCrudFormSectionsResponseSchema.safeParse(await accepted.json())
  expect(parsed.success, 'expected a ready policy').toBe(true)
  if (!parsed.success) throw new Error('[internal] Expected a ready policy')

  const before = await showcaseTodo.read()
  const { id } = showcaseTodo
  const originalHeaders = buildCrudFormSectionPolicyHeaders({
    fingerprint: parsed.data.fingerprint,
    policyToken: parsed.data.policyToken,
    mutationSurfaceId: 'example.todo-showcase-update.update',
    requestOperation: 'update',
    hostResourceKind: 'example.todo',
    mutationResourceKind: 'example.todo',
    hostResourceId: id,
    mutationResourceId: id,
  }, { [OPTIMISTIC_LOCK_HEADER_NAME]: before.updatedAt })
  const staleFingerprint = new Headers(originalHeaders)
  staleFingerprint.set(crudFormSectionPolicyHeaderNames.fingerprint,
    parsed.data.fingerprint === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64))
  const wrongTarget = new Headers(originalHeaders)
  wrongTarget.set(crudFormSectionPolicyHeaderNames.mutationResourceId, randomUUID())

  const validData = { id, is_done: true }
  const cases = [
    { reason: 'unknown extension key', headers: originalHeaders, data: { ...validData, extensions: { unused_fixture_module: { value: 'refused' } } } },
    { reason: 'stale fingerprint', headers: staleFingerprint, data: validData },
    { reason: 'tampered protected target header', headers: wrongTarget, data: validData },
  ]
  for (const { reason, headers, data } of cases) {
    const response = await apiRequest(request, 'PUT', '/api/example/todos/section-policy', {
      token: showcaseTodo.token,
      headers: Object.fromEntries(headers),
      data,
    })
    expect(response.status(), reason).toBe(409)
    expect(crudFormSectionPolicyMismatchResponseSchema.safeParse(await response.json()).success, reason).toBe(true)
    const after = await showcaseTodo.read()
    expect(after).toMatchObject({ id, title: before.title, is_done: before.is_done, updatedAt: before.updatedAt })
    expect(after._extensions).toEqual(before._extensions)
  }
})

test('TC-EXAMPLE-FORM-011 checks form policy permissions and organization scope', async ({ page, request, showcaseTodo }) => {
  test.slow()
  const { tenantId, organizationId } = getTokenScope(showcaseTodo.token)
  if (!tenantId || !organizationId) throw new Error('[internal] The Todo fixture requires a scoped admin')
  const stamp = randomUUID()
  const password = `QaTodo-${stamp}!`
  const actors = [
    { email: `todo-read-${stamp}@example.invalid`, features: ['example.todos.view'], status: 403 },
    { email: `todo-other-${stamp}@example.invalid`, features: ['example.todos.view', 'example.todos.manage'], status: 404 },
  ]
  const policy = await readReadyShowcasePolicy(page, showcaseTodo.open)
  const before = await showcaseTodo.read()
  const headers = showcaseHeaders(policy, before.id, before.updatedAt)
  const userIds: string[] = []
  let otherOrganization: string | null = null
  let role: string | null = null
  try {
    otherOrganization = await createOrganizationInDb({ name: `Todo policy ${stamp}`, tenantId })
    role = await createRoleFixture(request, showcaseTodo.token, { name: `Todo policy ${stamp}` })
    for (const actor of actors) {
      const actorOrganization = actor.status === 403 ? organizationId : otherOrganization
      const userId = await createUserFixture(request, showcaseTodo.token, {
        email: actor.email, password, organizationId: actorOrganization, roles: [role],
      })
      userIds.push(userId)
      await setUserAclVisibility(request, showcaseTodo.token, {
        userId, organizations: [actorOrganization], features: actor.features,
      })
      const token = await getAuthToken(request, actor.email, password)
      expect(getTokenScope(token).organizationId).toBe(actorOrganization)
      const response = await apiRequest(request, 'PUT', '/api/example/todos/section-policy', {
        token, headers, data: { id: before.id, is_done: !before.is_done },
      })
      expect(response.status()).toBe(actor.status)
    }
    const after = await showcaseTodo.read()
    expect(after).toMatchObject({ id: before.id, is_done: before.is_done, updatedAt: before.updatedAt })
    expect(after._extensions).toEqual(before._extensions)
  } finally {
    for (const userId of userIds) {
      await deleteUserIfExists(request, showcaseTodo.token, userId)
      await deleteUserAclInDb(userId)
    }
    await deleteRoleIfExists(request, showcaseTodo.token, role)
    await deleteOrganizationInDb(otherOrganization)
  }
})
