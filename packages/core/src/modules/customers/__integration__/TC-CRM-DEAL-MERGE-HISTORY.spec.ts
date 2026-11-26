import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'audit_logs'] }

const MERGE_PATH = '/api/customers/deals/merge'
const INTERACTIONS_PATH = '/api/customers/interactions'

type MergeRecordPreview = { id: string; updatedAt: string; fields: Record<string, unknown>; customFields: Record<string, unknown> }
type MergePreview = { left: MergeRecordPreview; right: MergeRecordPreview }
type ItemPage = { items?: Array<Record<string, unknown>> }
type CompanyDetail = { company?: { displayName?: unknown } }

async function mergeDeals(
  request: APIRequestContext,
  token: string,
  input: { survivorId: string; sourceId: string; title: string; companyIds: string[] },
): Promise<void> {
  const params = new URLSearchParams({ left: input.survivorId, right: input.sourceId })
  const previewResponse = await apiRequest(request, 'GET', `${MERGE_PATH}?${params}`, { token })
  expect(previewResponse.status(), 'merge preview should load both Deals').toBe(200)
  const preview = await readJsonSafe<MergePreview>(previewResponse)
  expect(preview?.left.id).toBe(input.survivorId)
  const response = await apiRequest(request, 'POST', MERGE_PATH, {
    token,
    data: {
      survivorId: input.survivorId,
      sourceId: input.sourceId,
      survivorUpdatedAt: preview!.left.updatedAt,
      sourceUpdatedAt: preview!.right.updatedAt,
      values: { ...preview!.left.fields, title: input.title },
      customFields: preview!.left.customFields ?? {},
      personIds: [],
      companyIds: input.companyIds,
      primaryPersonEntityId: null,
    },
  })
  expect(response.status(), `merge should succeed (${response.status()})`).toBe(200)
}

async function readDealCompanyIds(request: APIRequestContext, token: string, dealId: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}/companies?page=1&pageSize=100`, { token })
  expect(response.status(), `companies of Deal ${dealId} should be readable`).toBe(200)
  const body = await readJsonSafe<ItemPage>(response)
  return (body?.items ?? []).map((item) => String(item.id))
}

async function readInteractionVersion(
  request: APIRequestContext,
  token: string,
  companyId: string,
  interactionId: string,
): Promise<{ updatedAt: string; dealId: unknown }> {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS_PATH}?entityId=${companyId}&limit=100`, { token })
  expect(response.status(), 'interactions should be listed for their company').toBe(200)
  const body = await readJsonSafe<ItemPage>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === interactionId)
  expect(item, 'the interaction should be listed').toBeTruthy()
  expect(typeof item?.updatedAt, 'the interaction should expose its edit version').toBe('string')
  return { updatedAt: String(item?.updatedAt), dealId: item?.dealId }
}

test.describe('TC-CRM-DEAL-MERGE-HISTORY: merges stay consistent with earlier edits and edit tokens', () => {
  test('undoing an earlier company edit keeps the Deal link a merge moved to the survivor', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const deals: string[] = []
    let companyId: string | null = null

    try {
      const originalName = `QA merge history Co ${stamp}`
      companyId = await createCompanyFixture(request, token, originalName)
      const survivorId = await createDealFixture(request, token, { title: `QA history survivor ${stamp}` })
      const sourceId = await createDealFixture(request, token, { title: `QA history source ${stamp}`, companyIds: [companyId] })
      deals.push(survivorId, sourceId)

      const editResponse = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: { id: companyId, displayName: `${originalName} edited` },
      })
      expect(editResponse.ok(), `company edit should succeed (${editResponse.status()})`).toBeTruthy()
      const editOperation = expectOperation(editResponse, 'company edit')
      expect(editOperation.commandId).toBe('customers.companies.update')

      await mergeDeals(request, token, { survivorId, sourceId, title: `QA history merged ${stamp}`, companyIds: [companyId] })
      deals.splice(deals.indexOf(sourceId), 1)
      expect(await readDealCompanyIds(request, token, survivorId)).toEqual([companyId])

      await undoOk(request, token, editOperation.undoToken, 'company edit after Deal merge')

      expect(
        await readDealCompanyIds(request, token, survivorId),
        'undoing the company edit must not delete the link the merge moved to the survivor',
      ).toEqual([companyId])
      const sourceResponse = await apiRequest(request, 'GET', `/api/customers/deals/${sourceId}`, { token })
      expect(sourceResponse.status(), 'the merged-away Deal must stay gone').toBe(404)
      const companyResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
      expect(companyResponse.status()).toBe(200)
      const company = await readJsonSafe<CompanyDetail>(companyResponse)
      expect(company?.company?.displayName, 'the company edit itself should be undone').toBe(originalName)
    } finally {
      for (const id of deals.reverse()) await deleteEntityIfExists(request, token, '/api/customers/deals', id)
      if (companyId) await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('a pre-merge edit token for a directly moved interaction is rejected after the merge', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const deals: string[] = []
    let interactionId: string | null = null
    let companyId: string | null = null

    try {
      companyId = await createCompanyFixture(request, token, `QA merge token Co ${stamp}`)
      const survivorId = await createDealFixture(request, token, { title: `QA token survivor ${stamp}` })
      const sourceId = await createDealFixture(request, token, { title: `QA token source ${stamp}` })
      deals.push(survivorId, sourceId)

      const createResponse = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
        token,
        data: {
          entityId: companyId,
          dealId: sourceId,
          interactionType: 'task',
          title: `QA token interaction ${stamp}`,
          status: 'planned',
        },
      })
      expect(createResponse.ok(), `interaction create should succeed (${createResponse.status()})`).toBeTruthy()
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      expect(created?.id, 'interaction create should return an id').toBeTruthy()
      interactionId = created!.id!

      const beforeMerge = await readInteractionVersion(request, token, companyId, interactionId)
      expect(beforeMerge.dealId).toBe(sourceId)

      await mergeDeals(request, token, { survivorId, sourceId, title: `QA token merged ${stamp}`, companyIds: [] })
      deals.splice(deals.indexOf(sourceId), 1)

      const afterMerge = await readInteractionVersion(request, token, companyId, interactionId)
      expect(afterMerge.dealId, 'the interaction should now reference the survivor').toBe(survivorId)
      expect(afterMerge.updatedAt, 'the direct move must advance the edit version').not.toBe(beforeMerge.updatedAt)

      const staleEdit = await apiRequest(request, 'PUT', INTERACTIONS_PATH, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: beforeMerge.updatedAt },
        data: { id: interactionId, title: `QA token stale edit ${stamp}` },
      })
      const staleBody = await readJsonSafe<{ code?: string }>(staleEdit)
      expect(staleEdit.status(), 'a token issued before the merge must not authorize a write').toBe(409)
      expect(staleBody?.code).toBe('optimistic_lock_conflict')

      const freshEdit = await apiRequest(request, 'PUT', INTERACTIONS_PATH, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: afterMerge.updatedAt },
        data: { id: interactionId, title: `QA token fresh edit ${stamp}` },
      })
      expect(freshEdit.ok(), `a fresh token should authorize the write (${freshEdit.status()})`).toBeTruthy()
    } finally {
      if (interactionId) await deleteEntityIfExists(request, token, INTERACTIONS_PATH, interactionId)
      for (const id of deals.reverse()) await deleteEntityIfExists(request, token, '/api/customers/deals', id)
      if (companyId) await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
