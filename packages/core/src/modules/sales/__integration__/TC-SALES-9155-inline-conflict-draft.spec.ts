import { randomUUID } from 'node:crypto'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

test('a refused stale Sales inline save retains its draft and preserves the other actor change', async ({ browser, page, request }) => {
  test.setTimeout(90_000)
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const suffix = randomUUID()
  const password = `QaSales1!${suffix}`
  const emails = [`qa-sales-draft-a-${suffix}@example.com`, `qa-sales-draft-b-${suffix}@example.com`]
  const userIds: string[] = []
  let roleId: string | null = null
  let quoteId: string | null = null
  let secondContext: BrowserContext | null = null

  async function signIn(actorPage: Page, email: string) {
    await actorPage.goto('/login', { waitUntil: 'networkidle' })
    await actorPage.getByLabel('Email', { exact: true }).fill(email)
    await actorPage.getByLabel('Password', { exact: true }).fill(password)
    await actorPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect.poll(() => actorPage.url()).toContain('/backend')
  }

  async function readQuote(token: string): Promise<Record<string, unknown>> {
    const response = await apiRequest(request, 'GET', `/api/sales/quotes?id=${quoteId}`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(response)
    const record = body?.items.find((item) => item.id === quoteId)
    if (!record) throw new Error('[internal] test quote missing')
    return record
  }

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `QA Sales draft ${suffix}`, tenantId: scope.tenantId ?? undefined })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      organizations: [scope.organizationId!],
      features: [
        'sales.orders.view', 'sales.orders.manage', 'sales.quotes.view', 'sales.quotes.manage',
        'sales.channels.view', 'sales.settings.view', 'sales.settings.manage',
        'customers.people.view', 'customers.companies.view', 'customers.settings.manage',
        'catalog.products.view', 'catalog.prices.view', 'catalog.settings.manage', 'currencies.view',
        'dictionaries.view', 'dictionaries.manage',
      ],
    })
    for (const email of emails) {
      userIds.push(await createUserFixture(request, adminToken, { email, password, organizationId: scope.organizationId!, roles: [roleId] }))
    }
    const actorToken = await getAuthToken(request, emails[0], password)
    const created = await apiRequest(request, 'POST', '/api/sales/quotes', { token: actorToken, data: { currencyCode: 'USD', comments: 'Original comment' } })
    expect(created.status()).toBe(201)
    quoteId = (await readJsonSafe<{ id: string }>(created))?.id ?? null
    expect(quoteId).toBeTruthy()
    secondContext = await browser.newContext({ baseURL: process.env.BASE_URL })
    const secondPage = await secondContext.newPage()
    await signIn(page, emails[0])
    await signIn(secondPage, emails[1])
    const route = `/backend/sales/documents/${quoteId}?kind=quote`
    for (const actorPage of [page, secondPage]) {
      await actorPage.goto(route, { waitUntil: 'domcontentloaded' })
      await expect(actorPage.getByRole('button', { name: 'Comment Original comment', exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Comment Original comment', exact: true }).click()
    const draft = page.getByRole('textbox', { name: 'Add comment', exact: true })
    await draft.fill('Retained first actor draft')
    await secondPage.getByRole('button', { name: 'External reference Not set', exact: true }).click()
    await secondPage.getByRole('textbox', { name: 'Add external reference', exact: true }).fill('Second actor reference')
    const secondSave = secondPage.waitForResponse((response) => response.url().endsWith('/api/sales/quotes') && response.request().method() === 'PUT')
    await secondPage.getByRole('button', { name: 'Save (⌘/Ctrl+Enter)', exact: true }).click()
    expect((await secondSave).status()).toBe(200)
    const changed = await readQuote(actorToken)
    expect(changed.comment).toBe('Original comment')
    expect(changed.externalReference).toBe('Second actor reference')

    await page.bringToFront()
    for (const shortcut of [false, true]) {
      const refused = page.waitForResponse((response) => response.url().endsWith('/api/sales/quotes') && response.request().method() === 'PUT')
      if (shortcut) await draft.press('Control+Enter')
      else await page.getByRole('button', { name: 'Save (⌘/Ctrl+Enter)', exact: true }).click()
      expect((await refused).status()).toBe(409)
      await expect(draft).toHaveValue('Retained first actor draft')
      await expect(page.getByText('record_modified', { exact: true })).toHaveCount(0)
      expect(await readQuote(actorToken)).toEqual(changed)
    }
    await draft.press('Escape')
    await expect(draft).toHaveCount(0)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'External reference Second actor reference', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Comment Original comment', exact: true }).click()
    await draft.fill('Recovered first actor comment')
    const recovered = page.waitForResponse((response) => response.url().endsWith('/api/sales/quotes') && response.request().method() === 'PUT')
    await draft.press('Control+Enter')
    expect((await recovered).status()).toBe(200)
    const after = await readQuote(actorToken)
    expect(after.comment).toBe('Recovered first actor comment')
    expect(after.externalReference).toBe('Second actor reference')
    for (const [field, value] of Object.entries(changed)) {
      if (!['comment', 'updatedAt', 'updated_at'].includes(field)) expect(after[field], field).toEqual(value)
    }
  } finally {
    if (secondContext) await secondContext.close()
    if (quoteId) await deleteSalesEntityIfExists(request, adminToken, '/api/sales/quotes', quoteId)
    for (const userId of userIds.reverse()) await deleteUserIfExists(request, adminToken, userId)
    if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
  }
})
