import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ensureManagedCollabSidecar, type ManagedCollabSidecar } from './helpers/collabSidecar'
import {
  AGREEMENT_HTML,
  deleteDocumentIfExists,
  findingByTitle,
  listFindings,
  readSummary,
} from './helpers/findingsFixtures'
import {
  createReviewedAgreement,
  editorLocator,
  FINDINGS_UI_BASE_URL,
  findingCard,
  isRealtimeConnected,
  LAW_FINDING,
  openDocumentChanges,
  readPersistedContentHtml,
  TERM_FINDING,
} from './helpers/findingsUi'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

const WITHOUT_GOVERNING_LAW_HTML = AGREEMENT_HTML.replace(
  '<h2>3. Governing Law</h2><p>This Agreement is governed by the laws of the disclosing party.</p>',
  '',
)

async function putContent(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  documentId: string,
  contentHtml: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/documents/${encodeURIComponent(documentId)}/content`, {
    token,
    data: { contentHtml },
  })
  expect(response.status(), 'PUT document content should return 200').toBe(200)
}

async function expectDecoratedFindings(page: Page): Promise<void> {
  const editor = editorLocator(page)
  await expect(editor.locator('.om-doc-finding')).toHaveCount(2, { timeout: 15_000 })
  await expect(editor.locator('.om-doc-finding--blocking')).toHaveText(TERM_FINDING.quote)
  await expect(editor.locator('.om-doc-finding--warning')).toHaveText(LAW_FINDING.quote)
  const termCard = findingCard(page, TERM_FINDING.title)
  await expect(termCard.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(termCard.getByTestId('documents-finding-location-message')).toHaveCount(0)
  const outline = page.getByRole('navigation', { name: 'Outline' })
  await expect(outline.getByRole('button', { name: /2\. Obligations/ }).locator('[data-severity="blocking"]')).toHaveCount(1)
  await expect(outline.getByRole('button', { name: /3\. Governing Law/ }).locator('[data-severity="warning"]')).toHaveCount(1)
}

test.describe('TC-DOC-FIND-011: Findings stay anchored when the document body is rebuilt', () => {
  test('a REST content replacement re-anchors open findings, the editor still decorates them, and opening does not re-save', async ({ browser, page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let documentId: string | null = null
    let collabSidecar: ManagedCollabSidecar | null = null
    const extraContexts: BrowserContext[] = []

    try {
      collabSidecar = await ensureManagedCollabSidecar(FINDINGS_UI_BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const seeded = await createReviewedAgreement(request, adminToken, `TC-DOC-FIND-011 ${stamp}`, [TERM_FINDING, LAW_FINDING])
      documentId = seeded.documentId
      const beforeTerm = findingByTitle(seeded.list, TERM_FINDING.title)
      expect(beforeTerm.anchorStatus).toBe('located')

      await putContent(request, adminToken, documentId, await readPersistedContentHtml(request, adminToken, documentId))

      const rebuilt = await listFindings(request, adminToken, documentId)
      for (const title of [TERM_FINDING.title, LAW_FINDING.title]) {
        const before = findingByTitle(seeded.list, title)
        const after = findingByTitle(rebuilt, title)
        expect(after.anchorStatus).toBe('located')
        expect(after.anchor).not.toBeNull()
        expect(after.anchor).not.toEqual(before.anchor)
        expect(after.updatedAt, 'Re-anchoring must not move the finding optimistic-lock token').toBe(before.updatedAt)
      }

      await login(page, 'admin')
      await openDocumentChanges(page, documentId)
      const realtimeConnected = await isRealtimeConnected(page)
      test.info().annotations.push({
        type: 'editor-mode',
        description: realtimeConnected ? 'realtime (relative anchors)' : 'single-user fallback (quote search)',
      })
      await expectDecoratedFindings(page)

      const fallbackContext = await browser.newContext({ baseURL: FINDINGS_UI_BASE_URL })
      extraContexts.push(fallbackContext)
      const fallbackPage = await fallbackContext.newPage()
      await fallbackPage.routeWebSocket(
        (url) => !url.pathname.startsWith('/_next'),
        (socket) => { void socket.close() },
      )
      const contentWrites: string[] = []
      fallbackPage.on('request', (pending) => {
        if (pending.method() === 'PUT' && new URL(pending.url()).pathname.endsWith('/content')) contentWrites.push(pending.url())
      })
      await login(fallbackPage, 'admin')
      await openDocumentChanges(fallbackPage, documentId)
      expect(await isRealtimeConnected(fallbackPage)).toBe(false)
      await expectDecoratedFindings(fallbackPage)
      await fallbackPage.waitForTimeout(3_000)
      expect(contentWrites, 'Opening a document in single-user mode must not save unchanged content').toEqual([])

      await putContent(request, adminToken, documentId, WITHOUT_GOVERNING_LAW_HTML)
      const trimmed = await listFindings(request, adminToken, documentId)
      expect(findingByTitle(trimmed, TERM_FINDING.title).anchorStatus).toBe('located')
      expect(findingByTitle(trimmed, LAW_FINDING.title)).toMatchObject({ anchorStatus: 'unlocated', anchor: null, status: 'open' })
      expect((await readSummary(request, adminToken, documentId)).unlocated).toBe(1)
    } finally {
      await Promise.all(extraContexts.map((context) => context.close().catch(() => undefined)))
      await deleteDocumentIfExists(request, adminToken, documentId)
      await collabSidecar?.stop()
    }
  })
})
