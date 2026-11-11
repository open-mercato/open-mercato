import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createAgreementDocument,
  decideFinding,
  deleteDocumentIfExists,
  findingByTitle,
  ingestFindings,
  listFindings,
} from './helpers/findingsFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-FIND-003: finding decisions', () => {
  test('applies, keeps and reopens findings with lock and validation errors', async ({ request }) => {
    let adminToken: string | null = null
    let documentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      documentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-003 ${Date.now()}`)
      const ingest = await ingestFindings(request, adminToken, documentId, {
        findings: [
          { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'secret for five years', suggestedText: 'secret for two years' },
          { severity: 'blocking', title: 'Law', explanation: 'Use home law.', quote: 'laws of the disclosing party' },
          { severity: 'info', title: 'Title', explanation: 'Advisory.', quote: 'Mutual Non-Disclosure Agreement' },
        ],
      })
      expect(ingest.response.status()).toBe(201)
      const list = await listFindings(request, adminToken, documentId)
      const term = findingByTitle(list, 'Term')
      const law = findingByTitle(list, 'Law')
      const title = findingByTitle(list, 'Title')

      const stale = await decideFinding(request, adminToken, documentId, { id: term.id, updatedAt: '2020-01-01T00:00:00.000Z' }, 'apply', {
        appliedText: 'secret for two years',
      })
      expect(stale.response.status(), 'stale expectedUpdatedAt should conflict').toBe(409)

      const applied = await decideFinding(request, adminToken, documentId, term, 'apply', { appliedText: 'secret for two years' })
      expect(applied.response.status()).toBe(200)
      expect(applied.body).toMatchObject({ status: 'applied', appliedText: 'secret for two years' })
      expect(applied.body?.decidedAt).toBeTruthy()
      expect(applied.body?.updatedAt).not.toBe(term.updatedAt)

      const appliedAgain = await decideFinding(request, adminToken, documentId, applied.body as { id: string; updatedAt: string }, 'keep', {
        note: 'late',
      })
      expect(appliedAgain.response.status(), 'decision on a decided finding should conflict').toBe(409)

      const noSuggestion = await decideFinding(request, adminToken, documentId, title, 'apply', { appliedText: 'x' })
      expect(noSuggestion.response.status(), 'apply without suggestion should be 422').toBe(422)

      const keepWithoutNote = await decideFinding(request, adminToken, documentId, law, 'keep', {})
      expect(keepWithoutNote.response.status(), 'keep blocking without note should be 422').toBe(422)

      const kept = await decideFinding(request, adminToken, documentId, law, 'keep', { note: 'Client accepts the risk' })
      expect(kept.response.status()).toBe(200)
      expect(kept.body).toMatchObject({ status: 'kept', decisionNote: 'Client accepts the risk' })

      const reopened = await decideFinding(request, adminToken, documentId, kept.body as { id: string; updatedAt: string }, 'reopen')
      expect(reopened.response.status()).toBe(200)
      expect(reopened.body).toMatchObject({ status: 'open', decisionNote: null, decidedByUserId: null, decidedAt: null })

      const reopenOpen = await decideFinding(request, adminToken, documentId, title, 'reopen')
      expect(reopenOpen.response.status(), 'reopen of an open finding should conflict').toBe(409)

      const keptInfo = await decideFinding(request, adminToken, documentId, title, 'keep', {})
      expect(keptInfo.response.status(), 'keep without note is allowed for non-blocking findings').toBe(200)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })
})
