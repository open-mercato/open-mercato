import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectOperation, redoOk, skipIfUndoTestsDisabled, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { Migration20261104143948_sales } from '../migrations/Migration20261104143948_sales'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { seedSystemEmailChannel, deleteChannelIfExists } from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import type { QuoteValiditySettings } from '../data/validators'

const settingsPath = '/api/sales/settings/quote-validity'
const versionHeader = 'x-om-ext-optimistic-lock-expected-updated-at'

async function readSettings(request: APIRequestContext, token: string, headers?: Record<string, string>) {
  const response = await apiRequest(request, 'GET', settingsPath, { token, headers })
  expect(response.status()).toBe(200)
  const settings = await readJsonSafe<QuoteValiditySettings>(response)
  if (!settings) throw new Error('[internal] Missing quote validity settings response')
  return settings
}

const test = base.extend<{ validity: { token: string; original: QuoteValiditySettings } }>({
  validity: async ({ request }, use) => {
    const token = await getAuthToken(request, 'admin')
    const original = await readSettings(request, token)
    try {
      const response = await apiRequest(request, 'PUT', settingsPath, { token, data: { defaultQuoteValidityDays: 30 } })
      expect(response.status()).toBe(200)
      await use({ token, original })
    } finally {
      const restored = await apiRequest(request, 'PUT', settingsPath, { token, data: { defaultQuoteValidityDays: original.defaultQuoteValidityDays } })
      expect(restored.status()).toBe(200)
    }
  },
})

async function createQuoteWithRecipient(request: APIRequestContext, token: string, validUntil: string | null = null) {
  const response = await apiRequest(request, 'POST', '/api/sales/quotes', {
    token, retryTransport: false,
    data: {
      currencyCode: 'USD', metadata: { customerEmail: `qa-8140-${randomUUID()}@example.test` },
      ...(validUntil ? { validUntil } : {}),
    },
  })
  expect(response.status()).toBe(201)
  const quote = await readJsonSafe<{ id: string }>(response)
  if (!quote?.id) throw new Error('[internal] Missing created quote id')
  return quote.id
}

async function readQuote(request: APIRequestContext, token: string, quoteId: string) {
  const response = await apiRequest(request, 'GET', `/api/sales/quotes?id=${encodeURIComponent(quoteId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<{ id: string; validUntil: string | null }> }>(response)
  const quote = body?.items.find((item) => item.id === quoteId)
  if (!quote) throw new Error('[internal] Quote fixture was not returned')
  return { ...quote, validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : null }
}

async function openSendDialog(page: Page) {
  const actions = page.getByRole('button', { name: 'Actions', exact: true })
  await actions.press('Enter')
  await expect(actions).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('menuitem', { name: 'Send to customer', exact: true }).click()
  return page.getByRole('dialog')
}

test('persists settings and rejects invalid values and stale versions', async ({ request, validity }) => {
  const current = await readSettings(request, validity.token)
  expect(current.defaultQuoteValidityDays).toBe(30)
  expect(current.updatedAt).toBeTruthy()
  const updated = await apiRequest(request, 'PUT', settingsPath, { token: validity.token, data: { defaultQuoteValidityDays: 45 } })
  expect(updated.status()).toBe(200)
  const stale = await apiRequest(request, 'PUT', settingsPath, {
    token: validity.token, data: { defaultQuoteValidityDays: 60 }, headers: { [versionHeader]: current.updatedAt! },
  })
  expect(stale.status()).toBe(409)
  expect((await readJsonSafe<{ code: string }>(stale))?.code).toBe('optimistic_lock_conflict')
  for (const days of [0, 366, 1.5, null]) {
    const invalid = await apiRequest(request, 'PUT', settingsPath, { token: validity.token, data: { defaultQuoteValidityDays: days } })
    expect(invalid.status()).toBe(400)
  }
  expect((await readSettings(request, validity.token)).defaultQuoteValidityDays).toBe(45)
})

test('isolates organizations and safely handles concurrent first writes', async ({ request, validity }) => {
  expect(process.env.OM_INTEGRATION_TEST).toBe('true')
  expect(process.env.DATABASE_URL, 'DB fixtures require the native runner environment').toBeTruthy()
  const token = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenScope(token)
  let organizationId: string | null = null
  try {
    organizationId = await createOrganizationInDb({ name: `QA quote validity 8140 ${Date.now()}`, tenantId })
    const headers = { Cookie: `om_selected_org=${organizationId}; om_selected_tenant=${tenantId}` }
    expect(await readSettings(request, token, headers)).toEqual({ defaultQuoteValidityDays: 14, updatedAt: null })
    const responses = await Promise.all([45, 60].map((days) => apiRequest(request, 'PUT', settingsPath, {
      token, headers, data: { defaultQuoteValidityDays: days, organizationId: getTokenScope(validity.token).organizationId },
    })))
    for (const response of responses) expect(response.status()).toBe(200)
    expect([45, 60]).toContain((await readSettings(request, token, headers)).defaultQuoteValidityDays)
    const count = await withClient((client) => client.query<{ count: string }>('select count(*)::text as count from sales_settings where tenant_id = $1 and organization_id = $2', [tenantId, organizationId]))
    expect(count.rows[0].count).toBe('1')
    expect((await readSettings(request, validity.token)).defaultQuoteValidityDays).toBe(30)
    const rejectedOrganizationId = randomUUID()
    const rejectedHeaders = { Cookie: `om_selected_org=${rejectedOrganizationId}; om_selected_tenant=${tenantId}` }
    const rejectedRead = await apiRequest(request, 'GET', settingsPath, { token, headers: rejectedHeaders })
    const rejectedWrite = await apiRequest(request, 'PUT', settingsPath, { token, headers: rejectedHeaders, data: { defaultQuoteValidityDays: 45 } })
    expect(rejectedRead.status()).toBe(403)
    expect(rejectedWrite.status()).toBe(403)
    const rejectedRows = await withClient((client) => client.query<{ count: string }>('select count(*)::text as count from sales_settings where tenant_id = $1 and organization_id = $2', [tenantId, rejectedOrganizationId]))
    expect(rejectedRows.rows[0].count).toBe('0')
  } finally {
    if (organizationId) await withClient((client) => client.query('delete from sales_settings where tenant_id = $1 and organization_id = $2', [tenantId, organizationId]))
    await deleteOrganizationInDb(organizationId)
  }
})

test('checks permissions and rejects unauthorized organization and tenant selections', async ({ request }) => {
  test.slow()
  const admin = await getAuthToken(request, 'admin')
  const superadmin = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenScope(admin)
  const stamp = randomUUID()
  const roles: string[] = []
  const users: string[] = []
  const organizations: Array<{ id: string; tenantId: string }> = []
  let foreignTenantId: string | null = null
  const data = { defaultQuoteValidityDays: 45 }

  async function createActor(features: string[]) {
    const roleId = await createRoleFixture(request, admin, { name: `Quote validity role ${randomUUID()}`, tenantId })
    roles.push(roleId)
    await setRoleAclFeatures(request, admin, { roleId, features, organizations: [organizationId] })
    const email = `qa-quote-${randomUUID()}@example.test`
    const password = `Qa-${randomUUID()}-Aa1!`
    users.push(await createUserFixture(request, admin, { email, password, organizationId, roles: [roleId] }))
    return getAuthToken(request, email, password)
  }

  try {
    for (const method of ['GET', 'PUT']) {
      const response = await apiRequest(request, method, settingsPath, { token: '', ...(method === 'PUT' ? { data } : {}) })
      expect(response.status()).toBe(401)
    }
    const denied = await createActor(['sales.settings.view'])
    expect((await apiRequest(request, 'GET', settingsPath, { token: denied })).status()).toBe(403)
    const quoteManager = await createActor(['sales.quotes.manage'])
    expect((await apiRequest(request, 'GET', settingsPath, { token: quoteManager })).status()).toBe(200)
    expect((await apiRequest(request, 'PUT', settingsPath, { token: quoteManager, data })).status()).toBe(403)

    const settingsManager = await createActor(['sales.settings.manage'])
    expect((await apiRequest(request, 'GET', settingsPath, { token: settingsManager })).status()).toBe(200)
    const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superadmin, data: { name: `Quote validity tenant ${stamp}` },
    })
    expect(tenant.status()).toBe(201)
    foreignTenantId = expectId((await readJsonSafe<{ id: string }>(tenant))?.id, 'Tenant fixture has an id')
    for (const targetTenant of [tenantId, foreignTenantId]) {
      const targetOrg = await createOrganizationFixture(request, superadmin, {
        name: `Quote validity organization ${targetTenant} ${stamp}`, tenantId: targetTenant,
      })
      organizations.push({ id: targetOrg, tenantId: targetTenant })
      const headers = { Cookie: `om_selected_org=${targetOrg}; om_selected_tenant=${targetTenant}` }
      await withClient((client) => client.query(
        'insert into sales_settings (id, tenant_id, organization_id, order_number_format, quote_number_format, default_quote_validity_days, updated_at, created_at) values ($1, $2, $3, $4, $5, $6, now(), now()) on conflict (organization_id, tenant_id) do update set default_quote_validity_days = excluded.default_quote_validity_days',
        [randomUUID(), targetTenant, targetOrg, 'ORDER-{seq:5}', 'QUOTE-{seq:5}', 21],
      ))
      expect((await apiRequest(request, 'GET', settingsPath, { token: settingsManager, headers })).status()).toBe(403)
      const deniedWrite = await apiRequest(request, 'PUT', settingsPath, {
        token: settingsManager, headers, data: { ...data, tenantId: targetTenant, organizationId: targetOrg },
      })
      expect(deniedWrite.status()).toBe(403)
      expect((await withClient((client) => client.query(
        'select default_quote_validity_days from sales_settings where tenant_id = $1 and organization_id = $2',
        [targetTenant, targetOrg],
      ))).rows).toEqual([{ default_quote_validity_days: 21 }])
    }
  } finally {
    for (const userId of users) await deleteUserIfExists(request, admin, userId)
    for (const roleId of roles) await deleteRoleIfExists(request, admin, roleId)
    for (const organization of organizations) {
      await withClient((client) => client.query(
        'delete from sales_settings where tenant_id = $1 and organization_id = $2',
        [organization.tenantId, organization.id],
      ))
      await deleteOrganizationIfExists(request, superadmin, organization.id)
    }
    await deleteGeneralEntityIfExists(request, superadmin, '/api/directory/tenants', foreignTenantId)
  }
})

test('restores quote validity through command undo and redo without overwriting other settings', async ({ request, validity }) => {
  skipIfUndoTestsDisabled()
  const { tenantId, organizationId } = getTokenScope(validity.token)
  const numberingAndEditing = async () => (await withClient((client) => client.query(
    'select order_number_format, quote_number_format, order_customer_editable_statuses, order_address_editable_statuses from sales_settings where tenant_id = $1 and organization_id = $2',
    [tenantId, organizationId],
  ))).rows

  const before = await numberingAndEditing()
  expect(before).toHaveLength(1)
  const update = await apiRequest(request, 'PUT', settingsPath, {
    token: validity.token, data: { defaultQuoteValidityDays: 45 },
  })
  expect(update.status()).toBe(200)
  const operation = expectOperation(update, 'quote validity save')
  expect((await readSettings(request, validity.token)).defaultQuoteValidityDays).toBe(45)

  const logId = await undoOk(request, validity.token, operation.undoToken, 'quote validity')
  expect((await readSettings(request, validity.token)).defaultQuoteValidityDays).toBe(30)
  await redoOk(request, validity.token, logId, 'quote validity')
  expect((await readSettings(request, validity.token)).defaultQuoteValidityDays).toBe(45)
  expect(await numberingAndEditing()).toEqual(before)

  const olderSave = await apiRequest(request, 'PUT', settingsPath, {
    token: validity.token, data: { defaultQuoteValidityDays: 55 },
  })
  expect(olderSave.status()).toBe(200)
  const olderOperation = expectOperation(olderSave, 'intermediate quote validity save')
  const olderVersion = (await readSettings(request, validity.token)).updatedAt
  expect(olderVersion).toBeTruthy()

  const newerSave = await apiRequest(request, 'PUT', settingsPath, {
    token: validity.token, data: { defaultQuoteValidityDays: 65 },
  })
  expect(newerSave.status()).toBe(200)
  const newerOperation = expectOperation(newerSave, 'newest quote validity save')
  const newerSettings = await readSettings(request, validity.token)
  expect(newerSettings.defaultQuoteValidityDays).toBe(65)

  const supersededUndo = await undoByToken(request, validity.token, olderOperation.undoToken)
  expect(supersededUndo.status()).toBe(400)
  expect(await readJsonSafe(supersededUndo)).toEqual({ error: 'Undo token not available' })
  expect(await readSettings(request, validity.token)).toEqual(newerSettings)

  await undoOk(request, validity.token, newerOperation.undoToken, 'newest quote validity save')
  const restoredSettings = await readSettings(request, validity.token)
  expect(restoredSettings.defaultQuoteValidityDays).toBe(55)
  expect(restoredSettings.updatedAt).toBeTruthy()
  expect(restoredSettings.updatedAt).not.toBe(olderVersion)

  const staleVersionUndo = await undoByToken(request, validity.token, olderOperation.undoToken)
  expect(staleVersionUndo.status()).toBe(409)
  expect(await readJsonSafe(staleVersionUndo)).toMatchObject({
    code: 'optimistic_lock_conflict',
    currentUpdatedAt: restoredSettings.updatedAt,
    expectedUpdatedAt: olderVersion,
  })
  expect(await readSettings(request, validity.token)).toEqual(restoredSettings)
  expect(await numberingAndEditing()).toEqual(before)
})

test('the migration round-trips without changing numbering and editing settings', async () => {
  await withClient(async (client) => {
    const schema = `quote_validity_${randomUUID().replace(/-/g, '')}`
    const previousPath = (await client.query<{ search_path: string }>('show search_path')).rows[0].search_path
    const migration = new Migration20261104143948_sales(
      {} as ConstructorParameters<typeof Migration20261104143948_sales>[0],
      {} as ConstructorParameters<typeof Migration20261104143948_sales>[1],
    )
    const migrate = async (direction: 'up' | 'down') => {
      migration.reset()
      await migration[direction]()
      for (const sql of migration.getQueries()) await client.query(String(sql))
    }

    try {
      await client.query(`create schema "${schema}"`)
      await client.query("select set_config('search_path', $1, false)", [schema])
      await client.query('create table sales_settings (id uuid primary key, order_number_format text not null, quote_number_format text not null, order_customer_editable_statuses jsonb, order_address_editable_statuses jsonb)')
      await client.query('insert into sales_settings values ($1, $2, $3, $4, $5)', [
        randomUUID(), 'CUSTOM-ORDER-{seq:7}', 'CUSTOM-QUOTE-{seq:7}', '["draft"]', '["confirmed"]',
      ])
      const original = (await client.query('select * from sales_settings')).rows
      await migrate('up')
      expect((await client.query('select * from sales_settings')).rows).toEqual(
        original.map((row) => ({ ...row, default_quote_validity_days: 14 })),
      )
      await client.query('update sales_settings set default_quote_validity_days = 36')
      expect((await client.query('select default_quote_validity_days from sales_settings')).rows).toEqual([{ default_quote_validity_days: 36 }])
      await migrate('down')
      expect((await client.query('select * from sales_settings')).rows).toEqual(original)
      await migrate('up')
      expect((await client.query('select * from sales_settings')).rows).toEqual(
        original.map((row) => ({ ...row, default_quote_validity_days: 14 })),
      )
    } finally {
      await client.query("select set_config('search_path', $1, false)", [previousPath])
      await client.query(`drop schema if exists "${schema}" cascade`)
    }
  })
})

for (const explicitDays of [undefined, 7]) {
  test(`send uses ${explicitDays === undefined ? 'configured fallback' : 'explicit duration'} and persists validity`, async ({ request, validity }) => {
    let quoteId: string | null = null
    let channelId: string | null = null
    try {
      channelId = await seedSystemEmailChannel(request, validity.token)
      quoteId = await createQuoteWithRecipient(request, validity.token, new Date(Date.now() + 86400000).toISOString())
      const before = Date.now()
      const response = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token: validity.token, data: { quoteId, ...(explicitDays === undefined ? {} : { validForDays: explicitDays }) },
      })
      expect(response.status()).toBe(200)
      const quote = await readQuote(request, validity.token, quoteId)
      const expectedDays = explicitDays ?? 30
      const validUntil = Date.parse(quote.validUntil ?? '')
      expect(validUntil).toBeGreaterThanOrEqual(before + expectedDays * 86400000)
      expect(validUntil).toBeLessThanOrEqual(Date.now() + expectedDays * 86400000)
    } finally {
      await deleteSalesEntityIfExists(request, validity.token, '/api/sales/quotes', quoteId)
      await deleteChannelIfExists(request, validity.token, channelId)
    }
  })
}

test('sales configuration saves the default and reloads it', async ({ page, request, validity }, testInfo) => {
  await login(page, 'admin')
  await page.goto('/backend/config/sales')
  const section = page.getByRole('region', { name: 'Quote validity', exact: true })
  const field = section.getByRole('textbox')
  await expect(field).toHaveValue('30')
  await field.fill('45')
  await section.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect.poll(async () => (await readSettings(request, validity.token)).defaultQuoteValidityDays).toBe(45)
  await page.reload()
  await expect(field).toHaveValue('45')
  const screenshot = testInfo.outputPath('quote-validity-settings.png')
  await section.screenshot({ path: screenshot })
  await testInfo.attach('quote-validity-settings', { path: screenshot, contentType: 'image/png' })
})

for (const futureDate of [false, true]) {
  test(`send dialog suggests ${futureDate ? 'the quote date' : 'the configured default'} and cancels without a write`, async ({ page, request, validity }, testInfo) => {
    let quoteId: string | null = null
    try {
      const validUntil = futureDate ? new Date(Date.now() + 5 * 86400000).toISOString() : null
      quoteId = await createQuoteWithRecipient(request, validity.token, validUntil)
      expect((await readQuote(request, validity.token, quoteId)).validUntil).toBe(validUntil)
      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${quoteId}`)
      const dialog = await openSendDialog(page)
      await expect(dialog.getByRole('spinbutton', { name: 'Valid for (days)' })).toHaveValue(futureDate ? '5' : '30')
      const screenshot = testInfo.outputPath(futureDate ? 'quote-date-suggestion.png' : 'quote-default-suggestion.png')
      await page.screenshot({ path: screenshot, fullPage: true })
      await testInfo.attach('quote-validity-dialog', { path: screenshot, contentType: 'image/png' })
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      expect((await readQuote(request, validity.token, quoteId)).validUntil).toBe(validUntil)
    } finally {
      await deleteSalesEntityIfExists(request, validity.token, '/api/sales/quotes', quoteId)
    }
  })
}

test('send dialog submits a manual duration with Ctrl+Enter', async ({ page, request, validity }) => {
  let quoteId: string | null = null
  let channelId: string | null = null
  try {
    channelId = await seedSystemEmailChannel(request, validity.token)
    quoteId = await createQuoteWithRecipient(request, validity.token)
    await login(page, 'admin')
    await page.goto(`/backend/sales/quotes/${quoteId}`)
    const dialog = await openSendDialog(page)
    const field = dialog.getByRole('spinbutton', { name: 'Valid for (days)' })
    await expect(field).toHaveValue('30')
    await field.press('ControlOrMeta+A')
    await field.press('7')
    await expect(field).toHaveValue('7')
    const before = Date.now()
    const sent = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/sales/quotes/send' && response.request().method() === 'POST')
    await field.press('Control+Enter')
    const response = await sent
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON()).toMatchObject({ quoteId, validForDays: 7 })
    await expect(dialog).not.toBeVisible()
    const quote = await readQuote(request, validity.token, quoteId)
    expect(Date.parse(quote.validUntil ?? '')).toBeGreaterThanOrEqual(before + 7 * 86400000)
    expect(Date.parse(quote.validUntil ?? '')).toBeLessThanOrEqual(Date.now() + 7 * 86400000)
  } finally {
    await deleteSalesEntityIfExists(request, validity.token, '/api/sales/quotes', quoteId)
    await deleteChannelIfExists(request, validity.token, channelId)
  }
})
