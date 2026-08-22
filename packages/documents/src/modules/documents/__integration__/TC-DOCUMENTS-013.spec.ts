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
import {
  ensureManagedCollabSidecar,
  type ManagedCollabSidecar,
} from './helpers/collabSidecar'

export const integrationMeta = { dependsOnModules: ['documents'] }

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PASSWORD = 'DocsPreview1!Pass'
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

type Created = { id: string; updatedAt: string }
type TestUser = { id: string; roleId: string; email: string; token: string }

async function createUser(request: APIRequestContext, adminToken: string, stamp: number, label: string, features: string[]): Promise<TestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, { name: `TC-DOCUMENTS-013 ${label} ${stamp}`, tenantId: scope.tenantId })
  await setRoleAclFeatures(request, adminToken, { roleId, features, organizations: null })
  const email = `tc-documents-013-${label}-${stamp}@example.com`
  const id = await createUserFixture(request, adminToken, {
    email, password: PASSWORD, organizationId: scope.organizationId, roles: [roleId], name: `Documents ${label} ${stamp}`,
  })
  return { id, roleId, email, token: await getAuthToken(request, email, PASSWORD) }
}

async function createDocument(request: APIRequestContext, token: string, title: string): Promise<Created> {
  const response = await apiRequest(request, 'POST', '/api/documents', { token, data: { title, folderId: null } })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status()).toBe(201)
  return { id: expectId(body?.id, 'document id'), updatedAt: expectId(body?.updatedAt, 'document updatedAt') }
}

async function deleteDocument(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  const detail = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(id)}`, { token }).catch(() => null)
  const body = detail ? await readJsonSafe<{ updatedAt?: string }>(detail) : null
  await request.fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}`, ...(body?.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: body.updatedAt } : {}) },
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
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

async function expectNoSystemGuid(page: Page): Promise<void> {
  const [visibleText, visibleLabels, editorText] = await Promise.all([
    page.locator('body').innerText(),
    page.locator('[aria-label]:visible').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? '')),
    page.locator('.ProseMirror:visible').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText)),
  ])

  // Read the live, rendered UI. A detached body clone exposes Next.js hydration
  // scripts as text even though users and the accessibility tree cannot see them.
  expect([visibleText, ...visibleLabels, ...editorText].join('\n')).not.toMatch(UUID_PATTERN)
}

async function selectEditorText(page: Page, expected: string): Promise<void> {
  const editor = page.locator('.ProseMirror:visible').first()
  await expect(editor).toContainText(expected)
  await editor.focus()
  await editor.evaluate((root, selectionText) => {
    const nodes: Text[] = []
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('.collaboration-carets__caret')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
      }
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    const fullText = nodes.map((node) => node.data).join('')
    const start = fullText.indexOf(selectionText)
    if (start < 0) throw new Error(`Could not find editor text: ${selectionText}`)
    const locate = (absoluteOffset: number): { node: Text; offset: number } => {
      let remaining = absoluteOffset
      for (const node of nodes) {
        if (remaining <= node.data.length) return { node, offset: remaining }
        remaining -= node.data.length
      }
      throw new Error(`Editor offset ${absoluteOffset} is outside its text content`)
    }
    const from = locate(start)
    const to = locate(start + selectionText.length)
    const range = root.ownerDocument.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    const selection = root.ownerDocument.defaultView?.getSelection()
    if (!selection) throw new Error('Browser selection is unavailable')
    selection.removeAllRanges()
    selection.addRange(range)
    root.ownerDocument.dispatchEvent(new Event('selectionchange'))
  }, expected)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(expected)
}

test.describe('TC-DOCUMENTS-013: preview, capability chrome, and readable fallbacks', () => {
  test('persists preview mode, forces read-only owners, and keeps comment actions independently gated', async ({ browser, page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let writableDocument: Created | null = null
    let readOnlyDocument: Created | null = null
    let owner: TestUser | null = null
    let viewer: TestUser | null = null
    let collabSidecar: ManagedCollabSidecar | null = null
    const extraContexts: BrowserContext[] = []

    try {
      // The comment bubble menu is a selection-driven surface: without a reachable sidecar the
      // editor re-mounts into single-user mode and drops the selection that opens it.
      collabSidecar = await ensureManagedCollabSidecar(BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      owner = await createUser(request, adminToken, stamp, 'owner', ['documents.view', 'documents.create'])
      viewer = await createUser(request, adminToken, stamp, 'viewer', ['documents.view'])
      writableDocument = await createDocument(request, adminToken, `TC-DOCUMENTS-013 writable ${stamp}`)
      readOnlyDocument = await createDocument(request, owner.token, `TC-DOCUMENTS-013 owner ${stamp}`)

      const chipId = '11111111-1111-4111-8111-111111111111'
      const content = `<p>Preview body ${stamp}</p><p><span data-entity-ref data-entity-type="customer-person" data-entity-id="${chipId}" data-label="Readable record" data-href="/backend/customers/people/${chipId}">Readable record</span></p>`
      expect((await apiRequest(request, 'PUT', `/api/documents/${writableDocument.id}/content`, { token: adminToken, data: { contentHtml: content, contentText: `Preview body ${stamp} Readable record` } })).status()).toBe(200)
      const commenterAnchorText = `Comment-only anchor ${stamp}`
      expect((await apiRequest(request, 'PUT', `/api/documents/${readOnlyDocument.id}/content`, {
        token: adminToken,
        data: { contentHtml: `<p>${commenterAnchorText}</p>`, contentText: commenterAnchorText },
      })).status()).toBe(200)
      expect((await apiRequest(request, 'POST', `/api/documents/${writableDocument.id}/versions`, { token: adminToken, data: { label: `Readable snapshot ${stamp}` } })).status()).toBe(201)

      const shareResponse = await apiRequest(request, 'POST', `/api/documents/${writableDocument.id}/shares`, {
        token: adminToken, data: { principalType: 'user', principalId: viewer.id, permission: 'commenter' },
      })
      const shareBody = await readJsonSafe<{ id?: string; updatedAt?: string }>(shareResponse)
      expectId(shareBody?.id, 'share id')
      expectId(shareBody?.updatedAt, 'share updatedAt')
      expect((await apiRequest(request, 'POST', `/api/documents/${writableDocument.id}/comments`, {
        token: viewer.token, data: { body: `Viewer-authored comment ${stamp}`, anchor: null, parentCommentId: null, mentions: [] },
      })).status()).toBe(201)
      const downgrade = await apiRequest(request, 'POST', `/api/documents/${writableDocument.id}/shares`, {
        token: adminToken, data: { principalType: 'user', principalId: viewer.id, permission: 'viewer' },
      })
      expect([200, 201]).toContain(downgrade.status())

      await login(page, 'admin')
      await page.goto(`/backend/documents/${writableDocument.id}`, { waitUntil: 'domcontentloaded' })
      const editMode = page.getByRole('radio', { name: /^Edit$/ })
      const previewMode = page.getByRole('radio', { name: /^Preview$/ })
      await expect(editMode).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
      await previewMode.click()
      await expect(page).toHaveURL(/mode=preview/)
      await expect(page.getByRole('button', { name: 'Bold' })).toHaveCount(0)
      await selectEditorText(page, `Preview body ${stamp}`)
      await expect(page.locator('div.z-popover')).toHaveCount(0)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(previewMode).toBeChecked({ timeout: 30_000 })
      await expect(page.getByRole('link', { name: 'Readable record' })).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByText(`Preview body ${stamp}`)).toBeVisible()
      await expectNoSystemGuid(page)

      const ownerContext = await browser.newContext({ baseURL: BASE_URL })
      extraContexts.push(ownerContext)
      const ownerPage = await ownerContext.newPage()
      await loginAs(ownerPage, owner)
      await ownerPage.goto(`/backend/documents/${readOnlyDocument.id}`, { waitUntil: 'domcontentloaded' })
      await expect(ownerPage.getByText('You can view this document, but your access tier cannot edit it.')).toBeVisible({ timeout: 30_000 })
      await expect(ownerPage.getByRole('radio', { name: /^Edit$/ })).toHaveCount(0)
      await expect(ownerPage.getByRole('button', { name: 'Bold' })).toHaveCount(0)
      await expect(ownerPage.getByRole('button', { name: /^Share$/ })).toHaveCount(0)
      await expect(ownerPage.getByRole('button', { name: /^Delete$/ })).toHaveCount(0)
      await expect(ownerPage.getByPlaceholder('Write a comment…')).toBeVisible()
      await selectEditorText(ownerPage, commenterAnchorText)
      const commentOnlyMenu = ownerPage.locator('div.z-popover').filter({
        has: ownerPage.getByRole('button', { name: 'Comment', exact: true }),
      })
      await expect(commentOnlyMenu).toBeVisible()
      await expect(commentOnlyMenu.getByRole('button', { name: 'Bold' })).toHaveCount(0)
      await commentOnlyMenu.getByRole('button', { name: 'Comment', exact: true }).click()
      const anchoredBody = `Commenter anchored note ${stamp}`
      const composer = ownerPage.getByPlaceholder('Write a comment…').locator('xpath=ancestor::form')
      const createdComment = ownerPage.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/comments')
      ))
      await composer.getByPlaceholder('Write a comment…').fill(anchoredBody)
      await composer.getByRole('button', { name: 'Comment', exact: true }).click()
      expect((await createdComment).status()).toBe(201)
      await expect(ownerPage.getByText(anchoredBody, { exact: true })).toBeVisible()
      await ownerPage.goto('/backend/documents', { waitUntil: 'domcontentloaded' })
      const documentsMain = ownerPage.getByRole('main')
      await expect(documentsMain.getByRole('button', { name: 'Create document' })).toBeVisible({ timeout: 30_000 })
      await expect(documentsMain.getByRole('button', { name: 'New folder' })).toHaveCount(0)
      await expect(documentsMain.getByRole('link', { name: 'Templates' })).toHaveCount(0)
      await expect(documentsMain.getByRole('button', { name: 'New from template' })).toHaveCount(0)

      const viewerContext = await browser.newContext({ baseURL: BASE_URL })
      extraContexts.push(viewerContext)
      const viewerPage = await viewerContext.newPage()
      await loginAs(viewerPage, viewer)
      await viewerPage.goto(`/backend/documents/${writableDocument.id}`, { waitUntil: 'domcontentloaded' })
      await expect(viewerPage.getByText(`Viewer-authored comment ${stamp}`)).toBeVisible({ timeout: 30_000 })
      await expect(viewerPage.getByRole('button', { name: /^Resolve$/ })).toBeVisible()
      await expect(viewerPage.getByPlaceholder('Write a comment…')).toHaveCount(0)
      await viewerPage.getByRole('button', { name: 'Versions' }).click()
      await expect(viewerPage.getByRole('button', { name: /^Preview$/ }).last()).toBeVisible()
      await expect(viewerPage.getByRole('button', { name: /^Restore$/ })).toHaveCount(0)
      await expectNoSystemGuid(viewerPage)

      const deniedWrite = await apiRequest(request, 'PUT', `/api/documents/${readOnlyDocument.id}/content`, {
        token: owner.token, data: { contentHtml: '<p>Denied</p>', contentText: 'Denied' },
      })
      expect(deniedWrite.status()).toBe(403)
    } finally {
      await Promise.all(extraContexts.map((context) => context.close().catch(() => undefined)))
      await deleteDocument(request, adminToken, writableDocument?.id ?? null)
      await deleteDocument(request, adminToken, readOnlyDocument?.id ?? null)
      await deleteUserIfExists(request, adminToken, viewer?.id ?? null)
      await deleteRoleIfExists(request, adminToken, viewer?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteRoleIfExists(request, adminToken, owner?.roleId ?? null)
      await collabSidecar?.stop()
    }
  })
})
