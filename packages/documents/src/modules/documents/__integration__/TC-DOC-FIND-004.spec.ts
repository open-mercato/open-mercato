import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAgreementDocument,
  decideFinding,
  deleteDocumentIfExists,
  findingByTitle,
  ingestFindings,
  listFindings,
  readSummary,
  type FindingBody,
} from './helpers/findingsFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents', 'audit_logs'],
}

const FINDING_RESOURCE_KIND = 'documents:document_finding'
const REVIEW_CLEARED = 'documents.review.cleared'

type ActionLogItem = {
  commandId: string
  context: { emittedEvents?: string[] } | null
}

async function emittedEventsFor(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<Array<{ commandId: string; events: string[] }>> {
  const params = new URLSearchParams({ resourceKind: FINDING_RESOURCE_KIND, resourceId, sortDir: 'asc', pageSize: '50' })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${params.toString()}`, { token })
  expect(response.status(), 'GET audit log actions should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: ActionLogItem[] }>(response)
  return (body?.items ?? []).map((item) => ({ commandId: item.commandId, events: item.context?.emittedEvents ?? [] }))
}

function clearedCount(entries: Array<{ events: string[] }>): number {
  return entries.filter((entry) => entry.events.includes(REVIEW_CLEARED)).length
}

test.describe('TC-DOC-FIND-004: review summary and clearance signal', () => {
  test('emits review.cleared once per transition to zero open blocking findings', async ({ request }) => {
    let adminToken: string | null = null
    let documentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      documentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-004 ${Date.now()}`)
      const ingest = await ingestFindings(request, adminToken, documentId, {
        findings: [
          { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'secret for five years', suggestedText: 'secret for two years' },
          { severity: 'blocking', title: 'Law', explanation: 'Use home law.', quote: 'laws of the disclosing party' },
          { severity: 'warning', title: 'Definitions', explanation: 'Narrow it.', quote: 'any non-public information' },
        ],
      })
      expect(ingest.response.status()).toBe(201)
      const reviewId = ingest.body?.reviewId as string
      expect(clearedCount(await emittedEventsFor(request, adminToken, reviewId))).toBe(0)

      let list = await listFindings(request, adminToken, documentId)
      const warning = await decideFinding(request, adminToken, documentId, findingByTitle(list, 'Definitions'), 'keep', {})
      expect(warning.response.status()).toBe(200)

      const term = await decideFinding(request, adminToken, documentId, findingByTitle(list, 'Term'), 'apply', {
        appliedText: 'secret for two years',
      })
      expect(term.response.status()).toBe(200)
      expect((await readSummary(request, adminToken, documentId)).open.blocking).toBe(1)

      const lawKept = await decideFinding(request, adminToken, documentId, findingByTitle(list, 'Law'), 'keep', {
        note: 'Accepted by counsel',
      })
      expect(lawKept.response.status()).toBe(200)
      const cleared = await readSummary(request, adminToken, documentId)
      expect(cleared).toMatchObject({
        reviewId,
        open: { blocking: 0, warning: 0, info: 0 },
        decided: { applied: 1, kept: 2 },
      })
      expect(cleared.reviewedAt).toBeTruthy()

      const law = lawKept.body as FindingBody
      expect(clearedCount(await emittedEventsFor(request, adminToken, law.id))).toBe(1)

      const reopened = await decideFinding(request, adminToken, documentId, law, 'reopen')
      expect(reopened.response.status()).toBe(200)
      expect((await readSummary(request, adminToken, documentId)).open.blocking).toBe(1)

      const keptAgain = await decideFinding(request, adminToken, documentId, reopened.body as FindingBody, 'keep', {
        note: 'Accepted again',
      })
      expect(keptAgain.response.status()).toBe(200)
      expect((await readSummary(request, adminToken, documentId)).open.blocking).toBe(0)

      const lawEvents = await emittedEventsFor(request, adminToken, law.id)
      expect(clearedCount(lawEvents), 'each transition to zero emits review.cleared again').toBe(2)
      expect(lawEvents.find((entry) => entry.commandId === 'documents.finding.reopen')?.events).toEqual([
        'documents.finding.reopened',
      ])

      list = await listFindings(request, adminToken, documentId)
      const definitionsEvents = await emittedEventsFor(request, adminToken, findingByTitle(list, 'Definitions').id)
      expect(clearedCount(definitionsEvents), 'non-blocking decisions never clear the review').toBe(0)
      const termEvents = await emittedEventsFor(request, adminToken, findingByTitle(list, 'Term').id)
      expect(clearedCount(termEvents), 'a decision that leaves blocking findings open does not clear').toBe(0)

      const advisory = await ingestFindings(request, adminToken, documentId, {
        findings: [{ severity: 'info', title: 'Title', explanation: 'Advisory only.', quote: 'Mutual Non-Disclosure Agreement' }],
      })
      expect(advisory.response.status()).toBe(201)
      expect(clearedCount(await emittedEventsFor(request, adminToken, advisory.body?.reviewId as string)),
        'a review without blocking findings is cleared on ingest').toBe(1)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })
})
