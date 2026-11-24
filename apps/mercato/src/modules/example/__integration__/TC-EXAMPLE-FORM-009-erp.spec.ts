import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, deleteUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormPersistence'
import {
  captureShowcase, eligibleFixtureScope, field, policyApi, readReadyShowcasePolicy, saveShowcase,
  showcase, showcaseHeaders, test, todoApi,
} from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example', 'integrations', 'notifications'] }

test('TC-EXAMPLE-FORM-009 saves ERP details in an organization that predates setup', async ({ page, request }) => {
  test.slow()
  const admin = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenScope(admin)
  if (!tenantId) throw new Error('[internal] The upgrade fixture requires a scoped tenant')
  const stamp = randomUUID()
  const email = `todo-erp-upgrade-${stamp}@example.invalid`
  const password = `QaTodo-${stamp}!`
  const organizationId = await createOrganizationInDb({ name: `Todo ERP upgrade ${stamp}`, tenantId })
  let role: string | null = null
  let userId: string | null = null
  let todoId: string | null = null
  let token: string | null = null
  const readUpgradeState = () => withClient(async (client) => (await client.query<{
    credential_count: number; schedule_count: number
  }>(`select
       (select count(*)::int from integration_credentials where integration_id = 'example_todo_erp'
         and tenant_id = $1 and organization_id = $2) as credential_count,
       (select count(*)::int from scheduled_jobs where target_queue = 'crud-form-section-outbox-sweep'
         and tenant_id = $1 and organization_id = $2 and is_enabled and deleted_at is null) as schedule_count`,
    [tenantId, organizationId],
  )).rows[0])

  try {
    expect(await readUpgradeState()).toEqual({ credential_count: 0, schedule_count: 0 })
    role = await createRoleFixture(request, admin, { name: `Todo ERP upgrade ${stamp}` })
    userId = await createUserFixture(request, admin, { email, password, organizationId, roles: [role] })
    await setUserAclVisibility(request, admin, {
      userId, organizations: [organizationId], features: ['example.todos.view', 'example.todos.manage', 'entities.definitions.view'],
    })
    token = await getAuthToken(request, email, password)
    expect(getTokenScope(token).organizationId).toBe(organizationId)
    const created = await apiRequest(request, 'POST', todoApi, {
      token, data: { title: `ERP upgrade ${stamp}`, is_done: false, cf_priority: 2, cf_severity: 'medium' },
    })
    expect(created.status()).toBe(201)
    const record = await created.json() as { id: string }
    todoId = record.id
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'))
    await readReadyShowcasePolicy(page, async () => { await page.goto(`${showcase}/${record.id}`, { waitUntil: 'commit' }) })
    await expect(field(page, 'cf_priority').getByRole('textbox', { name: 'Priority level' })).toHaveValue('2')
    const supplier = field(page, 'erpSupplierRef').getByRole('textbox')
    await supplier.fill('SUP-100')
    await field(page, 'is_done').getByRole('checkbox').check()
    expect((await saveShowcase(page)).status()).toBe(200)
    await expect(page.getByRole('status').filter({ hasText: 'ERP delivery synced' })).toBeVisible({ timeout: 20_000 })
    expect(await readUpgradeState()).toEqual({ credential_count: 0, schedule_count: 1 })
    await captureShowcase(page, 'c9-upgraded-organization-synced')
    await page.reload()
    await expect(supplier).toHaveValue('SUP-100')
    await expect(field(page, 'is_done').getByRole('checkbox')).toBeChecked()
  } finally {
    if (token && todoId) await deleteEntityIfExists(request, token, todoApi, todoId)
    await withClient(async (client) => {
      const scope = [tenantId, organizationId]
      await client.query('delete from example_todo_erp_links where tenant_id = $1 and organization_id = $2', scope)
      await client.query('delete from sync_external_id_mappings where tenant_id = $1 and organization_id = $2', scope)
      await client.query('delete from integration_logs where tenant_id = $1 and organization_id = $2', scope)
      await client.query('delete from scheduled_jobs where tenant_id = $1 and organization_id = $2', scope)
    })
    await deleteUserIfExists(request, admin, userId)
    if (userId) await deleteUserAclInDb(userId)
    await deleteRoleIfExists(request, admin, role)
    await deleteOrganizationInDb(organizationId)
  }
})

test('TC-EXAMPLE-FORM-009 validates before writing and delivers, retries, and compensates through the ERP queue', async ({ page, request, showcaseTodo }) => {
  test.slow()
  const policy = await readReadyShowcasePolicy(page, showcaseTodo.open)
  const original = await showcaseTodo.read()
  const scope = eligibleFixtureScope(original)
  const supplier = field(page, 'erpSupplierRef').getByRole('textbox')
  const status = (text: string) => page.getByRole('status').filter({ hasText: text })
  const mirror = async () => withClient(async (client) => (await client.query<{
    sync_status: string; sync_attempts: number; last_error_code: string | null; pending_operation: string
    external_id: string | null; delivery_revision: string; next_attempt_at: Date | null; pending_reports: number
  }>(
    `select sync_status, sync_attempts, last_error_code, pending_operation, external_id, delivery_revision,
      next_attempt_at, jsonb_array_length(failure_reports) as pending_reports
      from example_todo_erp_links where host_id = $1 and tenant_id = $2 and organization_id = $3`,
    scope,
  )).rows[0] ?? null)

  await field(page, 'cf_priority').getByRole('textbox', { name: 'Priority level' }).fill('4')
  await supplier.fill('invalid')
  const invalid = await saveShowcase(page)
  expect(invalid.status()).toBe(422)
  expect(await invalid.json()).toMatchObject({ fieldErrors: { 'extensions.example.erpSupplierRef': 'example.todo.erp.errors.supplier' } })
  await expect(field(page, 'erpSupplierRef').getByText('The ERP could not verify this supplier reference.')).toBeVisible()
  expect(await mirror()).toBeNull()
  expect(await showcaseTodo.read()).toMatchObject({ updatedAt: original.updatedAt, cf_priority: original.cf_priority })

  await supplier.fill('timeout')
  const timeout = await saveShowcase(page)
  expect(timeout.status()).toBe(503)
  expect(await timeout.json()).toMatchObject({ code: 'crud_form_section_external_unavailable' })
  await expect(page.getByText('External delivery is unavailable. Try again later.').last()).toBeVisible()
  expect(await mirror()).toBeNull()
  expect(await showcaseTodo.read()).toMatchObject({ updatedAt: original.updatedAt, cf_priority: original.cf_priority })

  await supplier.fill('retry')
  expect((await saveShowcase(page)).status()).toBe(200)
  await expect(status('ERP delivery pending')).toBeVisible({ timeout: 5_000 })
  await status('ERP delivery pending').scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c9-pending')
  await expect.poll(async () => {
    const row = await mirror()
    return {
      status: row?.sync_status, code: row?.last_error_code,
      attempted: (row?.sync_attempts ?? 0) > 0, scheduled: Boolean(row?.next_attempt_at),
    }
  }, { intervals: [150, 180, 210], timeout: 12_000 }).toEqual({
    status: 'pending', code: 'delivery_unavailable', attempted: true, scheduled: true,
  })
  await expect(status('ERP delivery failed')).toBeVisible({ timeout: 25_000 })
  expect(await mirror()).toMatchObject({ sync_status: 'failed', sync_attempts: 3, pending_operation: 'upsert' })
  expect(Number(getCustomFieldValue(await showcaseTodo.read(), 'priority'))).toBe(4)
  const retry = page.getByRole('button', { name: 'Retry ERP delivery' })
  await expect(retry).toBeVisible()
  await retry.scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c9-failed-with-retry')

  await expect.poll(async () => {
    const query = new URLSearchParams({ type: 'example.todo.erp.failed', sourceEntityId: original.id, pageSize: '1' })
    const response = await apiRequest(request, 'GET', `/api/notifications?${query}`, {
      token: showcaseTodo.token,
    })
    if (!response.ok()) return false
    const body = await response.json() as { items?: Array<{ sourceEntityId?: string }> }
    return body.items?.some((item) => item.sourceEntityId === original.id) ?? false
  }, { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => (await mirror())?.pending_reports).toBe(0)

  const retryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `${policyApi}/retry` && response.request().method() === 'POST')
  await retry.click()
  expect((await retryResponse).status()).toBe(200)
  await expect(status('ERP delivery synced')).toBeVisible({ timeout: 20_000 })
  const synced = await mirror()
  expect(synced).toMatchObject({ sync_status: 'synced', external_id: expect.any(String) })
  await status('ERP delivery synced').scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c9-synced')

  const committed = await showcaseTodo.read()
  const deleted = await apiRequest(request, 'DELETE', policyApi, {
    token: showcaseTodo.token, headers: showcaseHeaders(policy, original.id, committed.updatedAt, 'delete'),
    data: { id: original.id },
  })
  expect(deleted.status()).toBe(200)
  await expect.poll(mirror, { timeout: 20_000 }).toMatchObject({ sync_status: 'synced', pending_operation: 'delete', external_id: null })
  const tombstone = await mirror()
  expect(BigInt(tombstone?.delivery_revision ?? '0')).toBeGreaterThan(BigInt(synced?.delivery_revision ?? '0'))
})
