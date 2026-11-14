import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAgreementDocument,
  createDocumentsUser,
  deleteDocumentIfExists,
  deleteDocumentsUser,
  type FindingsTestUser,
} from './helpers/findingsFixtures'
import {
  createPlaybookOrFail,
  createRule,
  deletePlaybookIfExists,
  listReferences,
  readPlaybook,
  referencesPath,
  uniqueCode,
} from './helpers/reviewPlaybookFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

test.describe('TC-DOC-PLAY-003: playbook guidance references', () => {
  test('links only documents the caller can view and resolves ingest rule codes', async ({ request }) => {
    let adminToken: string | null = null
    let playbookId: string | null = null
    let manager: FindingsTestUser | null = null
    let privateDocumentId: string | null = null
    let ownDocumentId: string | null = null
    let reviewedDocumentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const code = uniqueCode('nda')
      playbookId = await createPlaybookOrFail(request, adminToken, { code, name: 'Guidance playbook' })
      manager = await createDocumentsUser(request, adminToken, {
        label: 'playbook-manager',
        features: ['documents.view', 'documents.create', 'documents.edit', 'documents.review_playbooks.manage'],
      })
      privateDocumentId = await createAgreementDocument(request, adminToken, `TC-DOC-PLAY-003 private ${Date.now()}`)
      ownDocumentId = await createAgreementDocument(request, manager.token, `TC-DOC-PLAY-003 guidance ${Date.now()}`)

      const hidden = await apiRequest(request, 'POST', referencesPath(playbookId), {
        token: manager.token,
        data: { documentId: privateDocumentId },
      })
      expect(hidden.status(), 'linking a document the caller cannot view should be 404').toBe(404)

      const linked = await apiRequest(request, 'POST', referencesPath(playbookId), {
        token: manager.token,
        data: { documentId: ownDocumentId },
      })
      expect(linked.status(), 'linking a viewable document should return 201').toBe(201)
      const duplicate = await apiRequest(request, 'POST', referencesPath(playbookId), {
        token: manager.token,
        data: { documentId: ownDocumentId },
      })
      expect(duplicate.status(), 'linking twice should conflict').toBe(409)

      const references = await listReferences(request, manager.token, playbookId)
      expect(references).toHaveLength(1)
      expect(references[0]).toMatchObject({ documentId: ownDocumentId, accessible: true })
      expect((await readPlaybook(request, adminToken, playbookId))?.version).toBe(2)

      const unlinked = await apiRequest(request, 'DELETE', `${referencesPath(playbookId)}?documentId=${encodeURIComponent(ownDocumentId)}`, {
        token: manager.token,
      })
      expect(unlinked.status(), 'unlinking should return 200').toBe(200)
      expect(await listReferences(request, manager.token, playbookId)).toHaveLength(0)

      const rule = await createRule(request, adminToken, playbookId, { code: 'NDA-3.1', severity: 'blocking' })
      expect(rule.response.status()).toBe(201)
      const version = (await readPlaybook(request, adminToken, playbookId))?.version
      reviewedDocumentId = await createAgreementDocument(request, adminToken, `TC-DOC-PLAY-003 reviewed ${Date.now()}`)
      const ingest = await apiRequest(request, 'POST', `/api/documents/${encodeURIComponent(reviewedDocumentId)}/findings`, {
        token: adminToken,
        data: {
          playbookCode: code,
          findings: [
            { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'secret for five years', ruleCode: 'NDA-3.1' },
            { severity: 'warning', title: 'Unknown rule', explanation: 'No such rule.', quote: 'governed by the laws', ruleCode: 'NDA-404' },
          ],
        },
      })
      expect(ingest.status(), 'ingest should return 201').toBe(201)
      const list = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(reviewedDocumentId)}/findings`, { token: adminToken })
      const body = await readJsonSafe<{
        playbook: { id: string; name: string; version: number | null } | null
        items: Array<{ title: string; playbookId: string | null; playbookVersion: number | null; ruleId: string | null; ruleCode: string | null }>
      }>(list)
      expect(body?.playbook).toMatchObject({ id: playbookId, name: 'Guidance playbook', version })
      const term = body?.items.find((item) => item.title === 'Term')
      const unknown = body?.items.find((item) => item.title === 'Unknown rule')
      expect(term).toMatchObject({ playbookId, playbookVersion: version, ruleId: rule.body?.id, ruleCode: 'NDA-3.1' })
      expect(unknown).toMatchObject({ playbookId, ruleId: null, ruleCode: 'NDA-404' })
      const summary = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(reviewedDocumentId)}/findings/summary`, { token: adminToken })
      expect((await readJsonSafe<{ playbook?: { id: string } | null }>(summary))?.playbook?.id).toBe(playbookId)
    } finally {
      await deleteDocumentIfExists(request, adminToken, reviewedDocumentId)
      await deleteDocumentIfExists(request, manager?.token ?? null, ownDocumentId)
      await deleteDocumentIfExists(request, adminToken, ownDocumentId)
      await deleteDocumentIfExists(request, adminToken, privateDocumentId)
      await deletePlaybookIfExists(request, adminToken, playbookId)
      await deleteDocumentsUser(request, adminToken, manager)
    }
  })
})
