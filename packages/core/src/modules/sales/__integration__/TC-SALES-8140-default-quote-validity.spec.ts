import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
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
  return quote
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
    await field.fill('7')
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
