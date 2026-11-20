import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  buildCrudFormSectionPolicyHeaders,
  crudFormSectionPolicyHeaderNames,
} from '@open-mercato/shared/lib/crud/form-sections/policy-headers'
import {
  crudFormSectionPolicyMismatchResponseSchema,
  readyResolveCrudFormSectionsResponseSchema,
} from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { test } from './todoShowcaseFixtures'

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
