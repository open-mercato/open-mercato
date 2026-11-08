import { expect, type APIRequestContext, type BrowserContext, type Page, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['documents', 'notifications'] }

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PASSWORD = 'DocsMention1!Pass'

type Created = { id: string; updatedAt: string }
type TestUser = { id: string; roleId: string; email: string; name: string; token: string }
type NotificationItem = { id?: string; type?: string }
type NotificationList = { items?: NotificationItem[] }

async function createUser(
  request: APIRequestContext,
  adminToken: string,
  stamp: number,
  label: string,
  features: string[],
): Promise<TestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, { name: `TC-DOCUMENTS-023 ${label} ${stamp}`, tenantId: scope.tenantId })
  await setRoleAclFeatures(request, adminToken, { roleId, features, organizations: null })
  const email = `tc-documents-023-${label}-${stamp}@example.com`
  const name = `Mention${label}${stamp}`
  const id = await createUserFixture(request, adminToken, {
    email, password: PASSWORD, organizationId: scope.organizationId, roles: [roleId], name,
  })
  return { id, roleId, email, name, token: await getAuthToken(request, email, PASSWORD) }
}

async function createDocument(request: APIRequestContext, token: string, title: string): Promise<Created> {
  const response = await apiRequest(request, 'POST', '/api/documents', { token, data: { title, folderId: null } })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status(), 'document create should return 201').toBe(201)
  return { id: expectId(body?.id, 'document id'), updatedAt: expectId(body?.updatedAt, 'document updatedAt') }
}

async function deleteDocument(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  const detail = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(id)}`, { token }).catch(() => null)
  const body = detail ? await readJsonSafe<{ updatedAt?: string }>(detail) : null
  await request.fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, ...(body?.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: body.updatedAt } : {}) },
  }).catch(() => undefined)
}

async function loginAs(page: Page, user: TestUser): Promise<void> {
  const scope = getTokenContext(user.token)
  await page.context().addCookies([
    { name: 'auth_token', value: user.token, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL },
  ])
}

async function listNotificationsBySource(
  request: APIRequestContext,
  token: string,
  sourceEntityId: string,
): Promise<NotificationItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/notifications?sourceEntityId=${encodeURIComponent(sourceEntityId)}`,
    { token },
  )
  const body = await readJsonSafe<NotificationList>(response)
  expect(response.status(), 'notification list should return 200').toBe(200)
  return Array.isArray(body?.items) ? body.items : []
}

function countByType(items: NotificationItem[], type: string): number {
  return items.filter((item) => item.type === type).length
}

async function pickMention(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Mention', exact: true }).click()
  const input = page.getByPlaceholder('Search people…')
  await expect(input).toBeVisible()
  await input.fill(name)
  const option = page.getByRole('option', { name: new RegExp(name) })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

test.describe('TC-DOCUMENTS-023: mention sharing feedback in real browser', () => {
  test('offers sharing only to eligible mentioned recipients and surfaces save feedback', async ({ browser, page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let document: Created | null = null
    let eligible: TestUser | null = null
    let denied: TestUser | null = null
    const extraContexts: BrowserContext[] = []

    try {
      adminToken = await getAuthToken(request, 'admin')
      eligible = await createUser(request, adminToken, stamp, 'eligible', ['documents.view', 'notifications.view'])
      denied = await createUser(request, adminToken, stamp, 'denied', ['notifications.view'])
      document = await createDocument(request, adminToken, `TC-DOCUMENTS-023 ${stamp}`)

      // Two-user stale-page integrity, part 1: open the eligible recipient's page
      // BEFORE any share exists so it observes the genuine denial, not a cached one.
      const eligibleContext = await browser.newContext({ baseURL: BASE_URL })
      extraContexts.push(eligibleContext)
      const eligiblePage = await eligibleContext.newPage()
      await loginAs(eligiblePage, eligible)
      await eligiblePage.goto(`/backend/documents/${document.id}`, { waitUntil: 'domcontentloaded' })
      // apiCall's global 403 handler throws a ForbiddenError whose literal
      // "Forbidden" message becomes the detail page's error state.
      await expect(eligiblePage.getByText('Forbidden', { exact: true })).toBeVisible({ timeout: 30_000 })

      await login(page, 'admin')
      await page.goto(`/backend/documents/${document.id}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('radio', { name: /^Edit$/ })).toBeVisible({ timeout: 30_000 })

      const composerInput = page.getByPlaceholder('Write a comment…')
      const composer = composerInput.locator('xpath=ancestor::form')
      const sendButton = composer.getByRole('button', { name: 'Comment', exact: true })

      // Failed-save retry: a guarded write failure must not clobber the composer body.
      const plainBody = `TC-DOCUMENTS-023 plain note ${stamp}`
      await composerInput.fill(plainBody)
      await page.route('**/comments', async (route) => {
        // An empty error body carries no message for raiseCrudError to extract,
        // so the composer's own `errorMessage` fallback copy renders.
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }, { times: 1 })
      await sendButton.click()
      await expect(page.getByText('Failed to save comment')).toBeVisible({ timeout: 10_000 })
      await expect(composerInput).toHaveValue(plainBody)
      await page.unroute('**/comments')
      const plainCreated = page.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/comments')
      ))
      await sendButton.click()
      expect((await plainCreated).status(), 'retried save should succeed').toBe(201)
      await expect(page.getByText(plainBody, { exact: true })).toBeVisible()
      await expect(composerInput).toHaveValue('')

      // Mixed mention: one eligible, unshared recipient and one denied recipient.
      const mentionBody = `TC-DOCUMENTS-023 mention ${stamp}`
      await composerInput.fill(mentionBody)
      await pickMention(page, eligible.name)
      await pickMention(page, denied.name)
      await expect(page.getByRole('button', { name: `Remove mention of ${eligible.name}` })).toBeVisible()
      await expect(page.getByRole('button', { name: `Remove mention of ${denied.name}` })).toBeVisible()

      const accessCheck = page.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/comments/access-check')
      ))
      await sendButton.click()
      expect((await accessCheck).status(), 'access-check should return 200').toBe(200)

      const grantDialog = page.getByRole('dialog', { name: 'Share to notify?' })
      await expect(grantDialog).toBeVisible({ timeout: 10_000 })
      await expect(grantDialog).toContainText(eligible.name)
      await expect(grantDialog).not.toContainText(denied.name)

      const mentionCreated = page.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/comments')
      ))
      await grantDialog.getByRole('button', { name: 'Share & notify' }).click()
      const mentionResponse = await mentionCreated
      expect(mentionResponse.status(), 'mention save should return 201').toBe(201)
      const mentionResponseBody = await mentionResponse.json().catch(() => null) as { id?: string } | null
      const mentionCommentId = expectId(mentionResponseBody?.id, 'mention comment id')

      await expect(page.getByText("Some mentioned users don't have access and weren't notified.")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(mentionBody, { exact: false }).first()).toBeVisible()

      // Reload persistence.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(mentionBody, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

      // Narrow viewport keeps the composer usable.
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByPlaceholder('Write a comment…')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Mention', exact: true })).toBeVisible()
      await page.setViewportSize({ width: 1280, height: 900 })

      // Notification outcome: exactly one eligible notification, zero for the denied recipient.
      const eligibleNotifications = await listNotificationsBySource(request, eligible.token, mentionCommentId)
      expect(countByType(eligibleNotifications, 'documents.comment.mentioned')).toBe(1)
      const deniedNotifications = await listNotificationsBySource(request, denied.token, mentionCommentId)
      expect(countByType(deniedNotifications, 'documents.comment.mentioned')).toBe(0)

      // Denied title privacy: the still-unshared recipient cannot open the document.
      const deniedDetail = await apiRequest(request, 'GET', `/api/documents/${document.id}`, { token: denied.token })
      expect(deniedDetail.status()).toBe(403)

      // Two-user stale-page integrity, part 2: the page opened before the grant must
      // reflect it after reload, not keep showing the earlier denial.
      await eligiblePage.reload({ waitUntil: 'domcontentloaded' })
      await expect(eligiblePage.getByText('Forbidden', { exact: true })).toHaveCount(0)
      await expect(eligiblePage.getByText(mentionBody, { exact: false }).first()).toBeVisible({ timeout: 30_000 })

      // Polish-locale controls for the composer.
      const plContext = await browser.newContext({ baseURL: BASE_URL })
      extraContexts.push(plContext)
      const plPage = await plContext.newPage()
      await plPage.context().addCookies([{ name: 'locale', value: 'pl', url: BASE_URL }])
      await login(plPage, 'admin')
      await plPage.goto(`/backend/documents/${document.id}`, { waitUntil: 'domcontentloaded' })
      await expect(plPage.getByPlaceholder('Napisz komentarz…')).toBeVisible({ timeout: 30_000 })
      await expect(plPage.getByRole('button', { name: 'Wzmianka', exact: true })).toBeVisible()
    } finally {
      await Promise.all(extraContexts.map((context) => context.close().catch(() => undefined)))
      await deleteDocument(request, adminToken, document?.id ?? null)
      await deleteUserIfExists(request, adminToken, eligible?.id ?? null)
      await deleteRoleIfExists(request, adminToken, eligible?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, denied?.id ?? null)
      await deleteRoleIfExists(request, adminToken, denied?.roleId ?? null)
    }
  })
})
