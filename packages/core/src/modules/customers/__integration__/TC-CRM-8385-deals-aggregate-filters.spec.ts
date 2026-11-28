import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { serializeTree } from '@open-mercato/shared/lib/query/advanced-filter'

type AggregateStage = {
  stageId: string
  count: number
  openCount: number
  byCurrency: Array<{ currency: string; totalExact: string; count: number }>
}

async function getJson<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), path).toBe(200)
  return await readJsonSafe(response) as T
}

function dealIdRule(value: string) {
  return { type: 'rule' as const, id: randomUUID(), field: 'id', operator: 'is' as const, value }
}

const dealsPath = '/api/customers/deals'

test('TC-CRM-8385: deal stages match the list for tree and attention filters', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID()
  const dealIds: string[] = []
  let companyId: string | null = null
  let pipelineId: string | null = null
  let stageId: string | null = null

  try {
    pipelineId = await createPipelineFixture(request, token, { name: `Filter parity pipeline ${stamp}` })
    stageId = await createPipelineStageFixture(request, token, { pipelineId, label: `Filter parity stage ${stamp}` })
    companyId = await createCompanyFixture(request, token, `Filter parity company ${stamp}`)
    const overdue = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString()

    for (const [index, amount] of [10.01, 20.02, 40.04, 80.08].entries()) {
      dealIds.push(await createDealFixture(request, token, {
        title: `Filter parity deal ${index} ${stamp}`,
        pipelineId,
        pipelineStageId: stageId,
        status: 'open',
        valueAmount: amount,
        valueCurrency: 'USD',
        expectedCloseAt: index < 2 ? overdue : future,
        companyIds: index === 0 ? [companyId] : undefined,
      }))
    }

    const [firstOverdue, secondOverdue, current, stuck] = dealIds
    await withClient(async (client) => {
      await client.query("UPDATE customer_deals SET created_at = now() - interval '400 days' WHERE id = $1", [stuck])
      await client.query("UPDATE customer_deal_stage_transitions SET transitioned_at = now() - interval '400 days' WHERE deal_id = $1", [stuck])
    })
    const tree = serializeTree({
      root: {
        type: 'group',
        id: randomUUID(),
        combinator: 'and',
        children: [{
          type: 'group',
          id: randomUUID(),
          combinator: 'or',
          children: [dealIdRule(firstOverdue), dealIdRule(current)],
        }],
      },
    })
    const noMatch = serializeTree({
      root: { type: 'group', id: randomUUID(), combinator: 'and', children: [dealIdRule(randomUUID())] },
    })

    const cases: Array<{ filters: Record<string, string>; ids: string[]; value: string }> = [
      { filters: {}, ids: dealIds, value: '150.15' },
      { filters: tree, ids: [firstOverdue, current], value: '50.05' },
      { filters: { ...tree, companyId }, ids: [firstOverdue], value: '10.01' },
      { filters: { needsAttention: 'true', isStuck: 'true' }, ids: [firstOverdue, secondOverdue, stuck], value: '110.11' },
      { filters: { ...tree, needsAttention: 'true' }, ids: [firstOverdue], value: '10.01' },
      { filters: noMatch, ids: [], value: '0' },
    ]

    for (const { filters, ids, value } of cases) {
      const params = new URLSearchParams({ ...filters, pipelineId })
      const list = await getJson<{ items: Array<{ id: string }> }>(request, token, `${dealsPath}?${params}`)
      expect(list.items.map(({ id }) => id).sort()).toEqual([...ids].sort())

      const aggregate = await getJson<{ perStage: AggregateStage[] }>(request, token, `${dealsPath}/aggregate?${params}`)
      expect(aggregate.perStage).toEqual(ids.length ? [expect.objectContaining({
        stageId,
        count: ids.length,
        openCount: ids.length,
        byCurrency: [expect.objectContaining({ currency: 'USD', totalExact: value, count: ids.length })],
      })] : [])
    }
  } finally {
    for (const id of dealIds) await deleteEntityIfExists(request, token, dealsPath, id)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
  }
})

test('TC-CRM-8385: filtered aggregates respect organization visibility and deal permission', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenScope(adminToken)
  const stamp = randomUUID()
  const email = `deals-filter-${stamp}@example.com`
  const password = `Test-${stamp}!`
  const expectedCloseAt = new Date(Date.now() - 3 * 86_400_000).toISOString()
  let foreignOrganizationId: string | null = null
  let allowedDealId: string | null = null
  let foreignDealId: string | null = null
  let userId: string | null = null

  try {
    foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
      name: `Aggregate filter scope ${stamp}`, tenantId,
    })
    allowedDealId = await createDealFixture(request, adminToken, {
      title: `Visible overdue ${stamp}`, status: 'open', valueAmount: 5, valueCurrency: 'USD', expectedCloseAt,
    })
    const foreign = await apiRequestWithSelectedOrg(request, 'POST', dealsPath, {
      token: superadminToken,
      selectedOrgId: foreignOrganizationId,
      data: { title: `Out-of-scope overdue ${stamp}`, status: 'open', valueAmount: 10, valueCurrency: 'USD', expectedCloseAt },
    })
    expect(foreign.status()).toBe(201)
    foreignDealId = expectId((await readJsonSafe<{ id?: string }>(foreign))?.id, 'Foreign deal ID')
    userId = await createUserFixture(request, superadminToken, { email, password, organizationId, roles: [] })
    const params = new URLSearchParams({
      ...serializeTree({
        root: {
          type: 'group', id: randomUUID(), combinator: 'or', children: [dealIdRule(allowedDealId), dealIdRule(foreignDealId)],
        },
      }),
      needsAttention: 'true',
    })
    const aggregatePath = `${dealsPath}/aggregate?${params}`

    const deniedToken = await getAuthToken(request, email, password)
    const denied = await apiRequest(request, 'GET', aggregatePath, { token: deniedToken })
    expect(denied.status()).toBe(403)

    await setUserAclVisibility(request, superadminToken, {
      userId, organizations: [organizationId], features: ['customers.deals.view'],
    })
    const scopedToken = await getAuthToken(request, email, password)
    const list = await getJson<{ items: Array<{ id: string }> }>(request, scopedToken, `${dealsPath}?${params}`)
    expect(list.items.map(({ id }) => id)).toEqual([allowedDealId])
    const aggregate = await getJson<{ perStage: AggregateStage[] }>(request, scopedToken, aggregatePath)
    expect(aggregate.perStage).toEqual([expect.objectContaining({
      count: 1,
      openCount: 1,
      byCurrency: [expect.objectContaining({ currency: 'USD', totalExact: '5', count: 1 })],
    })])
  } finally {
    await deleteUserIfExists(request, superadminToken, userId)
    await deleteEntityIfExists(request, adminToken, dealsPath, allowedDealId)
    if (foreignDealId && foreignOrganizationId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `${dealsPath}?id=${foreignDealId}`, {
        token: superadminToken, selectedOrgId: foreignOrganizationId,
      })
    }
    await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
  }
})
