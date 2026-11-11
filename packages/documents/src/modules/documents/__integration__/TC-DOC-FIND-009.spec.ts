import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ensureManagedCollabSidecar, type ManagedCollabSidecar } from './helpers/collabSidecar'
import { deleteDocumentIfExists, findingByTitle, listFindings } from './helpers/findingsFixtures'
import {
  createReviewedAgreement,
  editorLocator,
  FINDINGS_UI_BASE_URL,
  findingCard,
  openDocumentChanges,
  selectEditorText,
  TERM_FINDING,
} from './helpers/findingsUi'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-FIND-009: Apply is disabled when the passage changed', () => {
  test('editing the quoted passage shows "Text changed" and disables Apply while Keep stays available', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let documentId: string | null = null
    let collabSidecar: ManagedCollabSidecar | null = null

    try {
      collabSidecar = await ensureManagedCollabSidecar(FINDINGS_UI_BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const seeded = await createReviewedAgreement(request, adminToken, `TC-DOC-FIND-009 ${stamp}`, [TERM_FINDING])
      documentId = seeded.documentId

      await login(page, 'admin')
      await openDocumentChanges(page, documentId)
      const termCard = findingCard(page, TERM_FINDING.title)
      await expect(termCard.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled({ timeout: 15_000 })
      await expect(termCard.getByTestId('documents-finding-location-message')).toHaveCount(0)

      await selectEditorText(page, 'five')
      await page.keyboard.type('six')
      await expect(editorLocator(page)).toContainText('secret for six years')

      await expect(termCard.getByTestId('documents-finding-location-message')).toHaveText('Text changed since the review.', { timeout: 15_000 })
      await expect(termCard.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
      await expect(termCard.getByRole('button', { name: 'Keep as is' })).toBeEnabled()
      await expect(termCard.getByRole('button', { name: 'Show in document' })).toBeVisible()

      const list = await listFindings(request, adminToken, documentId)
      expect(findingByTitle(list, TERM_FINDING.title).status).toBe('open')
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
      await collabSidecar?.stop()
    }
  })
})
