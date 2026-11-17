import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type RequestScope = {
  token: string
  tenantId?: string
  organizationId?: string
}

type CreatedRecord = {
  path: string
  id: string
  scope: RequestScope
}

type PipelineFixture = {
  pipelineId: string
  stageId: string
  stageLabel: string
}

type DealDetail = {
  deal: {
    id: string
    title: string
    tenantId: string
    organizationId: string
    pipelineId: string | null
    pipelineStageId: string | null
    pipelineStage: string | null
    updatedAt: string
  }
  stageTransitions: Array<{ stageId: string; stageLabel: string; stageOrder: number }>
}

type DictionaryList = {
  items: Array<{ id: string; value: string; organizationId: string }>
}

function scopedRequest(
  request: APIRequestContext,
  scope: RequestScope,
  method: string,
  path: string,
  data?: unknown,
) {
  const cookies = [
    scope.tenantId ? `om_selected_tenant=${scope.tenantId}` : null,
    scope.organizationId ? `om_selected_org=${scope.organizationId}` : null,
  ].filter((value): value is string => value !== null)
  return apiRequest(request, method, path, {
    token: scope.token,
    data,
    headers: { Cookie: cookies.join('; ') },
  })
}

async function createFixture(
  request: APIRequestContext,
  scope: RequestScope,
  path: string,
  data: Record<string, unknown>,
  records: CreatedRecord[],
): Promise<string> {
  const response = await scopedRequest(request, scope, 'POST', path, data)
  const body = await readJsonSafe<{ id?: string }>(response)
  if (typeof body?.id === 'string') records.push({ path, id: body.id, scope })
  expect(response.status(), `POST ${path} should create the test fixture`).toBe(201)
  return expectId(body?.id, `${path} fixture should expose an id`)
}

async function createPipelineFixture(
  request: APIRequestContext,
  scope: RequestScope,
  label: string,
  records: CreatedRecord[],
): Promise<PipelineFixture> {
  const pipelineId = await createFixture(request, scope, '/api/customers/pipelines', { name: label }, records)
  const stageLabel = `${label}-stage`
  const stageId = await createFixture(request, scope, '/api/customers/pipeline-stages', {
    pipelineId,
    label: stageLabel,
  }, records)
  const response = await scopedRequest(request, scope, 'GET', `/api/customers/pipeline-stages?pipelineId=${pipelineId}`)
  const body = await readJsonSafe<{
    items: Array<{ id: string; tenantId: string; organizationId: string }>
  }>(response)
  expect(response.status()).toBe(200)
  expect(body?.items.find((stage) => stage.id === stageId), 'stage fixture should belong to its intended scope').toMatchObject({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  return { pipelineId, stageId, stageLabel }
}

async function readDeal(request: APIRequestContext, scope: RequestScope, dealId: string): Promise<DealDetail> {
  const response = await scopedRequest(request, scope, 'GET', `/api/customers/deals/${dealId}`)
  expect(response.status(), 'deal detail should be available').toBe(200)
  const body = await readJsonSafe<DealDetail>(response)
  expect(body?.deal.id).toBe(dealId)
  return body as DealDetail
}

async function cleanupFixtures(
  request: APIRequestContext,
  records: CreatedRecord[],
  scopes: RequestScope[],
  marker: string,
): Promise<void> {
  const errors: string[] = []
  const remove = async (scope: RequestScope, path: string, id?: string) => {
    try {
      const response = await scopedRequest(request, scope, 'DELETE', path, id ? { id } : undefined)
      if (response.status() !== 200 && response.status() !== 404) errors.push(`${path}: ${response.status()}`)
    } catch {
      errors.push(`${path}: transport failure`)
    }
  }

  for (const path of ['/api/customers/deals', '/api/customers/pipeline-stages', '/api/customers/pipelines']) {
    for (const record of records.filter((record) => record.path === path).reverse()) {
      await remove(record.scope, path, record.id)
    }
  }

  for (const scope of scopes) {
    try {
      const response = await scopedRequest(request, scope, 'GET', '/api/customers/dictionaries/pipeline-stages')
      if (response.status() !== 200) {
        errors.push(`dictionary cleanup lookup: ${response.status()}`)
        continue
      }
      const body = await readJsonSafe<DictionaryList>(response)
      for (const entry of body?.items ?? []) {
        if (entry.organizationId !== scope.organizationId || !entry.value.startsWith(marker)) continue
        await remove(scope, `/api/customers/dictionaries/pipeline-stages/${entry.id}`)
      }
    } catch {
      errors.push('dictionary cleanup lookup: transport failure')
    }
  }

  for (const path of ['/api/directory/organizations', '/api/directory/tenants']) {
    for (const record of records.filter((record) => record.path === path).reverse()) {
      await remove(record.scope, `${path}?id=${record.id}`, record.id)
    }
  }
  expect(errors, 'all test fixtures and copied dictionary entries should be removed').toEqual([])
}

test('TC-CRM-7851: deal and stage writes validate pipeline references in the caller scope', async ({ request }) => {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const actorToken = await getAuthToken(request, 'admin')
  const actorContext = getTokenContext(actorToken)
  expectId(actorContext.tenantId, 'actor should have a tenant')
  expectId(actorContext.organizationId, 'actor should have an organization')
  const actorScope: RequestScope = { token: actorToken, ...actorContext }
  const rootScope: RequestScope = { token: superadminToken }
  const homeScope: RequestScope = { token: superadminToken, ...actorContext }
  const scopes = [homeScope]
  const records: CreatedRecord[] = []
  const marker = `tc7851-${randomUUID()}`

  try {
    const foreignTenantId = await createFixture(request, rootScope, '/api/directory/tenants', {
      name: `${marker}-tenant`,
    }, records)
    const siblingOrganizationId = await createFixture(request, rootScope, '/api/directory/organizations', {
      name: `${marker}-sibling`,
      tenantId: actorContext.tenantId,
    }, records)
    const siblingScope: RequestScope = {
      token: superadminToken,
      tenantId: actorContext.tenantId,
      organizationId: siblingOrganizationId,
    }
    scopes.push(siblingScope)
    const foreignOrganizationId = await createFixture(request, rootScope, '/api/directory/organizations', {
      name: `${marker}-foreign`,
      tenantId: foreignTenantId,
    }, records)
    const foreignScope: RequestScope = {
      token: superadminToken,
      tenantId: foreignTenantId,
      organizationId: foreignOrganizationId,
    }
    scopes.push(foreignScope)
    const local = await createPipelineFixture(request, homeScope, `${marker}-local`, records)
    const sibling = await createPipelineFixture(request, siblingScope, `${marker}-sibling`, records)
    const foreign = await createPipelineFixture(request, foreignScope, `${marker}-foreign`, records)
    const dealId = await createFixture(request, actorScope, '/api/customers/deals', { title: `${marker}-unassigned` }, records)
    const before = await readDeal(request, actorScope, dealId)

    const invalidAssignments = [
      ...[
        { name: 'foreign organization', fixture: sibling },
        { name: 'foreign tenant', fixture: foreign },
      ].flatMap(({ name, fixture }) => [
        { name: `${name} stage only`, input: { pipelineStageId: fixture.stageId }, error: 'Pipeline stage not found' },
        { name: `${name} matching pipeline and stage`, input: { pipelineId: fixture.pipelineId, pipelineStageId: fixture.stageId }, error: 'Pipeline stage not found' },
        { name: `${name} pipeline only`, input: { pipelineId: fixture.pipelineId }, error: 'Pipeline not found' },
      ]),
      { name: 'missing stage', input: { pipelineStageId: randomUUID() }, error: 'Pipeline stage not found' },
      { name: 'missing pipeline', input: { pipelineId: randomUUID() }, error: 'Pipeline not found' },
    ]
    const rejectedTitles: string[] = []
    for (const reference of invalidAssignments) {
      for (const method of ['POST', 'PUT'] as const) {
        const title = `${marker}-${method}-${reference.name}`
        const response = await scopedRequest(request, actorScope, method, '/api/customers/deals', {
          ...(method === 'PUT' ? { id: dealId } : {}),
          title,
          ...reference.input,
        })
        const body = await readJsonSafe<{ id?: string; error?: string }>(response)
        if (method === 'POST' && typeof body?.id === 'string') {
          records.push({ path: '/api/customers/deals', id: body.id, scope: actorScope })
        }
        expect(response.status(), `${method} should reject ${reference.name}`).toBe(400)
        expect(body?.error).toBe(reference.error)
        if (method === 'POST') rejectedTitles.push(title)
      }
    }

    const listed = await scopedRequest(request, actorScope, 'GET', `/api/customers/deals?search=${encodeURIComponent(marker)}&pageSize=100`)
    const listedBody = await readJsonSafe<{ items: Array<{ title: string }> }>(listed)
    expect(listed.status()).toBe(200)
    expect((listedBody?.items ?? []).filter((deal) => rejectedTitles.includes(deal.title))).toEqual([])
    const after = await readDeal(request, actorScope, dealId)
    expect(after.deal, 'rejected updates should leave the deal untouched').toEqual(before.deal)
    expect(after.stageTransitions, 'rejected updates should not record transitions').toEqual(before.stageTransitions)
    const dictionary = await scopedRequest(request, actorScope, 'GET', '/api/customers/dictionaries/pipeline-stages')
    const dictionaryBody = await readJsonSafe<DictionaryList>(dictionary)
    expect(dictionary.status()).toBe(200)
    expect((dictionaryBody?.items ?? []).filter((entry) => [sibling.stageLabel, foreign.stageLabel].includes(entry.value))).toEqual([])

    for (const pipelineId of [sibling.pipelineId, foreign.pipelineId, randomUUID()]) {
      const response = await scopedRequest(request, actorScope, 'POST', '/api/customers/pipeline-stages', {
        pipelineId,
        label: `${marker}-rejected-stage`,
      })
      const body = await readJsonSafe<{ id?: string; error?: string }>(response)
      if (typeof body?.id === 'string') records.push({ path: '/api/customers/pipeline-stages', id: body.id, scope: actorScope })
      expect(response.status(), 'stage creation should reject a foreign or missing parent pipeline').toBe(400)
      expect(body?.error).toBe('Pipeline not found')
    }

    for (const method of ['POST', 'PUT'] as const) {
      const response = await scopedRequest(request, actorScope, method, '/api/customers/deals', {
        ...(method === 'PUT' ? { id: dealId } : {}),
        title: `${marker}-valid-${method}`,
        pipelineStageId: local.stageId,
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      if (method === 'POST' && typeof body?.id === 'string') records.push({ path: '/api/customers/deals', id: body.id, scope: actorScope })
      expect(response.status(), `${method} with a same-scope stage should succeed`).toBe(method === 'POST' ? 201 : 200)
      const affectedId = method === 'POST' ? expectId(body?.id, 'valid create should expose the deal id') : dealId
      const detail = await readDeal(request, actorScope, affectedId)
      expect(detail.deal).toMatchObject({
        tenantId: actorContext.tenantId,
        organizationId: actorContext.organizationId,
        pipelineId: local.pipelineId,
        pipelineStageId: local.stageId,
        pipelineStage: local.stageLabel,
      })
      expect(detail.stageTransitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ stageId: local.stageId, stageLabel: local.stageLabel }),
      ]))
    }
  } finally {
    await cleanupFixtures(request, records, scopes, marker)
  }
})
