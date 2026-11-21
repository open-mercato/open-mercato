import { captureShowcase, field, saveShowcase, test as configuredTest } from './todoShowcaseFixtures'
import { randomUUID } from 'node:crypto'
import { errors, expect, test, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { CONFLICT_BANNER_TESTID, CONFLICT_DIALOG_TESTID, expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi'
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
    await captureShowcase(page, 'c2-configured-create')
    const mutation = page.waitForResponse((response) =>
      new URL(response.url()).pathname === policyApi && response.request().method() === 'POST')
    await form.locator('button[type="submit"]').first().click()
    const result = await mutation
    expect(result.status()).toBe(201)
    id = (await result.json()).id
    await expect(page).toHaveURL(`${showcase}/${id}`)
    await expect(field(page, 'is_done')).toBeVisible()
    await captureShowcase(page, 'c2-created-todo-edit')
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
        const deleteWon = contender === 'delete' && results[1].status() === 200
        if (deleteWon) expect(items).toEqual([])
        else expect(items[0]).toMatchObject({ id, title, is_done: true })
      } finally {
        await deleteEntityIfExists(request, token, todoApi, id)
      }
    })
  }
})

test('TC-EXAMPLE-FORM-012 keeps ordinary create and edit on the legacy Todo endpoint', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  await login(page, 'admin')
  const policyCalls: string[] = []
  let id: string | null = null
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/extensions/crud-form-sections/resolve') policyCalls.push(request.url())
  })
  try {
    await page.goto('/backend/todos/create')
    const title = field(page, 'title').locator('input').first()
    await expect(title).toBeVisible()
    await expect(field(page, 'cf_priority').locator('input').first()).toBeVisible()
    await expect(page.locator('[data-crud-field-id="cf_season"], [data-crud-field-id="brand"], [data-crud-field-id="erpSupplierRef"]')).toHaveCount(0)
    await title.fill(`Legacy ${randomUUID()}`)
    const severity = field(page, 'cf_severity').getByRole('combobox').first()
    await expect(severity).toHaveText('Medium')
    await captureShowcase(page, 'c12-ordinary-create')
    const submit = () => title.locator('xpath=ancestor::form[1]').locator('button[type="submit"]').first().click()
    const pendingCreate = page.waitForResponse((res) => new URL(res.url()).pathname === todoApi && res.request().method() === 'POST')
    await submit()
    const created = await pendingCreate
    expect(created.status()).toBe(201)
    id = (await created.json() as { id: string }).id
    await page.goto(`/backend/todos/${id}/edit`)
    await expect(title).toBeVisible()
    await expect(page.locator('[data-crud-field-id="cf_season"], [data-crud-field-id="brand"], [data-crud-field-id="erpSupplierRef"]')).toHaveCount(0)
    await captureShowcase(page, 'c12-ordinary-edit')
    const changed = `Updated ${randomUUID()}`
    await title.fill(changed)
    const pendingUpdate = page.waitForResponse((res) => new URL(res.url()).pathname === todoApi && res.request().method() === 'PUT')
    await submit()
    expect((await pendingUpdate).status()).toBe(200)
    const read = await apiRequest(request, 'GET', `${todoApi}?id=${id}&pageSize=1&sectionDetail=showcase`, { token })
    expect((await read.json()).items[0]).toMatchObject({ id, title: changed })
    expect(policyCalls).toEqual([])
  } finally {
    if (id) await deleteEntityIfExists(request, token, todoApi, id)
  }
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


configuredTest('TC-EXAMPLE-FORM-001 saves a visible field and shows a concurrent edit conflict', async ({ page, showcaseTodo }) => {
  configuredTest.slow()
  await showcaseTodo.open()
  await expect(field(page, 'title')).toHaveCount(0)
  await field(page, 'is_done').getByRole('checkbox').check()
  expect((await saveShowcase(page)).status()).toBe(200)
  await expect(field(page, 'is_done').getByRole('checkbox')).toBeChecked()
  expect(await showcaseTodo.read()).toMatchObject({ title: showcaseTodo.title, notes: showcaseTodo.notes, is_done: true })
  await captureShowcase(page, 'c1-preserved-hidden-title')

  await page.reload({ waitUntil: 'commit' })
  await expect(field(page, 'is_done').getByRole('checkbox')).toBeChecked()
  const other = await page.context().newPage()
  try {
    await other.goto(`${showcase}/${showcaseTodo.id}`, { waitUntil: 'commit' })
    await field(other, 'cf_priority').getByRole('textbox', { name: 'Priority level' }).fill('3')
    expect((await saveShowcase(other)).status()).toBe(200)
  } finally {
    await other.close()
  }
  const conflict = page.getByTestId(CONFLICT_BANNER_TESTID).or(page.getByTestId(CONFLICT_DIALOG_TESTID)).first()
  const staleWrites: Request[] = []
  const captureWrite = (request: Request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === policyApi) staleWrites.push(request)
  }
  page.on('request', captureWrite)
  try {
    if (!await conflict.isVisible()) {
      try {
        await field(page, 'cf_priority').getByRole('textbox', { name: 'Priority level' }).fill('4', { timeout: 10_000 })
        await field(page, 'is_done').locator('xpath=ancestor::form[1]').locator('button[type="submit"]').first().click({ timeout: 10_000 })
      } catch (error) {
        if (!(error instanceof errors.TimeoutError) || !await conflict.isVisible()) throw error
      }
    }
    await expectConflictBanner(page)
    for (const request of staleWrites) expect((await request.response())?.status()).toBe(409)
  } finally {
    page.off('request', captureWrite)
  }
  expect(await showcaseTodo.read()).toMatchObject({
    title: showcaseTodo.title, notes: showcaseTodo.notes, is_done: true, cf_priority: 3,
  })
  await captureShowcase(page, 'c1-edit-conflict')
})
