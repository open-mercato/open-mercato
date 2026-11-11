import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAgreementDocument,
  createDocumentsUser,
  decideFinding,
  deleteDocumentIfExists,
  deleteDocumentsUser,
  findingsPath,
  ingestFindings,
  listFindings,
  shareDocument,
  type FindingBody,
  type FindingsTestUser,
} from './helpers/findingsFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

const DOCUMENT_FEATURES = ['documents.view', 'documents.edit']

async function expectAllFindingRoutesHidden(
  request: APIRequestContext,
  token: string,
  documentId: string,
  finding: FindingBody,
  label: string,
): Promise<void> {
  const list = await apiRequest(request, 'GET', findingsPath(documentId), { token })
  expect(list.status(), `${label}: list findings should be 404`).toBe(404)
  const summary = await apiRequest(request, 'GET', findingsPath(documentId, '/summary'), { token })
  expect(summary.status(), `${label}: summary should be 404`).toBe(404)
  const ingest = await apiRequest(request, 'POST', findingsPath(documentId), {
    token,
    data: { findings: [{ severity: 'info', title: 'x', explanation: 'y', quote: 'z' }] },
  })
  expect(ingest.status(), `${label}: ingest should be 404`).toBe(404)
  for (const action of ['apply', 'keep', 'reopen'] as const) {
    const decision = await decideFinding(request, token, documentId, finding, action, {
      appliedText: 'secret for two years',
      note: 'n',
    })
    expect(decision.response.status(), `${label}: ${action} should be 404`).toBe(404)
  }
}

test.describe('TC-DOC-FIND-005: findings access control', () => {
  test('hides findings from commenter, viewer and cross-organization callers', async ({ request }) => {
    let adminToken: string | null = null
    let documentId: string | null = null
    let otherDocumentId: string | null = null
    let otherOrganizationId: string | null = null
    let commenter: FindingsTestUser | null = null
    let viewer: FindingsTestUser | null = null
    let editor: FindingsTestUser | null = null
    let outsider: FindingsTestUser | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenContext(adminToken)
      documentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-005 ${Date.now()}`)
      otherDocumentId = await createAgreementDocument(request, adminToken, `TC-DOC-FIND-005 other ${Date.now()}`)
      const ingest = await ingestFindings(request, adminToken, documentId, {
        findings: [
          { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'secret for five years', suggestedText: 'secret for two years' },
        ],
      })
      expect(ingest.response.status()).toBe(201)
      const finding = (await listFindings(request, adminToken, documentId)).items[0] as FindingBody

      commenter = await createDocumentsUser(request, adminToken, { label: 'commenter', features: DOCUMENT_FEATURES })
      viewer = await createDocumentsUser(request, adminToken, { label: 'viewer', features: DOCUMENT_FEATURES })
      editor = await createDocumentsUser(request, adminToken, { label: 'editor', features: DOCUMENT_FEATURES })
      await shareDocument(request, adminToken, documentId, commenter.id, 'commenter')
      await shareDocument(request, adminToken, documentId, viewer.id, 'viewer')
      await shareDocument(request, adminToken, documentId, editor.id, 'editor')

      await expectAllFindingRoutesHidden(request, commenter.token, documentId, finding, 'commenter')
      await expectAllFindingRoutesHidden(request, viewer.token, documentId, finding, 'viewer')

      const editorList = await listFindings(request, editor.token, documentId)
      expect(editorList.items.map((item) => item.id)).toEqual([finding.id])

      const wrongDocument = await decideFinding(request, adminToken, otherDocumentId, finding, 'apply', {
        appliedText: 'secret for two years',
      })
      expect(wrongDocument.response.status(), 'a finding id from another document should be 404').toBe(404)

      otherOrganizationId = await createOrganizationFixture(request, adminToken, {
        name: `TC-DOC-FIND-005 Org ${Date.now()}`,
        tenantId: scope.tenantId,
      })
      outsider = await createDocumentsUser(request, adminToken, {
        label: 'outsider',
        features: [...DOCUMENT_FEATURES, 'documents.manage'],
        organizationId: otherOrganizationId,
        organizations: [otherOrganizationId],
      })
      await expectAllFindingRoutesHidden(request, outsider.token, documentId, finding, 'cross-organization')

      const editorApply = await decideFinding(request, editor.token, documentId, finding, 'apply', {
        appliedText: 'secret for two years',
      })
      expect(editorApply.response.status(), 'editor tier may decide findings').toBe(200)
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
      await deleteDocumentIfExists(request, adminToken, otherDocumentId)
      await deleteDocumentsUser(request, adminToken, commenter)
      await deleteDocumentsUser(request, adminToken, viewer)
      await deleteDocumentsUser(request, adminToken, editor)
      await deleteDocumentsUser(request, adminToken, outsider)
      await deleteOrganizationIfExists(request, adminToken, otherOrganizationId)
    }
  })
})
