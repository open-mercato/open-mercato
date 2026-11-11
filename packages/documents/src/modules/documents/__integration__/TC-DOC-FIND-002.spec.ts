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

test.describe('TC-DOC-FIND-002: re-ingest supersedes open AI findings', () => {
  test('supersedes earlier open findings of the same source and keeps decided ones', async ({ request }) => {
    let adminToken: string | null = null
    let documentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      documentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-002 ${Date.now()}`)

      const first = await ingestFindings(request, adminToken, documentId, {
        findings: [
          { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'secret for five years', suggestedText: 'secret for two years' },
          { severity: 'warning', title: 'Law', explanation: 'Prefer home law.', quote: 'laws of the disclosing party' },
        ],
      })
      expect(first.response.status()).toBe(201)
      const firstList = await listFindings(request, adminToken, documentId)
      const law = findingByTitle(firstList, 'Law')
      const kept = await decideFinding(request, adminToken, documentId, law, 'keep', { note: 'Acceptable' })
      expect(kept.response.status(), 'keep warning should return 200').toBe(200)

      const imported = await ingestFindings(request, adminToken, documentId, {
        source: 'import',
        supersede: false,
        findings: [{ severity: 'info', title: 'Imported note', explanation: 'From import.', quote: 'Mutual Non-Disclosure Agreement' }],
      })
      expect(imported.response.status()).toBe(201)

      const second = await ingestFindings(request, adminToken, documentId, {
        origin: { workflowInstanceId: 'wf-instance-1', agentRunId: 'run-1' },
        findings: [
          { severity: 'warning', title: 'Definitions', explanation: 'Narrow the definition.', quote: 'any non-public information' },
        ],
      })
      expect(second.response.status()).toBe(201)
      expect(second.body).toMatchObject({ created: 1, superseded: 1 })

      const firstReview = await listFindings(request, adminToken, documentId, `?reviewId=${first.body?.reviewId}`)
      expect(findingByTitle(firstReview, 'Term').status).toBe('superseded')
      expect(findingByTitle(firstReview, 'Law').status).toBe('kept')

      const importedReview = await listFindings(request, adminToken, documentId, `?reviewId=${imported.body?.reviewId}`)
      expect(findingByTitle(importedReview, 'Imported note').status).toBe('open')

      const latest = await listFindings(request, adminToken, documentId)
      expect(latest.reviewId).toBe(second.body?.reviewId)
      expect(latest.items.map((item) => item.title)).toEqual(['Definitions'])

      const openOnly = await listFindings(request, adminToken, documentId, `?reviewId=${first.body?.reviewId}&status=open`)
      expect(openOnly.total).toBe(0)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })
})
