import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LEGAL-001: legal matter CRUD and the list-by-document filter the
 * document page header widget relies on.
 *
 * Self-contained: creates two documents and their matters, and removes all of
 * them in `finally`.
 */

export const integrationMeta = {
  dependsOnModules: ['legal_review', 'documents'],
}

const MATTERS_PATH = '/api/legal_review/matters'

type MatterItem = {
  id: string
  documentId: string
  reference: string
  counterparty: string
  jurisdiction: string | null
  agreementType: string
  paper: string
  stage: string
  dueAt: string | null
  updatedAt: string | null
}

type MatterList = { items?: MatterItem[]; total?: number }

async function createDocument(request: APIRequestContext, token: string, title: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/documents', { token, data: { title, folderId: null } })
  expect(response.status(), 'POST /api/documents should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id, 'document create response should include id').toBe('string')
  return body?.id as string
}

async function deleteDocumentIfExists(request: APIRequestContext, token: string | null, documentId: string | null) {
  if (!token || !documentId) return
  await apiRequest(request, 'DELETE', `/api/documents/${encodeURIComponent(documentId)}`, { token }).catch(() => undefined)
}

async function deleteMatterIfExists(request: APIRequestContext, token: string | null, matterId: string | null) {
  if (!token || !matterId) return
  await apiRequest(request, 'DELETE', `${MATTERS_PATH}?id=${encodeURIComponent(matterId)}`, { token }).catch(() => undefined)
}

async function createMatter(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', MATTERS_PATH, { token, data })
  expect(response.status(), 'POST legal matter should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string; updatedAt?: string | null }>(response)
  expect(typeof body?.id, 'matter create response should include id').toBe('string')
  return body?.id as string
}

async function listByDocument(request: APIRequestContext, token: string, documentId: string): Promise<MatterList> {
  const response = await apiRequest(request, 'GET', `${MATTERS_PATH}?documentId=${encodeURIComponent(documentId)}`, { token })
  expect(response.status(), 'GET legal matters should return 200').toBe(200)
  return (await readJsonSafe<MatterList>(response)) ?? {}
}

test.describe('TC-LEGAL-001: legal matter CRUD and list by document', () => {
  test('creates, filters, updates with optimistic locking and deletes matters', async ({ request }) => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
    let token: string | null = null
    let firstDocumentId: string | null = null
    let secondDocumentId: string | null = null
    let firstMatterId: string | null = null
    let secondMatterId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      firstDocumentId = await createDocument(request, token, `TC-LEGAL-001 NDA A ${stamp}`)
      secondDocumentId = await createDocument(request, token, `TC-LEGAL-001 NDA B ${stamp}`)

      firstMatterId = await createMatter(request, token, {
        documentId: firstDocumentId,
        reference: `LG-${stamp}`.slice(0, 32),
        counterparty: 'Northwind Traders',
        purpose: 'Evaluation of a joint logistics pilot',
        jurisdiction: 'de',
        agreementType: 'mutual_nda',
        paper: 'counterparty',
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      })
      secondMatterId = await createMatter(request, token, {
        documentId: secondDocumentId,
        reference: `LG-B-${stamp}`.slice(0, 32),
        counterparty: 'Contoso Ltd',
        agreementType: 'one_way_nda',
        paper: 'ours',
      })

      const invalid = await apiRequest(request, 'POST', MATTERS_PATH, {
        token,
        data: { documentId: firstDocumentId, reference: 'LG-X', counterparty: 'Contoso Ltd', agreementType: 'msa' },
      })
      expect(invalid.status(), 'an unknown agreement type is rejected').toBe(400)

      const firstList = await listByDocument(request, token, firstDocumentId)
      expect(firstList.items?.map((item) => item.id), 'the filter returns only the first document matter').toEqual([firstMatterId])
      const matter = firstList.items?.[0] as MatterItem
      expect(matter).toMatchObject({
        documentId: firstDocumentId,
        counterparty: 'Northwind Traders',
        jurisdiction: 'DE',
        agreementType: 'mutual_nda',
        paper: 'counterparty',
        stage: 'requested',
      })
      expect(matter.updatedAt, 'the list returns updatedAt for optimistic locking').toBeTruthy()
      expect(matter.dueAt).toBeTruthy()

      const secondList = await listByDocument(request, token, secondDocumentId)
      expect(secondList.items?.map((item) => item.id)).toEqual([secondMatterId])

      const updated = await apiRequest(request, 'PUT', MATTERS_PATH, {
        token,
        data: { id: firstMatterId, stage: 'review' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: matter.updatedAt as string },
      })
      expect(updated.status(), 'PUT with the current version should return 200').toBe(200)

      const stale = await apiRequest(request, 'PUT', MATTERS_PATH, {
        token,
        data: { id: firstMatterId, stage: 'released' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: '2000-01-01T00:00:00.000Z' },
      })
      expect(stale.status(), 'PUT with a stale version should return 409').toBe(409)

      const afterUpdate = await listByDocument(request, token, firstDocumentId)
      expect(afterUpdate.items?.[0]?.stage, 'the stale write did not apply').toBe('review')

      const deleted = await apiRequest(request, 'DELETE', `${MATTERS_PATH}?id=${encodeURIComponent(firstMatterId)}`, { token })
      expect(deleted.status(), 'DELETE legal matter should return 200').toBe(200)
      firstMatterId = null
      const afterDelete = await listByDocument(request, token, firstDocumentId)
      expect(afterDelete.items ?? [], 'a deleted matter is no longer listed').toHaveLength(0)
    } finally {
      await deleteMatterIfExists(request, token, firstMatterId)
      await deleteMatterIfExists(request, token, secondMatterId)
      await deleteDocumentIfExists(request, token, firstDocumentId)
      await deleteDocumentIfExists(request, token, secondDocumentId)
    }
  })
})
