import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import {
  createAgreementDocument,
  decideFinding,
  deleteDocumentIfExists,
  findingByTitle,
  ingestFindings,
  listFindings,
  readSummary,
} from './helpers/findingsFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents', 'audit_logs'],
}

test.describe('TC-DOC-FIND-006: undo review findings', () => {
  test('undo ingest restores superseded findings and undo keep reopens the finding', async ({ request }) => {
    skipIfUndoTestsDisabled()
    let adminToken: string | null = null
    let documentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      documentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-006 ${Date.now()}`)
      const first = await ingestFindings(request, adminToken, documentId, {
        findings: [
          { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'secret for five years', suggestedText: 'secret for two years' },
        ],
      })
      expect(first.response.status()).toBe(201)

      const second = await ingestFindings(request, adminToken, documentId, {
        findings: [
          { severity: 'warning', title: 'Law', explanation: 'Use home law.', quote: 'laws of the disclosing party' },
        ],
      })
      expect(second.response.status()).toBe(201)
      expect(second.body?.superseded).toBe(1)
      const ingestOperation = expectOperation(second.response, 'ingest review findings')

      await undoOk(request, adminToken, ingestOperation.undoToken, 'undo ingest review findings')
      const restored = await listFindings(request, adminToken, documentId)
      expect(restored.reviewId).toBe(first.body?.reviewId)
      expect(findingByTitle(restored, 'Term').status).toBe('open')
      const secondReview = await listFindings(request, adminToken, documentId, `?reviewId=${second.body?.reviewId}`)
      expect(secondReview.total, 'undone ingest removes its findings').toBe(0)

      const term = findingByTitle(restored, 'Term')
      const kept = await decideFinding(request, adminToken, documentId, term, 'keep', { note: 'Accepted' })
      expect(kept.response.status()).toBe(200)
      expect((await readSummary(request, adminToken, documentId)).open.blocking).toBe(0)
      const keepOperation = expectOperation(kept.response, 'keep review finding')

      await undoOk(request, adminToken, keepOperation.undoToken, 'undo keep review finding')
      const afterUndo = findingByTitle(await listFindings(request, adminToken, documentId), 'Term')
      expect(afterUndo).toMatchObject({ status: 'open', decisionNote: null, decidedByUserId: null, decidedAt: null })
      expect((await readSummary(request, adminToken, documentId)).open.blocking).toBe(1)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })
})
