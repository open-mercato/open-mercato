import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'documents'] }

const DEAL_ENTITY_ID = 'customers:customer_deal'
const DEALS_PATH = '/api/customers/deals'
const MERGE_PATH = '/api/customers/deals/merge'

type MergeRecordPreview = {
  id: string
  createdAt: string
  updatedAt: string
  fields: Record<string, unknown>
  customFields: Record<string, unknown>
  counts: { interactions: number }
}

type MergeParticipantPreview = { participantId: string; sourceCount: number; survivorCount: number }
type MergePreview = { left: MergeRecordPreview; right: MergeRecordPreview; participants: MergeParticipantPreview[] }
type CreatedRecord = { id?: string }
type ItemPage = { items?: Array<Record<string, unknown>> }
type DealState = { title: unknown; updatedAt: unknown }
type DealDetail = { deal?: { title?: unknown; updatedAt?: unknown }; customFields?: Record<string, unknown> }

function mergeBody(survivorId: string, sourceId: string, title: string, updatedAt: string) {
  return {
    survivorId,
    sourceId,
    survivorUpdatedAt: updatedAt,
    sourceUpdatedAt: updatedAt,
    values: {
      title,
      description: null,
      status: 'open',
      pipelineStage: null,
      pipelineId: null,
      pipelineStageId: null,
      valueAmount: null,
      valueCurrency: null,
      probability: null,
      expectedCloseAt: null,
      ownerUserId: null,
      source: null,
      lossReasonId: null,
      lossNotes: null,
    },
    customFields: {},
    personIds: [],
    companyIds: [],
    primaryPersonEntityId: null,
  }
}

async function createDealInOrganization(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  title: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', DEALS_PATH, {
    token,
    selectedOrgId: organizationId,
    data: { title },
  })
  const body = await readJsonSafe<{ id?: string; dealId?: string }>(response)
  expect(response.status(), `POST ${DEALS_PATH} in the selected organization returned ${response.status()}`).toBe(201)
  return expectId(body?.id ?? body?.dealId, 'Deal creation response should include id')
}

async function readDealState(
  request: APIRequestContext,
  token: string,
  organizationId: string | null,
  dealId: string,
): Promise<DealState> {
  const path = `${DEALS_PATH}/${dealId}`
  const response = organizationId
    ? await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId: organizationId })
    : await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `Deal ${dealId} should still be readable by its owner`).toBe(200)
  const body = await readJsonSafe<DealDetail>(response)
  const state = { title: body?.deal?.title, updatedAt: body?.deal?.updatedAt }
  expect(typeof state.title, `Deal ${dealId} detail should expose its title`).toBe('string')
  expect(typeof state.updatedAt, `Deal ${dealId} detail should expose its updatedAt`).toBe('string')
  return state
}

async function deleteDealInOrganization(
  request: APIRequestContext,
  token: string | null,
  organizationId: string | null,
  dealId: string | null,
): Promise<void> {
  if (!token || !dealId) return
  const path = `${DEALS_PATH}?id=${encodeURIComponent(dealId)}`
  if (organizationId) {
    await apiRequestWithSelectedOrg(request, 'DELETE', path, { token, selectedOrgId: organizationId }).catch(() => undefined)
    return
  }
  await apiRequest(request, 'DELETE', path, { token }).catch(() => undefined)
}

async function expectSameResponseAsMissing(
  request: APIRequestContext,
  token: string,
  label: string,
  send: (dealId: string) => Promise<APIResponse>,
  outOfScopeId: string,
): Promise<void> {
  const missing = await send(randomUUID())
  const outOfScope = await send(outOfScopeId)
  const missingBody = await readJsonSafe<Record<string, unknown>>(missing)
  const outOfScopeBody = await readJsonSafe<Record<string, unknown>>(outOfScope)
  expect([404, 409], `${label}: a missing Deal should be refused as not found or gone`).toContain(missing.status())
  expect(outOfScope.status(), `${label}: an out-of-scope Deal must look exactly like a missing one`).toBe(missing.status())
  expect(outOfScopeBody, `${label}: the refusal body must not reveal the out-of-scope Deal`).toEqual(missingBody)
}

async function createRelatedRecord(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<CreatedRecord>(response)
  expect(response.ok(), `POST ${path} returned ${response.status()}`).toBeTruthy()
  expect(body?.id, `POST ${path} did not return an id`).toBeTruthy()
  return body!.id!
}

async function loadMergePreview(
  request: APIRequestContext,
  token: string,
  leftId: string,
  rightId: string,
): Promise<MergePreview> {
  const params = new URLSearchParams({ left: leftId, right: rightId })
  const response = await apiRequest(request, 'GET', `/api/customers/deals/merge?${params}`, { token })
  const body = await readJsonSafe<MergePreview>(response)
  expect(response.status(), 'merge preview should load both scoped Deals').toBe(200)
  expect(body?.left.id).toBe(leftId)
  expect(body?.right.id).toBe(rightId)
  expect(body?.left.updatedAt).toBeTruthy()
  expect(body?.right.updatedAt).toBeTruthy()
  expect(body?.left.createdAt).toBeTruthy()
  expect(body?.right.createdAt).toBeTruthy()
  return body!
}

async function createDealTextDefinition(request: APIRequestContext, token: string, key: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: { entityId: DEAL_ENTITY_ID, key, kind: 'text', configJson: { label: key } },
  })
  expect(response.status(), 'deal custom field definition should be created').toBe(200)
}

async function deleteDealDefinition(request: APIRequestContext, token: string, key: string): Promise<void> {
  const response = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: { entityId: DEAL_ENTITY_ID, key },
  })
  expect([200, 404]).toContain(response.status())
}

async function setDealCustomValue(
  request: APIRequestContext,
  token: string,
  dealId: string,
  key: string,
  value: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/customers/deals', {
    token,
    data: { id: dealId, customFields: { [key]: value } },
  })
  expect(response.ok(), `deal custom value update returned ${response.status()}`).toBeTruthy()
}

async function createDocument(request: APIRequestContext, token: string, title: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<CreatedRecord>(response)
  expect(response.status(), 'document fixture should be created').toBe(201)
  expect(body?.id).toBeTruthy()
  return body!.id!
}

async function linkDocumentToDeal(
  request: APIRequestContext,
  token: string,
  documentId: string,
  dealId: string,
  label: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/documents/${documentId}/links`, {
    token,
    data: {
      entityType: 'deal',
      entityId: dealId,
      label,
      href: `/backend/customers/deals/${dealId}`,
      source: 'related-panel',
    },
  })
  expect(response.status(), 'document should link to Deal').toBe(201)
}

test.describe('TC-CRM-DEAL-MERGE: merge two Deals', () => {
  test('rejects a stale preview, then atomically merges fields, relations and references', async ({ request }) => {
    test.slow()
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const fieldKey = `qa_merge_cf_${stamp}`
    let definitionCreated = false
    const created = {
      people: [] as string[],
      companies: [] as string[],
      deals: [] as string[],
      interactions: [] as string[],
      comments: [] as string[],
      activities: [] as string[],
      documents: [] as string[],
    }

    try {
      const sharedPersonId = await createPersonFixture(request, token, {
        firstName: 'Merge', lastName: `Shared ${stamp}`, displayName: `Merge Shared ${stamp}`,
      })
      const sourcePersonId = await createPersonFixture(request, token, {
        firstName: 'Merge', lastName: `Source ${stamp}`, displayName: `Merge Source ${stamp}`,
      })
      created.people.push(sharedPersonId, sourcePersonId)

      const survivorCompanyId = await createCompanyFixture(request, token, `Merge Survivor Co ${stamp}`)
      const sourceCompanyId = await createCompanyFixture(request, token, `Merge Source Co ${stamp}`)
      created.companies.push(survivorCompanyId, sourceCompanyId)

      const survivorId = await createDealFixture(request, token, {
        title: `Merge survivor ${stamp}`,
        personIds: [sharedPersonId],
        companyIds: [survivorCompanyId],
        valueAmount: 100,
        valueCurrency: 'USD',
        status: 'open',
      })
      const sourceId = await createDealFixture(request, token, {
        title: `Merge source ${stamp}`,
        personIds: [sharedPersonId, sourcePersonId],
        companyIds: [survivorCompanyId, sourceCompanyId],
        valueAmount: 250,
        valueCurrency: 'USD',
        status: 'open',
      })
      created.deals.push(survivorId, sourceId)

      await createDealTextDefinition(request, token, fieldKey)
      definitionCreated = true
      await setDealCustomValue(request, token, survivorId, fieldKey, `survivor value ${stamp}`)
      await setDealCustomValue(request, token, sourceId, fieldKey, `source value ${stamp}`)

      const interactionId = await createRelatedRecord(request, token, '/api/customers/interactions', {
        entityId: sourceCompanyId,
        dealId: sourceId,
        interactionType: 'task',
        title: `Merge interaction ${stamp}`,
        status: 'planned',
      })
      created.interactions.push(interactionId)

      const commentId = await createRelatedRecord(request, token, '/api/customers/comments', {
        entityId: sourceCompanyId,
        dealId: sourceId,
        body: `Merge comment ${stamp}`,
      })
      created.comments.push(commentId)

      const activityId = await createRelatedRecord(request, token, '/api/customers/activities', {
        entityId: sourceCompanyId,
        dealId: sourceId,
        activityType: 'note',
        subject: `Merge activity ${stamp}`,
      })
      created.activities.push(activityId)

      const documentId = await createDocument(request, token, `Merge document ${stamp}`)
      created.documents.push(documentId)
      await linkDocumentToDeal(request, token, documentId, survivorId, `Survivor ${stamp}`)
      await linkDocumentToDeal(request, token, documentId, sourceId, `Source ${stamp}`)

      const stalePreview = await loadMergePreview(request, token, survivorId, sourceId)
      const concurrentUpdate = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: survivorId, title: `Merge survivor concurrently changed ${stamp}` },
      })
      expect(concurrentUpdate.ok(), 'concurrent Deal update should succeed').toBeTruthy()

      const staleMerge = await apiRequest(request, 'POST', '/api/customers/deals/merge', {
        token,
        data: {
          survivorId,
          sourceId,
          survivorUpdatedAt: stalePreview.left.updatedAt,
          sourceUpdatedAt: stalePreview.right.updatedAt,
          values: { ...stalePreview.left.fields, title: `Merged Deal ${stamp}` },
          customFields: stalePreview.left.customFields ?? {},
          personIds: [sharedPersonId, sourcePersonId],
          companyIds: [survivorCompanyId, sourceCompanyId],
          primaryPersonEntityId: sharedPersonId,
        },
      })
      expect(staleMerge.status(), 'stale survivor token should reject the whole merge').toBe(409)

      const sourceAfterConflict = await apiRequest(request, 'GET', `/api/customers/deals/${sourceId}`, { token })
      expect(sourceAfterConflict.status(), 'source Deal should survive a rejected merge').toBe(200)

      const sourceStalePreview = await loadMergePreview(request, token, survivorId, sourceId)
      const concurrentSourceUpdate = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: sourceId, title: `Merge source concurrently changed ${stamp}` },
      })
      expect(concurrentSourceUpdate.ok(), 'concurrent source Deal update should succeed').toBeTruthy()
      const staleSourceMerge = await apiRequest(request, 'POST', '/api/customers/deals/merge', {
        token,
        data: {
          survivorId,
          sourceId,
          survivorUpdatedAt: sourceStalePreview.left.updatedAt,
          sourceUpdatedAt: sourceStalePreview.right.updatedAt,
          values: { ...sourceStalePreview.left.fields, title: `Merged Deal ${stamp}` },
          customFields: sourceStalePreview.left.customFields ?? {},
          personIds: [sharedPersonId],
          companyIds: [survivorCompanyId],
          primaryPersonEntityId: sharedPersonId,
        },
      })
      const staleSourceBody = await readJsonSafe<{ code?: string }>(staleSourceMerge)
      expect(staleSourceMerge.status(), 'stale source token should reject the whole merge').toBe(409)
      expect(staleSourceBody?.code).toBe('optimistic_lock_conflict')
      const survivorAfterSourceConflict = await apiRequest(request, 'GET', `/api/customers/deals/${survivorId}`, { token })
      const survivorAfterSourceConflictBody = await readJsonSafe<DealDetail>(survivorAfterSourceConflict)
      expect(survivorAfterSourceConflictBody?.deal?.title, 'rejected merge must not change the survivor')
        .toBe(`Merge survivor concurrently changed ${stamp}`)

      const freshPreview = await loadMergePreview(request, token, survivorId, sourceId)
      const documentPreview = freshPreview.participants.find((entry) => entry.participantId === 'documents.deal-links')
      expect(documentPreview, 'an admin with documents.view should see the documents participant counts').toBeTruthy()
      expect(documentPreview?.sourceCount).toBe(1)
      expect(documentPreview?.survivorCount).toBe(1)
      expect(freshPreview.left.customFields[fieldKey]).toBe(`survivor value ${stamp}`)
      expect(freshPreview.right.customFields[fieldKey]).toBe(`source value ${stamp}`)
      const mergedTitle = `Merged Deal ${stamp}`
      const mergeResponse = await apiRequest(request, 'POST', '/api/customers/deals/merge', {
        token,
        data: {
          survivorId,
          sourceId,
          survivorUpdatedAt: freshPreview.left.updatedAt,
          sourceUpdatedAt: freshPreview.right.updatedAt,
          values: { ...freshPreview.left.fields, title: mergedTitle, valueAmount: 250, valueCurrency: 'USD' },
          customFields: { ...(freshPreview.left.customFields ?? {}), [fieldKey]: freshPreview.right.customFields[fieldKey] },
          personIds: [sharedPersonId, sourcePersonId],
          companyIds: [survivorCompanyId, sourceCompanyId],
          primaryPersonEntityId: sharedPersonId,
        },
      })
      const mergeBody = await readJsonSafe<{ ok?: boolean; survivorId?: string; sourceId?: string }>(mergeResponse)
      expect(mergeResponse.status(), 'fresh merge should succeed').toBe(200)
      expect(mergeBody).toMatchObject({ ok: true, survivorId, sourceId })

      const sourceAfterMerge = await apiRequest(request, 'GET', `/api/customers/deals/${sourceId}`, { token })
      expect(sourceAfterMerge.status(), 'merged-away Deal should no longer be readable').toBe(404)

      const survivorResponse = await apiRequest(request, 'GET', `/api/customers/deals/${survivorId}`, { token })
      const survivor = await readJsonSafe<DealDetail>(survivorResponse)
      expect(survivorResponse.status()).toBe(200)
      expect(survivor?.deal?.title).toBe(mergedTitle)
      const survivorCustomFields = survivor?.customFields ?? {}
      expect(survivorCustomFields[fieldKey], 'chosen source custom value should land on the survivor')
        .toBe(`source value ${stamp}`)

      const companiesResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals/${survivorId}/companies?page=1&pageSize=100`,
        { token },
      )
      const companies = await readJsonSafe<ItemPage>(companiesResponse)
      expect(companiesResponse.status()).toBe(200)
      const companyIds = (companies?.items ?? []).map((item) => item.id)
      expect(companyIds.sort(), 'shared company should be deduplicated and source company reparented')
        .toEqual([survivorCompanyId, sourceCompanyId].sort())

      const peopleResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals/${survivorId}/people?page=1&pageSize=100`,
        { token },
      )
      const people = await readJsonSafe<ItemPage>(peopleResponse)
      expect(peopleResponse.status()).toBe(200)
      expect((people?.items ?? []).map((item) => item.id).sort()).toEqual([sharedPersonId, sourcePersonId].sort())
      expect((people?.items ?? []).filter((item) => item.isPrimary === true)).toHaveLength(1)
      expect((people?.items ?? []).find((item) => item.isPrimary === true)?.id).toBe(sharedPersonId)

      const interactionsResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${sourceCompanyId}&limit=100`,
        { token },
      )
      const interactions = await readJsonSafe<ItemPage>(interactionsResponse)
      expect(interactionsResponse.status()).toBe(200)
      expect((interactions?.items ?? []).find((item) => item.id === interactionId)?.dealId).toBe(survivorId)

      const commentsResponse = await apiRequest(request, 'GET', `/api/customers/comments?entityId=${sourceCompanyId}`, { token })
      const comments = await readJsonSafe<ItemPage>(commentsResponse)
      expect(commentsResponse.status()).toBe(200)
      const movedComment = (comments?.items ?? []).find((item) => item.id === commentId)
      expect(movedComment, 'the comment should still be listed for its company').toBeTruthy()
      expect(movedComment?.dealId ?? movedComment?.deal_id).toBe(survivorId)

      const documentLinksResponse = await apiRequest(
        request,
        'GET',
        `/api/documents/${documentId}/links`,
        { token },
      )
      const documentLinks = await readJsonSafe<ItemPage>(documentLinksResponse)
      expect(documentLinksResponse.status()).toBe(200)
      const dealLinks = (documentLinks?.items ?? []).filter((item) => item.entityType === 'deal')
      expect(dealLinks).toHaveLength(1)
      expect(dealLinks[0]?.entityId).toBe(survivorId)

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?ids=${encodeURIComponent(`${survivorId},${sourceId}`)}&pageSize=100`,
        { token },
      )
      const list = await readJsonSafe<ItemPage>(listResponse)
      expect(listResponse.status()).toBe(200)
      expect((list?.items ?? []).map((item) => item.id)).toEqual([survivorId])

      created.deals = created.deals.filter((id) => id !== sourceId)
    } finally {
      for (const id of created.interactions.reverse()) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      for (const id of created.comments.reverse()) await deleteEntityIfExists(request, token, '/api/customers/comments', id)
      for (const id of created.activities.reverse()) await deleteEntityIfExists(request, token, '/api/customers/activities', id)
      for (const id of created.documents.reverse()) {
        try {
          await apiRequest(request, 'DELETE', `/api/documents/${id}`, { token })
        } catch {
          continue
        }
      }
      for (const id of created.deals.reverse()) await deleteEntityIfExists(request, token, '/api/customers/deals', id)
      for (const id of created.people.reverse()) await deleteEntityIfExists(request, token, '/api/customers/people', id)
      for (const id of created.companies.reverse()) await deleteEntityIfExists(request, token, '/api/customers/companies', id)
      if (definitionCreated) await deleteDealDefinition(request, token, fieldKey)
    }
  })

  test('keeps a stored amount beyond float precision exact through preview and merge', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().slice(0, 8)
    const exactAmount = '12345678901234567.89'
    const dealIds: string[] = []
    try {
      const survivorId = await createDealFixture(request, token, { title: `QA merge exact survivor ${stamp}`, valueCurrency: 'USD' })
      dealIds.push(survivorId)
      const sourceId = await createDealFixture(request, token, { title: `QA merge exact source ${stamp}`, valueAmount: 10, valueCurrency: 'USD' })
      dealIds.push(sourceId)
      const amountUpdate = await apiRequest(request, 'PUT', DEALS_PATH, {
        token,
        data: { id: survivorId, valueAmount: exactAmount },
      })
      expect(amountUpdate.ok(), `exact amount update returned ${amountUpdate.status()}`).toBeTruthy()

      const preview = await loadMergePreview(request, token, survivorId, sourceId)
      expect(preview.left.fields.valueAmount, 'preview must return the stored amount as an exact string').toBe(exactAmount)
      expect(preview.right.fields.valueAmount).toBe('10')

      const merge = await apiRequest(request, 'POST', MERGE_PATH, {
        token,
        data: {
          ...mergeBody(survivorId, sourceId, `QA merge exact ${stamp}`, preview.left.updatedAt),
          sourceUpdatedAt: preview.right.updatedAt,
          values: { ...preview.left.fields, title: `QA merge exact ${stamp}` },
        },
      })
      expect(merge.status(), 'merge keeping the stored amount should succeed').toBe(200)

      const survivorResponse = await apiRequest(request, 'GET', `${DEALS_PATH}/${survivorId}`, { token })
      const survivor = await readJsonSafe<{ deal?: { valueAmount?: unknown } }>(survivorResponse)
      expect(survivorResponse.status()).toBe(200)
      expect(survivor?.deal?.valueAmount, 'survivor must keep every stored digit').toBe(exactAmount)
      dealIds.splice(dealIds.indexOf(sourceId), 1)
    } finally {
      for (const id of dealIds.reverse()) await deleteEntityIfExists(request, token, DEALS_PATH, id)
    }
  })

  test('concurrent interaction writes never leave a reference to the merged-away Deal', async ({ request }) => {
    test.slow()
    test.setTimeout(240_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().slice(0, 8)
    const rounds = 3
    const writersPerKind = 6
    const companyId = await createCompanyFixture(request, token, `QA merge race company ${stamp}`)
    const dealIds = new Set<string>()
    const interactionIds = new Set<string>()
    const interactionPath = '/api/customers/interactions'

    const createInteraction = async (title: string, extra: Record<string, unknown>) =>
      apiRequest(request, 'POST', interactionPath, {
        token,
        data: { entityId: companyId, interactionType: 'task', title, status: 'planned', ...extra },
      })

    const recordCreated = async (response: APIResponse, label: string) => {
      expect([201, 400], `${label}: a write must either land or be refused as not found, got ${response.status()}`)
        .toContain(response.status())
      if (response.status() !== 201) return
      const body = await readJsonSafe<CreatedRecord>(response)
      if (body?.id) interactionIds.add(body.id)
    }

    try {
      for (let round = 0; round < rounds; round += 1) {
        const survivorId = await createDealFixture(request, token, { title: `QA race survivor ${stamp}-${round}`, companyIds: [companyId] })
        const sourceId = await createDealFixture(request, token, { title: `QA race source ${stamp}-${round}`, companyIds: [companyId] })
        dealIds.add(survivorId)
        dealIds.add(sourceId)
        const sourceChip = [{ id: sourceId, type: 'deal', label: `Source ${round}` }]

        const existing: string[] = []
        for (let index = 0; index < writersPerKind; index += 1) {
          const response = await createInteraction(`QA race existing ${stamp}-${round}-${index}`, {})
          expect(response.status()).toBe(201)
          const body = await readJsonSafe<CreatedRecord>(response)
          existing.push(expectId(body?.id, 'existing interaction id'))
          interactionIds.add(body!.id!)
        }

        const preview = await loadMergePreview(request, token, survivorId, sourceId)
        const mergeRequest = apiRequest(request, 'POST', MERGE_PATH, {
          token,
          data: {
            ...mergeBody(survivorId, sourceId, `QA race merged ${stamp}-${round}`, preview.left.updatedAt),
            sourceUpdatedAt: preview.right.updatedAt,
            companyIds: [companyId],
          },
        })
        const writers = Array.from({ length: writersPerKind }, (_, index) => [
          createInteraction(`QA race dealId ${stamp}-${round}-${index}`, { dealId: sourceId })
            .then((response) => recordCreated(response, 'create with dealId')),
          createInteraction(`QA race chip ${stamp}-${round}-${index}`, { linkedEntities: sourceChip })
            .then((response) => recordCreated(response, 'create with a Deal chip')),
          apiRequest(request, 'PUT', interactionPath, {
            token,
            data: index % 2 === 0
              ? { id: existing[index], dealId: sourceId }
              : { id: existing[index], linkedEntities: sourceChip },
          }).then((response) => {
            expect([200, 400], `update targeting the source Deal returned ${response.status()}`).toContain(response.status())
          }),
        ]).flat()
        const [mergeResponse] = await Promise.all([mergeRequest, ...writers])
        expect(mergeResponse.status(), 'the merge must win or serialize with every writer').toBe(200)

        const late = await createInteraction(`QA race late chip ${stamp}-${round}`, { linkedEntities: sourceChip })
        expect(late.status(), 'a write after the merge must be refused as not found').toBe(400)
        const lateUpdate = await apiRequest(request, 'PUT', interactionPath, {
          token,
          data: { id: existing[0], dealId: sourceId },
        })
        expect(lateUpdate.status(), 'an update after the merge must be refused as not found').toBe(400)

        const list = await apiRequest(request, 'GET', `${interactionPath}?entityId=${companyId}&limit=100`, { token })
        expect(list.status()).toBe(200)
        const items = (await readJsonSafe<ItemPage>(list))?.items ?? []
        for (const item of items) {
          expect(item.dealId, `interaction ${String(item.id)} must not keep the merged-away Deal`).not.toBe(sourceId)
          const chips = Array.isArray(item.linkedEntities) ? item.linkedEntities as Array<{ id?: unknown; type?: unknown }> : []
          expect(
            chips.some((entry) => entry.type === 'deal' && entry.id === sourceId),
            `interaction ${String(item.id)} must not keep a chip of the merged-away Deal`,
          ).toBe(false)
        }
        dealIds.delete(sourceId)
      }
    } finally {
      for (const id of interactionIds) await deleteEntityIfExists(request, token, interactionPath, id)
      for (const id of dealIds) await deleteEntityIfExists(request, token, DEALS_PATH, id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('concurrent comment writes either follow the survivor or are refused, never losing the Deal link', async ({ request }) => {
    test.slow()
    test.setTimeout(240_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().slice(0, 8)
    const rounds = 3
    const writersPerKind = 6
    const commentPath = '/api/customers/comments'
    const companyId = await createCompanyFixture(request, token, `QA merge comment race company ${stamp}`)
    const dealIds = new Set<string>()
    const commentIds = new Set<string>()
    let overlappingSuccesses = 0
    let refusals = 0

    const createComment = async (body: string, extra: Record<string, unknown>) =>
      apiRequest(request, 'POST', commentPath, { token, data: { entityId: companyId, body, ...extra } })

    try {
      for (let round = 0; round < rounds; round += 1) {
        const survivorId = await createDealFixture(request, token, { title: `QA comment race survivor ${stamp}-${round}`, companyIds: [companyId] })
        const sourceId = await createDealFixture(request, token, { title: `QA comment race source ${stamp}-${round}`, companyIds: [companyId] })
        dealIds.add(survivorId)
        dealIds.add(sourceId)
        const targetedSource = new Set<string>()

        const existing: string[] = []
        for (let index = 0; index < writersPerKind; index += 1) {
          const response = await createComment(`QA comment race existing ${stamp}-${round}-${index}`, {})
          expect([200, 201]).toContain(response.status())
          const body = await readJsonSafe<CreatedRecord>(response)
          existing.push(expectId(body?.id, 'existing comment id'))
          commentIds.add(body!.id!)
        }

        const preview = await loadMergePreview(request, token, survivorId, sourceId)
        const startMerge = async () => {
          const startedAt = performance.now()
          const response = await apiRequest(request, 'POST', MERGE_PATH, {
            token,
            data: {
              ...mergeBody(survivorId, sourceId, `QA comment race merged ${stamp}-${round}`, preview.left.updatedAt),
              sourceUpdatedAt: preview.right.updatedAt,
              companyIds: [companyId],
            },
          })
          return { response, startedAt, finishedAt: performance.now() }
        }
        const trackWriter = async (write: () => Promise<APIResponse>) => {
          const startedAt = performance.now()
          const response = await write()
          return { response, startedAt, finishedAt: performance.now() }
        }
        const earlyMerge = round % 2 === 0 ? startMerge() : null
        const writers = Array.from({ length: writersPerKind }, (_, index) => [
          trackWriter(() => createComment(`QA comment race create ${stamp}-${round}-${index}`, { dealId: sourceId }))
            .then((result) => ({ ...result, existingId: null })),
          trackWriter(() => apiRequest(request, 'PUT', commentPath, { token, data: { id: existing[index], dealId: sourceId } }))
            .then((result) => ({ ...result, existingId: existing[index] })),
        ]).flat()
        const [merge, results] = await Promise.all([earlyMerge ?? startMerge(), Promise.all(writers)])
        expect(merge.response.status(), 'the merge must win or serialize with every comment writer').toBe(200)

        for (const writer of results) {
          const status = writer.response.status()
          expect(writer.existingId ? [200, 400] : [200, 201, 400], `comment write targeting the source Deal returned ${status}`).toContain(status)
          if (status === 400) {
            refusals += 1
            continue
          }
          const body = writer.existingId ? null : await readJsonSafe<CreatedRecord>(writer.response)
          const id = writer.existingId ?? expectId(body?.id, 'raced comment id')
          commentIds.add(id)
          targetedSource.add(id)
          if (writer.startedAt < merge.finishedAt && merge.startedAt < writer.finishedAt) {
            overlappingSuccesses += 1
          }
        }

        const late = await createComment(`QA comment race late ${stamp}-${round}`, { dealId: sourceId })
        expect(late.status(), 'a comment create after the merge must be refused as not found').toBe(400)
        const lateRelink = await apiRequest(request, 'PUT', commentPath, { token, data: { id: existing[0], dealId: sourceId } })
        expect(lateRelink.status(), 'a comment relink after the merge must be refused as not found').toBe(400)

        const list = await apiRequest(request, 'GET', `${commentPath}?entityId=${companyId}&pageSize=100`, { token })
        expect(list.status()).toBe(200)
        const items = (await readJsonSafe<ItemPage>(list))?.items ?? []
        const dealOf = new Map(items.map((item) => [String(item.id), item.deal_id ?? item.dealId ?? null]))
        for (const [id, dealId] of dealOf) {
          expect(dealId, `comment ${id} must not keep the merged-away Deal`).not.toBe(sourceId)
        }
        for (const id of targetedSource) {
          expect(dealOf.has(id), `comment ${id} that targeted the source Deal must still exist`).toBe(true)
          expect(dealOf.get(id), `comment ${id} that targeted the source Deal must follow the survivor`).toBe(survivorId)
        }
        dealIds.delete(sourceId)
      }
      expect(overlappingSuccesses, `at least one overlapping comment write must succeed and move (${refusals} refused)`).toBeGreaterThan(0)
    } finally {
      for (const id of commentIds) await deleteEntityIfExists(request, token, commentPath, id)
      for (const id of dealIds) await deleteEntityIfExists(request, token, DEALS_PATH, id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('moves an interaction chip whose Deal id uses mixed letter case', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().slice(0, 8)
    const interactionPath = '/api/customers/interactions'
    const companyId = await createCompanyFixture(request, token, `QA merge mixed-case company ${stamp}`)
    const dealIds = new Set<string>()
    let interactionId: string | null = null
    try {
      const survivorId = await createDealFixture(request, token, { title: `QA mixed-case survivor ${stamp}`, companyIds: [companyId] })
      const sourceId = await createDealFixture(request, token, { title: `QA mixed-case source ${stamp}`, companyIds: [companyId] })
      dealIds.add(survivorId)
      dealIds.add(sourceId)
      let letterIndex = 0
      const mixedSourceId = sourceId.replace(/[a-f]/g, (letter) => (letterIndex++ % 2 === 0 ? letter.toUpperCase() : letter))
      expect(/[A-F]/.test(mixedSourceId) && /[a-f]/.test(mixedSourceId), 'fixture Deal id must contain both letter cases').toBe(true)

      const created = await apiRequest(request, 'POST', interactionPath, {
        token,
        data: {
          entityId: companyId,
          interactionType: 'task',
          title: `QA mixed-case chip ${stamp}`,
          status: 'planned',
          linkedEntities: [{ id: mixedSourceId, type: 'deal', label: 'Mixed-case source' }],
        },
      })
      expect(created.status(), 'an interaction with a mixed-case Deal chip should be created').toBe(201)
      interactionId = expectId((await readJsonSafe<CreatedRecord>(created))?.id, 'mixed-case interaction id')

      const preview = await loadMergePreview(request, token, survivorId, sourceId)
      const merge = await apiRequest(request, 'POST', MERGE_PATH, {
        token,
        data: {
          ...mergeBody(survivorId, sourceId, `QA mixed-case merged ${stamp}`, preview.left.updatedAt),
          sourceUpdatedAt: preview.right.updatedAt,
          companyIds: [companyId],
        },
      })
      expect(merge.status(), 'merge with a mixed-case chip should succeed').toBe(200)
      dealIds.delete(sourceId)

      const list = await apiRequest(request, 'GET', `${interactionPath}?entityId=${companyId}&limit=100`, { token })
      expect(list.status()).toBe(200)
      const item = ((await readJsonSafe<ItemPage>(list))?.items ?? []).find((entry) => entry.id === interactionId)
      expect(item, 'the mixed-case interaction should still be listed').toBeTruthy()
      const chips = (Array.isArray(item!.linkedEntities) ? item!.linkedEntities : []) as Array<{ id?: unknown; type?: unknown }>
      const dealChipIds = chips.filter((entry) => entry.type === 'deal').map((entry) => String(entry.id).toLowerCase())
      expect(dealChipIds, 'the mixed-case chip must now point at the survivor').toEqual([survivorId.toLowerCase()])
    } finally {
      if (interactionId) await deleteEntityIfExists(request, token, interactionPath, interactionId)
      for (const id of dealIds) await deleteEntityIfExists(request, token, DEALS_PATH, id)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('a view-only caller can preview only visible records but cannot merge', async ({ request }) => {
    test.setTimeout(120_000)
    const stamp = randomUUID().slice(0, 8)
    const password = `QA-${randomUUID()}!aA1`
    let superadminToken: string | null = null
    let ownerToken: string | null = null
    let homeOrganizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let companyId: string | null = null
    let documentId: string | null = null
    const dealIds: string[] = []
    const interactionIds: string[] = []

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      ownerToken = await getAuthToken(request, 'admin')
      const context = getTokenContext(ownerToken)
      homeOrganizationId = context.organizationId
      const survivorId = await createDealInOrganization(request, superadminToken, homeOrganizationId, `QA merge view-only survivor ${stamp}`)
      dealIds.push(survivorId)
      const sourceId = await createDealInOrganization(request, superadminToken, homeOrganizationId, `QA merge view-only source ${stamp}`)
      dealIds.push(sourceId)

      companyId = await createCompanyFixture(request, ownerToken, `QA merge visibility ${stamp}`)
      for (const visibility of ['shared', 'private']) {
        interactionIds.push(await createRelatedRecord(request, ownerToken, '/api/customers/interactions', {
          entityId: companyId,
          dealId: sourceId,
          interactionType: 'email',
          title: `QA merge preview ${visibility} email ${stamp}`,
          visibility,
        }))
      }
      documentId = await createDocument(request, ownerToken, `QA merge private document ${stamp}`)
      await linkDocumentToDeal(request, ownerToken, documentId, sourceId, `QA merge view-only source ${stamp}`)

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-deal-merge-view-${stamp}`, tenantId: context.tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['customers.deals.view', 'customers.interactions.view', 'documents.view'],
        organizations: [homeOrganizationId],
      })
      const email = `qa-deal-merge-view-${stamp}@example.com`
      userId = await createUserFixture(request, superadminToken, {
        email, password, organizationId: homeOrganizationId, roles: [roleId], name: `QA deal merge view ${stamp}`,
      })
      const viewerToken = await withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, email, password))

      const survivorBefore = await readDealState(request, superadminToken, homeOrganizationId, survivorId)
      const sourceBefore = await readDealState(request, superadminToken, homeOrganizationId, sourceId)

      const ownerPreview = await loadMergePreview(request, ownerToken, survivorId, sourceId)
      expect(ownerPreview.right.counts.interactions).toBe(2)
      expect(ownerPreview.participants).toEqual(expect.arrayContaining([
        expect.objectContaining({ participantId: 'documents.deal-links', sourceCount: 1 }),
      ]))

      const preview = await loadMergePreview(request, viewerToken, survivorId, sourceId)
      expect(preview.right.counts.interactions, 'the non-author can count only the shared email').toBe(1)
      expect(
        preview.participants.map((entry) => entry.participantId),
        'documents.view alone does not grant access to this unshared document or its count',
      ).not.toContain('documents.deal-links')

      const merge = await apiRequest(request, 'POST', MERGE_PATH, {
        token: viewerToken,
        data: {
          ...mergeBody(survivorId, sourceId, `QA merge view-only forbidden ${stamp}`, preview.left.updatedAt),
          sourceUpdatedAt: preview.right.updatedAt,
        },
      })
      expect(merge.status(), 'merging needs customers.deals.manage').toBe(403)

      expect(await readDealState(request, superadminToken, homeOrganizationId, survivorId)).toEqual(survivorBefore)
      expect(await readDealState(request, superadminToken, homeOrganizationId, sourceId)).toEqual(sourceBefore)
    } finally {
      if (ownerToken) {
        for (const id of interactionIds) await deleteEntityIfExists(request, ownerToken, '/api/customers/interactions', id)
        await deleteEntityIfExists(request, ownerToken, '/api/customers/companies', companyId)
        if (documentId) await apiRequest(request, 'DELETE', `/api/documents/${documentId}`, { token: ownerToken }).catch(() => undefined)
      }
      for (const id of dealIds.reverse()) await deleteDealInOrganization(request, superadminToken, homeOrganizationId, id)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('a Deal in another organization or tenant is refused exactly like a missing Deal', async ({ request }) => {
    test.slow()
    test.setTimeout(180_000)
    const stamp = randomUUID().slice(0, 8)
    const password = `QA-${randomUUID()}!aA1`
    let superadminToken: string | null = null
    let homeOrganizationId: string | null = null
    let foreignOrganizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let otherTenantId: string | null = null
    let otherTenantOrganizationId: string | null = null
    let otherTenantRoleId: string | null = null
    let otherTenantUserId: string | null = null
    let otherTenantToken: string | null = null
    let otherTenantDealId: string | null = null
    const homeDealIds: string[] = []
    let foreignDealId: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const context = getTokenContext(superadminToken)
      homeOrganizationId = context.organizationId
      const inScopeId = await createDealInOrganization(request, superadminToken, homeOrganizationId, `QA merge scope home ${stamp}`)
      homeDealIds.push(inScopeId)

      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA deal merge foreign ${stamp}`,
        tenantId: context.tenantId,
      })
      foreignDealId = await createDealInOrganization(request, superadminToken, foreignOrganizationId, `QA merge scope foreign ${stamp}`)

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-deal-merge-scope-${stamp}`, tenantId: context.tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['customers.deals.view', 'customers.deals.manage'],
        organizations: [homeOrganizationId],
      })
      const email = `qa-deal-merge-scope-${stamp}@example.com`
      userId = await createUserFixture(request, superadminToken, {
        email, password, organizationId: homeOrganizationId, roles: [roleId], name: `QA deal merge scope ${stamp}`,
      })
      const userToken = await withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, email, password))

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `qa-deal-merge-tenant-${stamp}` },
      })
      expect(tenantResponse.status(), 'second tenant fixture should be created').toBe(201)
      otherTenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant create should return id')
      otherTenantOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA deal merge other tenant ${stamp}`,
        tenantId: otherTenantId,
      })
      otherTenantRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-deal-merge-other-${stamp}`,
        tenantId: otherTenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: otherTenantRoleId,
        features: ['customers.deals.view', 'customers.deals.manage'],
        organizations: [otherTenantOrganizationId],
      })
      const otherEmail = `qa-deal-merge-other-${stamp}@example.com`
      otherTenantUserId = await createUserFixture(request, superadminToken, {
        email: otherEmail, password, organizationId: otherTenantOrganizationId, roles: [otherTenantRoleId],
        name: `QA deal merge other tenant ${stamp}`,
      })
      otherTenantToken = await withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, otherEmail, password))
      otherTenantDealId = await createDealInOrganization(request, otherTenantToken, otherTenantOrganizationId, `QA merge scope other tenant ${stamp}`)

      const inScopeBefore = await readDealState(request, superadminToken, homeOrganizationId, inScopeId)
      const foreignBefore = await readDealState(request, superadminToken, foreignOrganizationId, foreignDealId)
      const otherTenantBefore = await readDealState(request, otherTenantToken, otherTenantOrganizationId, otherTenantDealId)
      const expectedUpdatedAt = new Date().toISOString()
      const title = `QA merge scope hijack ${stamp}`

      for (const [label, outOfScopeId] of [['other organization', foreignDealId], ['other tenant', otherTenantDealId]] as const) {
        await expectSameResponseAsMissing(request, userToken, `GET ${label} as right`, (dealId) =>
          apiRequest(request, 'GET', `${MERGE_PATH}?${new URLSearchParams({ left: inScopeId, right: dealId })}`, { token: userToken }),
        outOfScopeId)
        await expectSameResponseAsMissing(request, userToken, `GET ${label} as left`, (dealId) =>
          apiRequest(request, 'GET', `${MERGE_PATH}?${new URLSearchParams({ left: dealId, right: inScopeId })}`, { token: userToken }),
        outOfScopeId)
        await expectSameResponseAsMissing(request, userToken, `POST ${label} as source`, (dealId) =>
          apiRequest(request, 'POST', MERGE_PATH, { token: userToken, data: mergeBody(inScopeId, dealId, title, expectedUpdatedAt) }),
        outOfScopeId)
        await expectSameResponseAsMissing(request, userToken, `POST ${label} as survivor`, (dealId) =>
          apiRequest(request, 'POST', MERGE_PATH, { token: userToken, data: mergeBody(dealId, inScopeId, title, expectedUpdatedAt) }),
        outOfScopeId)
      }

      expect(await readDealState(request, superadminToken, homeOrganizationId, inScopeId)).toEqual(inScopeBefore)
      expect(await readDealState(request, superadminToken, foreignOrganizationId, foreignDealId)).toEqual(foreignBefore)
      expect(await readDealState(request, otherTenantToken, otherTenantOrganizationId, otherTenantDealId)).toEqual(otherTenantBefore)
    } finally {
      await deleteDealInOrganization(request, otherTenantToken, otherTenantOrganizationId, otherTenantDealId)
      await deleteDealInOrganization(request, superadminToken, foreignOrganizationId, foreignDealId)
      for (const id of homeDealIds.reverse()) await deleteDealInOrganization(request, superadminToken, homeOrganizationId, id)
      await deleteUserIfExists(request, superadminToken, otherTenantUserId)
      await deleteRoleIfExists(request, superadminToken, otherTenantRoleId)
      await deleteOrganizationIfExists(request, superadminToken, otherTenantOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', otherTenantId)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
    }
  })
})
