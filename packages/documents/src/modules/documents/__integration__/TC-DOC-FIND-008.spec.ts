import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ensureManagedCollabSidecar, type ManagedCollabSidecar } from './helpers/collabSidecar'
import { deleteDocumentIfExists, findingByTitle, listFindings, readSummary } from './helpers/findingsFixtures'
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

test.describe('TC-DOC-FIND-008: Apply writes the suggestion into the shared document', () => {
  test('Apply replaces the passage, records the decision and syncs to a second browser', async ({ browser, page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let documentId: string | null = null
    let collabSidecar: ManagedCollabSidecar | null = null
    const extraContexts: BrowserContext[] = []

    try {
      collabSidecar = await ensureManagedCollabSidecar(FINDINGS_UI_BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const seeded = await createReviewedAgreement(request, adminToken, `TC-DOC-FIND-008 ${stamp}`, [TERM_FINDING, LAW_FINDING])
      documentId = seeded.documentId

      await login(page, 'admin')
      await openDocumentChanges(page, documentId)
      const realtimeConnected = await isRealtimeConnected(page)
      let secondPage: Page | null = null
      if (realtimeConnected) {
        const secondContext = await browser.newContext({ baseURL: FINDINGS_UI_BASE_URL, storageState: await page.context().storageState() })
        extraContexts.push(secondContext)
        secondPage = await secondContext.newPage()
        await secondPage.goto(`/backend/documents/${encodeURIComponent(documentId)}`, { waitUntil: 'domcontentloaded' })
        await expect(editorLocator(secondPage)).toContainText(TERM_FINDING.quote, { timeout: 30_000 })
      } else {
        test.info().annotations.push({
          type: 'skipped-assertion',
          description: 'Realtime collaboration is unavailable (single-user fallback); second-browser sync is not asserted, persisted content is checked through the content API instead.',
        })
      }

      const termCard = findingCard(page, TERM_FINDING.title)
      await expect(termCard.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled({ timeout: 15_000 })
      const applyResponse = page.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/apply')
      ))
      await termCard.getByRole('button', { name: 'Apply', exact: true }).click()
      expect((await applyResponse).status(), 'POST apply should return 200').toBe(200)

      const editor = editorLocator(page)
      await expect(editor).toContainText(TERM_FINDING.suggestedText ?? '')
      await expect(editor).not.toContainText(TERM_FINDING.quote)
      await expect(editor.locator('.om-doc-finding--blocking')).toHaveCount(0)
      await expect(editor.locator('.om-doc-finding--warning')).toHaveCount(1)

      const panel = page.getByTestId('documents-findings-panel')
      await expect(panel.getByTestId('documents-findings-group-blocking')).toHaveCount(0)
      const decided = panel.getByTestId('documents-findings-group-decided')
      await expect(decided).toBeVisible()
      await decided.getByRole('button', { name: /Expand Decided section/ }).click()
      const appliedCard = findingCard(page, TERM_FINDING.title)
      await expect(appliedCard).toHaveAttribute('data-status', 'applied')
      await expect(appliedCard.getByText('Applied', { exact: true })).toBeVisible()
      await expect(appliedCard.getByRole('button', { name: 'Reopen' })).toBeVisible()

      if (secondPage) {
        await expect(editorLocator(secondPage)).toContainText(TERM_FINDING.suggestedText ?? '', { timeout: 15_000 })
        await expect(editorLocator(secondPage)).not.toContainText(TERM_FINDING.quote)
      }
      await expect.poll(
        () => readPersistedContentHtml(request, adminToken ?? '', documentId ?? ''),
        { timeout: 30_000, message: 'applied text should be persisted in the document content' },
      ).toContain(TERM_FINDING.suggestedText ?? '')
      expect(await readPersistedContentHtml(request, adminToken, documentId)).not.toContain(TERM_FINDING.quote)

      const list = await listFindings(request, adminToken, documentId)
      expect(findingByTitle(list, TERM_FINDING.title)).toMatchObject({ status: 'applied', appliedText: TERM_FINDING.suggestedText })
      const summary = await readSummary(request, adminToken, documentId)
      expect(summary.open).toEqual({ blocking: 0, warning: 1, info: 0 })
      expect(summary.decided.applied).toBe(1)
    } finally {
      await Promise.all(extraContexts.map((context) => context.close().catch(() => undefined)))
      await deleteDocumentIfExists(request, adminToken, documentId)
      await collabSidecar?.stop()
    }
  })
})
