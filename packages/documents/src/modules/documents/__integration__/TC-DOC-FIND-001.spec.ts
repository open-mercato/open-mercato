import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createAgreementDocument,
  deleteDocumentIfExists,
  findingByTitle,
  ingestFindings,
  listFindings,
  readSummary,
} from './helpers/findingsFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-FIND-001: ingest anchors review findings', () => {
  test('anchors a located quote and stores a missing quote as unlocated', async ({ request }) => {
    let adminToken: string | null = null
    let documentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      documentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-001 ${Date.now()}`)

      const ingest = await ingestFindings(request, adminToken, documentId, {
        findings: [
          {
            severity: 'blocking',
            title: 'Confidentiality term',
            explanation: 'The confidentiality term exceeds the standard two years.',
            ruleCode: 'NDA-3.1',
            sectionLabel: '2. Obligations',
            quote: 'secret for five   years',
            suggestedText: 'secret for two years',
          },
          {
            severity: 'warning',
            title: 'Missing passage',
            explanation: 'The quoted clause is not in the agreement.',
            quote: 'This clause does not exist in the agreement',
          },
        ],
      })
      expect(ingest.response.status(), 'POST findings should return 201').toBe(201)
      expect(ingest.body).toMatchObject({ created: 2, superseded: 0, unlocated: 1 })

      const list = await listFindings(request, adminToken, documentId)
      expect(list.reviewId).toBe(ingest.body?.reviewId)
      expect(list.total).toBe(2)
      const located = findingByTitle(list, 'Confidentiality term')
      expect(located).toMatchObject({
        status: 'open',
        anchorStatus: 'located',
        source: 'ai',
        suggestedText: 'secret for two years',
      })
      expect(located.anchor?.version).toBe(2)
      expect(typeof located.anchor?.relativeFrom).toBe('string')
      expect(typeof located.anchor?.relativeTo).toBe('string')
      expect(typeof located.updatedAt).toBe('string')
      const unlocated = findingByTitle(list, 'Missing passage')
      expect(unlocated).toMatchObject({ anchorStatus: 'unlocated', anchor: null, status: 'open' })

      const summary = await readSummary(request, adminToken, documentId)
      expect(summary).toMatchObject({
        reviewId: ingest.body?.reviewId,
        open: { blocking: 1, warning: 1, info: 0 },
        decided: { applied: 0, kept: 0 },
        unlocated: 1,
      })

      const invalid = await ingestFindings(request, adminToken, documentId, {
        findings: [{ severity: 'critical', title: 'x', explanation: 'y', quote: 'z' }],
      })
      expect(invalid.response.status(), 'invalid severity should be rejected').toBe(400)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })
})
