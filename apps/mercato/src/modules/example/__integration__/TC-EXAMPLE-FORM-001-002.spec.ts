import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { buildCrudFormSectionPolicyHeaders } from '@open-mercato/shared/lib/crud/form-sections/policy-headers'
import { readyResolveCrudFormSectionsResponseSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const todoApi = '/api/example/todos'
const policyApi = `${todoApi}/section-policy`
const showcase = '/backend/example/form-extensions/todos'

test('TC-EXAMPLE-FORM-002 creates a Todo with the server default hidden title', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  let id: string | null = null
  try {
    await login(page, 'admin')
    await page.goto(`${showcase}/create`)
    const form = page.locator('form').filter({ has: page.locator('[data-crud-field-id="is_done"]') })
    await expect(form.locator('[data-crud-field-id="is_done"]')).toBeVisible()
    await expect(form.locator('[data-crud-field-id="title"]')).toHaveCount(0)
    const mutation = page.waitForResponse((response) =>
      new URL(response.url()).pathname === policyApi && response.request().method() === 'POST')
    await form.locator('button[type="submit"]').first().click()
    const result = await mutation
    expect(result.status(), await result.text()).toBe(201)
    id = (await result.json()).id
    const detail = await apiRequest(request, 'GET', `${todoApi}?id=${id}&pageSize=1`, { token })
    expect((await detail.json()).items[0]).toMatchObject({ id, title: 'Todo', is_done: false })
  } finally {
    if (id) await deleteEntityIfExists(request, token, todoApi, id)
  }
})

test.describe('TC-EXAMPLE-FORM-001 configured Todo update', () => {
  for (const contender of ['update', 'delete'] as const) {
    test(`preserves the hidden title and serializes a concurrent ${contender}`, async ({ page, request }) => {
      test.slow()
      const title = `Showcase ${randomUUID()}`
      const token = await getAuthToken(request, 'admin')
      const created = await apiRequest(request, 'POST', todoApi, { token, data: { title, is_done: false, cf_priority: 3, cf_severity: 'medium' } })
      expect(created.status()).toBe(201)
      const { id } = await created.json() as { id: string }
      try {
        await login(page, 'admin')
        const resolved = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/extensions/crud-form-sections/resolve')
        await page.goto(`${showcase}/${id}`)
        const policyResponse = await resolved
        expect(policyResponse.status(), 'The configured Todo resolver accepts the selected policy').toBe(200)
        const parsed = readyResolveCrudFormSectionsResponseSchema.safeParse(await policyResponse.json())
        if (!parsed.success) throw new Error('The configured Todo resolver did not return a ready policy')
        const policy = parsed.data
        const original = await apiRequest(request, 'GET', `${todoApi}?id=${id}&pageSize=1`, { token })
        const { updatedAt } = (await original.json()).items[0] as { updatedAt: string }
        function headers(operation: 'update' | 'delete') {
          const bound = buildCrudFormSectionPolicyHeaders({
            fingerprint: policy.fingerprint, policyToken: policy.policyToken,
            mutationSurfaceId: `example.todo-showcase-update.${operation}`, requestOperation: operation,
            hostResourceKind: 'example.todo', mutationResourceKind: 'example.todo',
            hostResourceId: id, mutationResourceId: id,
          }, { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt })
          return Object.fromEntries(bound.entries())
        }
        const first = apiRequest(request, 'PUT', policyApi, { token, headers: headers('update'), data: { id, is_done: true } })
        const second = contender === 'update'
          ? apiRequest(request, 'PUT', policyApi, { token, headers: headers('update'), data: { id, is_done: true } })
          : apiRequest(request, 'DELETE', policyApi, { token, headers: headers('delete'), data: { id } })
        const results = await Promise.all([first, second])
        expect(results.map((response) => response.status()).sort(), (await Promise.all(results.map((response) => response.text()))).join("\n")).toEqual([200, 409])
        const after = await apiRequest(request, 'GET', `${todoApi}?id=${id}&pageSize=1`, { token })
        const { items } = await after.json()
        if (results[0].status() === 200) expect(items[0]).toMatchObject({ id, title, is_done: true })
        else expect(items).toEqual([])
      } finally {
        await deleteEntityIfExists(request, token, todoApi, id)
      }
    })
  }
})

test('TC-EXAMPLE-FORM-012 keeps ordinary Todo forms outside configured section policies', async ({ page }) => {
  test.slow()
  await login(page, 'admin')
  const policyCalls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/extensions/crud-form-sections/resolve') policyCalls.push(request.url())
  })
  await page.goto('/backend/todos/create')
  await expect(page.locator('[data-crud-field-id="title"] input')).toBeVisible()
  await expect(page.locator('[data-crud-field-id="cf_priority"] input').first()).toBeVisible()
  await expect(page.locator('[data-crud-field-id="cf_season"], [data-crud-field-id="brand"], [data-crud-field-id="erpSupplierRef"]')).toHaveCount(0)
  expect(policyCalls).toEqual([])
})

test('preserves Todo custom field snapshots through a legacy update, undo, redo and second undo', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const created = await apiRequest(request, 'POST', todoApi, {
    token, data: { title: `Replay ${randomUUID()}`, cf_priority: 2, cf_severity: 'medium' },
  })
  expect(created.status(), 'Create the scoped replay fixture').toBe(201)
  const { id } = await created.json() as { id: string }
  const actionPath = '/api/audit_logs/audit-logs/actions'
  const operation = (header: string | undefined) => {
    if (!header?.startsWith('omop:')) throw new Error('Expected an action log operation')
    const payload = JSON.parse(decodeURIComponent(header.slice(5))) as { id?: unknown; undoToken?: unknown }
    if (typeof payload.id !== 'string' || typeof payload.undoToken !== 'string') {
      throw new Error('Expected an undoable action log operation')
    }
    return { id: payload.id, undoToken: payload.undoToken }
  }
  async function expectPriority(expected: number) {
    const read = await apiRequest(request, 'GET', `${todoApi}?id=${id}&pageSize=1&sectionDetail=showcase`, { token })
    expect(read.status()).toBe(200)
    expect((await read.json()).items[0]).toMatchObject({ id, cf_priority: expected })
  }
  try {
    const update = await apiRequest(request, 'PUT', todoApi, { token, data: { id, cf_priority: 4, cf_severity: 'medium' } })
    expect(update.status(), 'Headerless legacy Todo update').toBe(200)
    const first = operation(update.headers()['x-om-operation'])
    await expectPriority(4)
    expect((await apiRequest(request, 'POST', `${actionPath}/undo`, { token, data: { undoToken: first.undoToken } })).status()).toBe(200)
    await expectPriority(2)
    const redo = await apiRequest(request, 'POST', `${actionPath}/redo`, { token, data: { logId: first.id } })
    expect(redo.status()).toBe(200)
    const replayed = operation(redo.headers()['x-om-operation'])
    await expectPriority(4)
    expect((await apiRequest(request, 'POST', `${actionPath}/undo`, { token, data: { undoToken: replayed.undoToken } })).status()).toBe(200)
    await expectPriority(2)
  } finally {
    await deleteEntityIfExists(request, token, todoApi, id)
  }
})
