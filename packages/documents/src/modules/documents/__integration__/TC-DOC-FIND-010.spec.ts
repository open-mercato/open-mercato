import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ensureManagedCollabSidecar, type ManagedCollabSidecar } from './helpers/collabSidecar'
import { deleteDocumentIfExists, findingByTitle, listFindings } from './helpers/findingsFixtures'
import {
  createReviewedAgreement,
  FINDINGS_UI_BASE_URL,
  findingCard,
  LAW_FINDING,
  openDocumentChanges,
  TERM_FINDING,
} from './helpers/findingsUi'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-FIND-010: Keep dialog keyboard contract', () => {
  test('Escape cancels, a blocking finding needs a note, and Cmd/Ctrl+Enter submits', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let documentId: string | null = null
    let collabSidecar: ManagedCollabSidecar | null = null

    try {
      collabSidecar = await ensureManagedCollabSidecar(FINDINGS_UI_BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const seeded = await createReviewedAgreement(request, adminToken, `TC-DOC-FIND-010 ${stamp}`, [TERM_FINDING, LAW_FINDING])
      documentId = seeded.documentId

      await login(page, 'admin')
      await openDocumentChanges(page, documentId)
      const termCard = findingCard(page, TERM_FINDING.title)
      const dialog = page.getByTestId('documents-finding-keep-dialog')
      const note = page.getByLabel('Note (required)')

      await termCard.getByRole('button', { name: 'Keep as is' }).click()
      await expect(dialog).toBeVisible()
      await note.fill('Draft reason')
      await note.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(findingByTitle(await listFindings(request, adminToken, documentId), TERM_FINDING.title).status).toBe('open')

      await termCard.getByRole('button', { name: 'Keep as is' }).click()
      await expect(dialog).toBeVisible()
      await expect(note).toHaveValue('')
      await note.press('ControlOrMeta+Enter')
      await expect(dialog.getByRole('alert')).toHaveText('Enter a note to keep the text for a blocking finding.')
      await expect(dialog).toBeVisible()
      expect(findingByTitle(await listFindings(request, adminToken, documentId), TERM_FINDING.title).status).toBe('open')

      const reason = `Accepted by counsel ${stamp}`
      await note.fill(reason)
      const keepResponse = page.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/keep')
      ))
      await note.press('ControlOrMeta+Enter')
      expect((await keepResponse).status(), 'POST keep should return 200').toBe(200)
      await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('documents-findings-group-blocking')).toHaveCount(0)
      expect(findingByTitle(await listFindings(request, adminToken, documentId), TERM_FINDING.title))
        .toMatchObject({ status: 'kept', decisionNote: reason })

      await findingCard(page, LAW_FINDING.title).getByRole('button', { name: 'Keep as is' }).click()
      await expect(dialog).toBeVisible()
      await expect(page.getByLabel('Note (optional)')).toBeVisible()
      await page.getByLabel('Note (optional)').press('ControlOrMeta+Enter')
      await expect(dialog).toHaveCount(0)
      expect(findingByTitle(await listFindings(request, adminToken, documentId), LAW_FINDING.title))
        .toMatchObject({ status: 'kept', decisionNote: null })
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
      await collabSidecar?.stop()
    }
  })
})
