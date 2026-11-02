import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const SEO_TITLE_ERROR = 'Title is too short for good SEO (min 10 characters).'

async function signIn(
  page: Page,
  credentials: { email: string; password: string },
  scope: { tenantId: string; organizationId: string },
): Promise<string> {
  const response = await postForm(page.request, '/api/auth/login', credentials)
  expect(response.status(), 'Browser login should succeed').toBe(200)
  const body = await readJsonSafe<{ token?: string }>(response)
  if (!body?.token) throw new Error('[internal] Browser login did not return a session token')
  const url = new URL(response.url()).origin
  await page.context().addCookies([
    { name: 'locale', value: 'en', url, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url, sameSite: 'Lax' },
  ])
  return body.token
}

async function expectProductPermissions(page: Page, token: string, canManage: boolean): Promise<void> {
  const response = await apiRequest(page.request, 'POST', '/api/auth/feature-check', {
    token,
    data: { features: ['catalog.products.view', 'catalog.products.manage'] },
  })
  expect(response.status()).toBe(200)
  expect(await readJsonSafe(response)).toMatchObject({
    ok: canManage,
    granted: canManage
      ? ['catalog.products.view', 'catalog.products.manage']
      : ['catalog.products.view'],
  })
}

async function openProduct(page: Page, productId: string, title: string): Promise<void> {
  await page.goto(`/backend/catalog/products/${productId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByRole('heading', { name: 'Edit product', exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('e.g., Summer sneaker')).toHaveValue(title)
}

test.describe('TC-SEC-015: feature-gated injection widgets', () => {
  test('gates the product SEO widget and its save handler by the viewing user’s features', async ({ page, request, browser, baseURL }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenContext(adminToken)
    const stamp = randomUUID()
    const title = 'Widget security regression product'
    const credentials = { email: `qa-widget-${stamp}@example.com`, password: `Test-${randomUUID()}!aA1` }
    const restrictedContext = await browser.newContext({ baseURL })
    let productId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title, sku: `qa-widget-${stamp}` })
      roleId = await createRoleFixture(request, adminToken, { name: `qa-widget-${stamp}`, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['catalog.products.view'] })
      userId = await createUserFixture(request, adminToken, {
        ...credentials,
        organizationId: scope.organizationId,
        roles: [roleId],
      })

      const browserAdminToken = await signIn(page, DEFAULT_CREDENTIALS.admin, scope)
      await expectProductPermissions(page, browserAdminToken, true)
      await openProduct(page, productId, title)
      await expect(page.getByText('Product SEO Helper', { exact: true })).toBeVisible()
      await expect(page.getByText('SEO Optimization', { exact: true })).toBeVisible()

      const adminWrites: string[] = []
      page.on('request', (outgoing) => {
        if (new URL(outgoing.url()).pathname === '/api/catalog/products' && outgoing.method() === 'PUT') {
          adminWrites.push(outgoing.url())
        }
      })
      await page.getByPlaceholder('e.g., Summer sneaker').fill('Short')
      await expect(page.getByText('Too short', { exact: true }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Save changes', exact: true }).first().click()
      await expect(page.getByText(SEO_TITLE_ERROR, { exact: true })).toBeVisible()
      expect(adminWrites, 'The granted widget should block the invalid save before the API call').toEqual([])

      const restrictedPage = await restrictedContext.newPage()
      const pageErrors: string[] = []
      restrictedPage.on('pageerror', (error) => pageErrors.push(error.message))
      const restrictedToken = await signIn(restrictedPage, credentials, scope)
      await expectProductPermissions(restrictedPage, restrictedToken, false)
      await openProduct(restrictedPage, productId, title)
      await expect(restrictedPage.getByRole('button', { name: 'Save changes', exact: true }).first()).toBeVisible()
      await expect(restrictedPage.getByText('Product SEO Helper', { exact: true })).toHaveCount(0)
      await expect(restrictedPage.getByText('SEO Optimization', { exact: true })).toHaveCount(0)
      await expect(restrictedPage.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0)
      expect(pageErrors, 'The product form should render without a browser crash').toEqual([])

      await restrictedPage.getByPlaceholder('e.g., Summer sneaker').fill('Short')
      const deniedSave = restrictedPage.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/catalog/products' && response.request().method() === 'PUT',
      )
      await restrictedPage.getByRole('button', { name: 'Save changes', exact: true }).first().click()
      expect((await deniedSave).status(), 'The hidden widget must let submission reach the server RBAC guard').toBe(403)
      await expect(restrictedPage.getByText(SEO_TITLE_ERROR, { exact: true })).toHaveCount(0)
      expect(pageErrors).toEqual([])
    } finally {
      await restrictedContext.close()
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
