import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  test,
} from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  startManagedCollabSidecar,
  type ManagedCollabSidecar,
} from './helpers/collabSidecar'

export const integrationMeta = {
  dependsOnModules: ['documents', 'customers'],
}

type CreatedDocument = { id: string; updatedAt: string }
type TestUser = { id: string; roleId: string; email: string; name: string; token: string }
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PASSWORD = 'DocsRecovery1!Pass'
const COLLAB_INTEGRATION_ENABLED = process.env.OM_DOCUMENTS_COLLAB_INTEGRATION === '1'

// The sidecar starter used to be duplicated here, byte-for-byte apart from taking
// its base URL from the module constant. The copy kept the monorepo-only entry path
// that the shared helper has since dropped, so it would have loaded a second copy of
// @open-mercato/shared if this spec ever ran against a scaffolded app. Use the shared
// helper instead of maintaining two.
async function createCollaborator(
  request: APIRequestContext,
  adminToken: string,
  stamp: number,
): Promise<TestUser> {
  const scope = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-017 collaborator ${stamp}`,
    tenantId: scope.tenantId,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: ['documents.view', 'documents.edit'],
    organizations: null,
  })
  const email = `tc-documents-017-${stamp}@example.com`
  const name = `Documents collaborator ${stamp}`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId: scope.organizationId,
    roles: [roleId],
    name,
  })
  return { id, roleId, email, name, token: await getAuthToken(request, email, PASSWORD) }
}

async function authenticateContext(context: BrowserContext, user: TestUser): Promise<void> {
  const scope = getTokenContext(user.token)
  await context.addCookies([
    { name: 'auth_token', value: user.token, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL, sameSite: 'Lax' },
  ])
}

async function installRealtimeStatusRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as {
      __documentsRealtimeStatuses?: string[]
      __documentsRealtimeObserver?: MutationObserver
    }
    state.__documentsRealtimeObserver?.disconnect()
    state.__documentsRealtimeStatuses = []
    const capture = () => {
      const status = Array.from(document.querySelectorAll('span'))
        .map((element) => element.textContent?.trim() ?? '')
        .find((text) => ['Live', 'Reconnecting…', 'Realtime unavailable'].includes(text))
      if (status && state.__documentsRealtimeStatuses?.at(-1) !== status) {
        state.__documentsRealtimeStatuses?.push(status)
      }
    }
    capture()
    state.__documentsRealtimeObserver = new MutationObserver(capture)
    state.__documentsRealtimeObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    })
  })
}

async function readRealtimeStatuses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window as unknown as {
      __documentsRealtimeStatuses?: string[]
      __documentsRealtimeObserver?: MutationObserver
    }
    state.__documentsRealtimeObserver?.disconnect()
    return [...(state.__documentsRealtimeStatuses ?? [])]
  })
}

async function appendEditorText(page: Page, value: string): Promise<void> {
  const editor = page.locator('.ProseMirror:visible').first()
  await editor.focus()
  await editor.evaluate((root) => {
    const range = root.ownerDocument.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    const selection = root.ownerDocument.defaultView?.getSelection()
    if (!selection) throw new Error('Browser selection is unavailable')
    selection.removeAllRanges()
    selection.addRange(range)
    root.ownerDocument.dispatchEvent(new Event('selectionchange'))
  })
  await page.keyboard.type(value)
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<CreatedDocument> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status()).toBe(201)
  return {
    id: expectId(body?.id, 'document id'),
    updatedAt: expectId(body?.updatedAt, 'document updatedAt'),
  }
}

async function deleteDocument(
  request: APIRequestContext,
  token: string | null,
  document: CreatedDocument | null,
): Promise<void> {
  if (!token || !document) return
  const detail = await apiRequest(request, 'GET', `/api/documents/${document.id}`, { token }).catch(() => null)
  const body = detail ? await readJsonSafe<{ updatedAt?: string }>(detail) : null
  await request.fetch(`/api/documents/${document.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: body?.updatedAt ?? document.updatedAt,
    },
  }).catch(() => undefined)
}

async function forceSingleUserFallback(page: Page, documentId: string): Promise<void> {
  const collabTokenPath = `/api/documents/${documentId}/collab-token`
  await page.route(`**${collabTokenPath}`, async (route) => {
    const response = await route.fetch()
    const payload = await response.json() as Record<string, unknown>
    await route.fulfill({
      response,
      json: { ...payload, token: '', url: null },
    })
  })
}

test.describe('TC-DOCUMENTS-017: realtime rollover, pages, PDF, and record snapshots', () => {
  test('persists single-user fallback edits and surfaces stale-content conflicts', async ({ page, request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let document: CreatedDocument | null = null

    try {
      token = await getAuthToken(request, 'admin')
      document = await createDocument(request, token, `TC-DOCUMENTS-017 fallback ${stamp}`)
      await login(page, 'admin')
      await forceSingleUserFallback(page, document.id)
      await page.goto(`/backend/documents/${document.id}`, { waitUntil: 'domcontentloaded' })

      await expect(page.getByText('Realtime unavailable', { exact: true })).toBeVisible()
      await expect(page.getByText('Realtime is unavailable — changes are saved in single-user mode.')).toBeVisible()
      const editor = page.locator('.ProseMirror:visible').first()
      await expect(editor).toBeVisible()

      const persistedMarker = ` fallback-saved-${stamp}`
      const initialSave = page.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/documents/${document!.id}/content`
      ))
      await appendEditorText(page, persistedMarker)
      await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      expect((await initialSave).status()).toBe(200)
      await expect(page.getByText('Saved', { exact: true })).toBeVisible()

      const persistedResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${document.id}/content`,
        { token },
      )
      const persisted = await readJsonSafe<{
        contentHtml?: string
        contentText?: string
        updatedAt?: string
      }>(persistedResponse)
      expect(persistedResponse.status()).toBe(200)
      expect(persisted?.contentText).toContain(persistedMarker.trim())

      const externalMarker = `external-${stamp}`
      const externalUpdate = await request.fetch(`/api/documents/${document.id}/content`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: expectId(persisted?.updatedAt, 'content updatedAt'),
        },
        data: {
          contentHtml: `<p>${externalMarker}</p>`,
          contentText: externalMarker,
        },
      })
      expect(externalUpdate.status()).toBe(200)

      const rejectedMarker = ` fallback-conflict-${stamp}`
      const rejectedSave = page.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/documents/${document!.id}/content`
      ))
      await appendEditorText(page, rejectedMarker)
      await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      expect((await rejectedSave).status()).toBe(409)
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible()

      const afterConflictResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${document.id}/content`,
        { token },
      )
      const afterConflict = await readJsonSafe<{ contentText?: string }>(afterConflictResponse)
      expect(afterConflict?.contentText).toBe(externalMarker)
      expect(afterConflict?.contentText).not.toContain(rejectedMarker.trim())
    } finally {
      await deleteDocument(request, token, document)
    }
  })

  test('keeps realtime live and inserts authorized record fields into a paginated export', async ({ browser, page, request }) => {
    test.skip(
      !COLLAB_INTEGRATION_ENABLED,
      'Realtime Documents coverage runs in CI with OM_DOCUMENTS_COLLAB_INTEGRATION=1 and a managed sidecar.',
    )
    test.slow()
    test.setTimeout(120_000)
    const stamp = Date.now()
    const companyName = `Documents field source ${stamp}`
    let token: string | null = null
    let document: CreatedDocument | null = null
    let companyId: string | null = null
    let secondContext: BrowserContext | null = null
    let collaborator: TestUser | null = null
    let collaboratorShare: { id: string; updatedAt: string } | null = null
    let collabSidecar: ManagedCollabSidecar | null = null

    try {
      collabSidecar = await startManagedCollabSidecar(BASE_URL)
      token = await getAuthToken(request, 'admin')
      document = await createDocument(request, token, `TC-DOCUMENTS-017 ${stamp}`)
      companyId = await createCompanyFixture(request, token, companyName)
      collaborator = await createCollaborator(request, token, stamp)
      const shareResponse = await apiRequest(request, 'POST', `/api/documents/${document.id}/shares`, {
        token,
        data: {
          principalType: 'user',
          principalId: collaborator.id,
          permission: 'editor',
        },
      })
      const shareBody = await readJsonSafe<{ id?: string; updatedAt?: string }>(shareResponse)
      expect([200, 201]).toContain(shareResponse.status())
      collaboratorShare = {
        id: expectId(shareBody?.id, 'collaborator share id'),
        updatedAt: expectId(shareBody?.updatedAt, 'collaborator share updatedAt'),
      }

      const paragraphs = Array.from(
        { length: 30 },
        (_, index) => `<p>Paginated line ${index + 1} for ${stamp}</p>`,
      ).join('')
      const tableRows = Array.from(
        { length: 90 },
        (_, index) => `<tr><td>Line ${index + 1}</td><td>${index + 1}00</td></tr>`,
      ).join('')
      const contentHtml = [
        `<h1>Styled PDF ${stamp}</h1>`,
        `<table style="width:640px"><tbody><tr><th>Item</th><th>Value</th></tr>${tableRows}</tbody></table>`,
        paragraphs,
      ].join('')
      const contentResponse = await apiRequest(
        request,
        'PUT',
        `/api/documents/${document.id}/content`,
        { token, data: { contentHtml, contentText: `Styled PDF ${stamp} ${paragraphs}` } },
      )
      expect(contentResponse.status()).toBe(200)

      await login(page, 'admin')
      const initialTokenResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/documents/${document!.id}/collab-token`
      ))
      await page.goto(`/backend/documents/${document.id}`, { waitUntil: 'domcontentloaded' })
      expect((await initialTokenResponse).status()).toBe(200)
      const renewedTokenResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/documents/${document!.id}/collab-token`
      ), { timeout: 70_000 })

      const editor = page.locator('.ProseMirror:visible').first()
      await expect(editor).toContainText(`Styled PDF ${stamp}`, { timeout: 30_000 })
      await expect(page.getByText('Live', { exact: true })).toBeVisible()
      await installRealtimeStatusRecorder(page)

      secondContext = await browser.newContext({ baseURL: BASE_URL })
      await authenticateContext(secondContext, collaborator)
      const secondPage = await secondContext.newPage()
      const secondInitialTokenResponse = secondPage.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/documents/${document!.id}/collab-token`
      ))
      await secondPage.goto(`/backend/documents/${document.id}`, { waitUntil: 'domcontentloaded' })
      expect((await secondInitialTokenResponse).status()).toBe(200)
      const secondRenewedTokenResponse = secondPage.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/documents/${document!.id}/collab-token`
      ), { timeout: 70_000 })
      const secondEditor = secondPage.locator('.ProseMirror:visible').first()
      await expect(secondEditor).toContainText(`Styled PDF ${stamp}`, { timeout: 30_000 })
      await expect(secondPage.getByText('Live', { exact: true })).toBeVisible()
      await installRealtimeStatusRecorder(secondPage)

      await expect.poll(() => page.locator('.om-doc-page-break').count()).toBeGreaterThan(0)
      const paperBox = await page.locator('.om-doc-paper').boundingBox()
      expect(paperBox?.width).toBeGreaterThan(790)
      expect(paperBox?.width).toBeLessThan(800)
      expect(paperBox?.height).toBeGreaterThan(1120)

      await page.getByRole('button', { name: 'Insert record' }).click()
      const picker = page.getByRole('dialog', { name: 'Insert record' })
      await picker.getByRole('radio', { name: 'Company' }).click()
      await picker.getByRole('combobox', { name: 'Search' }).fill(companyName)
      await picker.getByRole('option', { name: companyName }).click()
      const dialog = page.getByRole('dialog', { name: 'Insert data' })
      await expect(dialog).toContainText(companyName)
      await dialog.getByRole('checkbox', { name: 'Name' }).check()
      await dialog.getByRole('button', { name: 'Insert selected' }).click()
      await expect(editor).toContainText(companyName)
      await expect.poll(async () => {
        const response = await apiRequest(request, 'GET', `/api/documents/${document!.id}/content`, { token: token! })
        const body = await readJsonSafe<{ contentHtml?: string }>(response)
        return body?.contentHtml ?? ''
      }, { timeout: 15_000 }).toContain(companyName)

      const visibleText = await page.locator('body').innerText()
      expect(visibleText).not.toContain(companyId)

      const fromSecond = ` second-${stamp}`
      await appendEditorText(secondPage, fromSecond)
      await expect(editor).toContainText(fromSecond)
      const remoteCaret = page.locator('.collaboration-carets__caret').first()
      await expect(remoteCaret).toBeVisible()
      await expect(remoteCaret).toHaveAttribute('aria-label', collaborator.name)
      await remoteCaret.hover()
      const remoteCaretLabel = remoteCaret.locator('.collaboration-carets__label')
      await expect(remoteCaretLabel).toHaveText(collaborator.name)
      await expect(remoteCaretLabel).toHaveCSS('opacity', '1')

      const fromFirst = ` first-${stamp}`
      await appendEditorText(page, fromFirst)
      await expect(secondEditor).toContainText(fromFirst)

      const collabTokenPath = `/api/documents/${document.id}/collab-token`
      await secondPage.route(`**${collabTokenPath}`, (route) => route.abort())
      const ownerUserId = getTokenScope(token).userId
      const reconnectTrigger = await apiRequest(request, 'POST', `/api/documents/${document.id}/shares`, {
        token,
        data: {
          principalType: 'user',
          principalId: ownerUserId,
          permission: 'editor',
        },
      })
      expect([200, 201]).toContain(reconnectTrigger.status())
      await expect(secondPage.getByText('Reconnecting…', { exact: true })).toBeVisible()
      const queuedWhileOffline = ` queued-${stamp}`
      await appendEditorText(secondPage, queuedWhileOffline)
      await secondPage.unroute(`**${collabTokenPath}`)
      await expect(secondPage.getByText('Live', { exact: true })).toBeVisible()
      await expect(editor).toContainText(queuedWhileOffline)

      await secondPage.route(`**${collabTokenPath}`, (route) => route.abort())
      const firstDowngradeRenewal = page.waitForResponse((response) => (
        new URL(response.url()).pathname === collabTokenPath
      ))
      const downgradeResponse = await request.fetch(`/api/documents/${document.id}/shares`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: collaboratorShare.updatedAt,
        },
        data: { id: collaboratorShare.id, permission: 'viewer' },
      })
      expect(downgradeResponse.status()).toBe(200)
      await expect(secondPage.getByText('Reconnecting…', { exact: true })).toBeVisible()
      const forbiddenQueuedEdit = ` denied-${stamp}`
      await appendEditorText(secondPage, forbiddenQueuedEdit)
      await secondPage.unroute(`**${collabTokenPath}`)
      await expect(secondPage.getByText('You can view this document, but your access tier cannot edit it.')).toBeVisible()
      await expect(secondPage.getByRole('button', { name: 'Bold' })).toHaveCount(0)
      await expect(editor).not.toContainText(forbiddenQueuedEdit)
      expect((await firstDowngradeRenewal).status()).toBe(200)

      const pdfResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${document.id}/export?format=pdf`,
        { token },
      )
      expect(pdfResponse.status()).toBe(200)
      const pdf = await pdfResponse.body()
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(pdf.length).toBeGreaterThan(1_000)
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdfDocument = await getDocument({ data: new Uint8Array(pdf) }).promise
      expect(pdfDocument.numPages).toBeGreaterThan(1)
      const pdfPageText: string[] = []
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const pdfPage = await pdfDocument.getPage(pageNumber)
        const text = await pdfPage.getTextContent()
        pdfPageText.push(text.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      }
      expect(pdfPageText.filter((text) => text.includes('Item')).length).toBeGreaterThan(1)
      expect(pdfPageText.join('\n')).toContain(companyName)

      expect((await renewedTokenResponse).status()).toBe(200)
      expect((await secondRenewedTokenResponse).status()).toBe(200)
      expect(await readRealtimeStatuses(page)).not.toContain('Realtime unavailable')
      expect(await readRealtimeStatuses(secondPage)).not.toContain('Realtime unavailable')

      await installRealtimeStatusRecorder(page)
      const periodicRenewal = page.waitForResponse((response) => (
        new URL(response.url()).pathname === collabTokenPath
      ), { timeout: 70_000 })
      expect((await periodicRenewal).status()).toBe(200)
      expect(await readRealtimeStatuses(page)).toEqual(['Live'])
    } finally {
      await secondContext?.close().catch(() => undefined)
      await collabSidecar?.stop().catch(() => undefined)
      await deleteDocument(request, token, document)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      await deleteUserIfExists(request, token, collaborator?.id ?? null)
      await deleteRoleIfExists(request, token, collaborator?.roleId ?? null)
    }
  })
})
