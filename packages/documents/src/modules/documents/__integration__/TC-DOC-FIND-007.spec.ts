import { expect, test, type BrowserContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ensureManagedCollabSidecar, type ManagedCollabSidecar } from './helpers/collabSidecar'
import {
  createDocumentsUser,
  deleteDocumentIfExists,
  deleteDocumentsUser,
  shareDocument,
  type FindingsTestUser,
} from './helpers/findingsFixtures'
import {
  createReviewedAgreement,
  editorLocator,
  FINDINGS_UI_BASE_URL,
  findingCard,
  LAW_FINDING,
  loginWithToken,
  MISSING_FINDING,
  openDocumentChanges,
  TERM_FINDING,
} from './helpers/findingsUi'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-FIND-007: Changes tab groups findings, decorates passages and marks the outline', () => {
  test('editors see grouped cards, severity decorations and outline dots; commenters see no Changes tab', async ({ browser, page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let documentId: string | null = null
    let commenter: FindingsTestUser | null = null
    let collabSidecar: ManagedCollabSidecar | null = null
    const extraContexts: BrowserContext[] = []

    try {
      collabSidecar = await ensureManagedCollabSidecar(FINDINGS_UI_BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const seeded = await createReviewedAgreement(request, adminToken, `TC-DOC-FIND-007 ${stamp}`)
      documentId = seeded.documentId

      await login(page, 'admin')
      const panel = await openDocumentChanges(page, documentId)
      await expect(panel.getByTestId('documents-findings-review-header')).toBeVisible()
      await expect(panel.getByTestId('documents-findings-group-blocking')).toContainText(TERM_FINDING.title)
      await expect(panel.getByTestId('documents-findings-group-warning')).toContainText(LAW_FINDING.title)
      await expect(panel.getByTestId('documents-findings-group-info')).toContainText(MISSING_FINDING.title)
      await expect(panel.getByTestId('documents-findings-group-decided')).toHaveCount(0)

      const termCard = findingCard(page, TERM_FINDING.title)
      await expect(termCard.getByText('Blocking', { exact: true })).toBeVisible()
      await expect(termCard.getByText(`${TERM_FINDING.sectionLabel} · ${TERM_FINDING.ruleCode}`)).toBeVisible()
      await expect(termCard.getByTestId('documents-finding-diff')).toContainText(TERM_FINDING.quote)
      await expect(termCard.getByTestId('documents-finding-diff')).toContainText(TERM_FINDING.suggestedText ?? '')
      await expect(termCard.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()

      const missingCard = findingCard(page, MISSING_FINDING.title)
      await expect(missingCard.getByTestId('documents-finding-location-message')).toHaveText('Passage not found in the current text.')
      await expect(missingCard.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
      await expect(missingCard.getByRole('button', { name: 'Keep as is' })).toBeEnabled()

      const editor = editorLocator(page)
      await expect(editor.locator('.om-doc-finding')).toHaveCount(2, { timeout: 15_000 })
      await expect(editor.locator('.om-doc-finding--blocking')).toHaveText(TERM_FINDING.quote)
      await expect(editor.locator('.om-doc-finding--warning')).toHaveText(LAW_FINDING.quote)

      await editor.locator('.om-doc-finding--warning').click()
      await expect(findingCard(page, LAW_FINDING.title)).toBeFocused()
      await expect(editor.locator('.om-doc-finding--warning')).toHaveClass(/om-doc-finding--active/)

      await page.getByRole('button', { name: 'Outline', exact: true }).click()
      const outline = page.getByRole('navigation', { name: 'Outline' })
      const obligations = outline.getByRole('button', { name: /2\. Obligations/ })
      await expect(obligations.locator('[data-severity="blocking"]')).toHaveCount(1)
      await expect(obligations).toContainText('Open findings: 1 blocking, 0 warnings, 0 information')
      const governingLaw = outline.getByRole('button', { name: /3\. Governing Law/ })
      await expect(governingLaw.locator('[data-severity="warning"]')).toHaveCount(1)
      await expect(outline.getByRole('button', { name: /1\. Definitions/ }).getByTestId('documents-outline-finding-dots')).toHaveCount(0)

      commenter = await createDocumentsUser(request, adminToken, { label: `commenter-ui-${stamp}`, features: ['documents.view', 'documents.edit'] })
      await shareDocument(request, adminToken, documentId, commenter.id, 'commenter')
      const commenterContext = await browser.newContext({ baseURL: FINDINGS_UI_BASE_URL })
      extraContexts.push(commenterContext)
      const commenterPage = await commenterContext.newPage()
      await loginWithToken(commenterPage, commenter.token)
      await commenterPage.goto(`/backend/documents/${encodeURIComponent(documentId)}`, { waitUntil: 'domcontentloaded' })
      await expect(editorLocator(commenterPage)).toContainText('Mutual Non-Disclosure Agreement', { timeout: 30_000 })
      await expect(commenterPage.getByPlaceholder('Write a comment…')).toBeVisible()
      await expect(commenterPage.getByRole('tab', { name: /Changes/ })).toHaveCount(0)
      await expect(commenterPage.getByTestId('documents-findings-panel')).toHaveCount(0)
      await expect(editorLocator(commenterPage).locator('.om-doc-finding')).toHaveCount(0)
    } finally {
      await Promise.all(extraContexts.map((context) => context.close().catch(() => undefined)))
      await deleteDocumentIfExists(request, adminToken, documentId)
      await deleteDocumentsUser(request, adminToken, commenter)
      await collabSidecar?.stop()
    }
  })
})
