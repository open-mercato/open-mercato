import { randomUUID } from 'node:crypto'
import { buildCrudFormSectionPolicyHeaders } from '@open-mercato/shared/lib/crud/form-sections/policy-headers'
import { readyResolveCrudFormSectionsResponseSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { expect, test as base, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const todoApi = '/api/example/todos'
export const policyApi = `${todoApi}/section-policy`
export const showcase = '/backend/example/form-extensions/todos'

export type TodoRecord = {
  id: string
  title: string
  notes: string | null
  is_done: boolean
  updatedAt: string
  _extensions?: { example?: Record<string, unknown> }
} & Record<string, unknown>

export const test = base.extend<{
  showcaseTodo: { id: string; title: string; notes: string; token: string; read(): Promise<TodoRecord>; open(): Promise<void> }
}>({
  showcaseTodo: async ({ request, page }, use) => {
    const token = await getAuthToken(request, 'admin')
    const title = `Form sections ${randomUUID()}`
    const notes = `Preserved ${title}`
    const creation = await apiRequest(request, 'POST', todoApi, {
      token, data: { title, notes, is_done: false, cf_priority: 2, cf_severity: 'medium' },
    })
    expect(creation.status()).toBe(201)
    const created = await readJsonSafe<{ id?: string }>(creation)
    if (!created?.id) throw new Error('[internal] Todo setup omitted the record ID')
    const { id } = created

    try {
      await use({
        id, title, notes, token,
        async read() {
          const response = await apiRequest(request, 'GET', `${todoApi}?id=${id}&pageSize=1&sectionDetail=showcase`, { token })
          expect(response.status()).toBe(200)
          const payload = await readJsonSafe<{ items?: TodoRecord[] }>(response)
          const record = payload?.items?.[0]
          if (!record || record.id !== id) throw new Error('[internal] Missing scoped Todo')
          return record
        },
        async open() {
          await login(page, 'admin')
          await page.goto(`${showcase}/${id}`, { waitUntil: 'commit' })
          await expect(field(page, 'is_done')).toBeVisible()
        },
      })
    } finally {
      await deleteEntityIfExists(request, token, todoApi, id)
    }
  },
})

export function field(page: Page, id: string) {
  return page.locator(`[data-crud-field-id="${id}"]`)
}

export async function saveShowcase(page: Page) {
  const result = page.waitForResponse((response) =>
    new URL(response.url()).pathname === policyApi && response.request().method() === 'PUT')
  await field(page, 'is_done').locator('xpath=ancestor::form[1]').locator('button[type="submit"]').first().click()
  return result
}

export async function captureShowcase(page: Page, name: string) {
  if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
    await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' })
  }
}

export async function readReadyShowcasePolicy(page: Page, open: () => Promise<void>) {
  const result = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/extensions/crud-form-sections/resolve'
    && response.request().method() === 'POST')
  await open()
  const response = await result
  expect(response.status()).toBe(200)
  const policy = readyResolveCrudFormSectionsResponseSchema.safeParse(await response.json())
  if (!policy.success) throw new Error('[internal] Expected a ready section policy')
  return policy.data
}

export function showcaseHeaders(policy: Pick<Awaited<ReturnType<typeof readReadyShowcasePolicy>>, 'fingerprint' | 'policyToken'>,
  id: string, updatedAt: string, operation: 'update' | 'delete' = 'update') {
  return Object.fromEntries(buildCrudFormSectionPolicyHeaders({
    fingerprint: policy.fingerprint, policyToken: policy.policyToken,
    mutationSurfaceId: `example.todo-showcase-update.${operation}`,
    requestOperation: operation,
    hostResourceKind: 'example.todo', hostResourceId: id,
    mutationResourceKind: 'example.todo', mutationResourceId: id,
  }, { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt }))
}

export function eligibleFixtureScope(todo: TodoRecord) {
  const database = process.env.DATABASE_URL
  if (process.env.OM_INTEGRATION_TEST !== 'true' || process.env.OM_TEST_MODE !== '1'
      || !database || new URL(database).pathname !== '/mercato_test') {
    throw new Error('[internal] The storage test requires an owned integration database')
  }
  const uuid = /^[a-f0-9-]{36}$/i
  if (!uuid.test(todo.id) || typeof todo.tenant_id !== 'string' || !uuid.test(todo.tenant_id)
      || typeof todo.organization_id !== 'string' || !uuid.test(todo.organization_id)) {
    throw new Error('[internal] Todo fixture must have a concrete scope')
  }
  return [todo.id, todo.tenant_id, todo.organization_id] as const
}
