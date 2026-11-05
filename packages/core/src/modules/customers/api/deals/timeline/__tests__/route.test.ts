/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const secondOrgId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const userId = '33333333-3333-4333-8333-333333333333'
const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ownerIdle = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const otherPipelineId = '45454545-4545-4545-8545-454545454545'
const stageEarly = '55555555-5555-4555-8555-555555555555'
const stageLate = '56565656-5656-4656-8656-565656565656'
const stageEmpty = '57575757-5757-4757-8757-575757575757'
const companyId = '77777777-7777-4777-8777-777777777777'
const personId = '88888888-8888-4888-8888-888888888888'

const getAuthMock = jest.fn()
const resolveScopeMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const rbacMock = { userHasAllFeatures: jest.fn() }
const queryMock = jest.fn()

const em = { getConnection: jest.fn(() => ({ execute: jest.fn(async () => []) })) }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'queryEngine') return { query: queryMock }
    if (name === 'rbacService') return rbacMock
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthMock(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScopeMock(...args),
}))
jest.mock('../../../utils', () => {
  const actual = jest.requireActual('../../../utils')
  return { ...actual, findMatchingEntityIdsBySearchTokensAcrossSources: jest.fn() }
})

import { GET, TIMELINE_COLUMN_CAP, TIMELINE_RESPONSE_CARD_CAP, mergeFieldCondition } from '../route'
import { findMatchingEntityIdsBySearchTokensAcrossSources } from '../../../utils'
import {
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDictionaryEntry,
  CustomerPipeline,
  CustomerPipelineStage,
} from '../../../../data/entities'
import { addDays, alignToBucketStart, toUtcDateKey } from '../../../../lib/dealsTimeline'
import type { DealTimelineCellResponse, DealTimelineResponse } from '../../../../lib/dealsTimelineTypes'

type FakeDeal = {
  id: string
  title: string
  status: string
  owner_user_id: string | null
  pipeline_id: string | null
  pipeline_stage_id: string | null
  pipeline_stage: string | null
  expected_close_at: string | null
  organization_id: string
  value_amount: string | null
}

const findMatchingMock = findMatchingEntityIdsBySearchTokensAcrossSources as jest.Mock

let deals: FakeDeal[] = []
let dealCounter = 0

function dealId(): string {
  dealCounter += 1
  return `00000000-0000-4000-8000-${String(dealCounter).padStart(12, '0')}`
}

function makeDeal(overrides: Partial<FakeDeal>): FakeDeal {
  return {
    id: dealId(),
    title: 'Deal',
    status: 'open',
    owner_user_id: ownerA,
    pipeline_id: pipelineId,
    pipeline_stage_id: stageEarly,
    pipeline_stage: 'Qualify',
    expected_close_at: null,
    organization_id: organizationId,
    value_amount: '1000.00',
    ...overrides,
  }
}

function asComparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value).getTime()
  return value
}

function matchesCondition(fieldValue: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) {
    return asComparable(fieldValue) === asComparable(condition)
  }
  const value = asComparable(fieldValue)
  return Object.entries(condition as Record<string, unknown>).every(([operator, operand]) => {
    const target = asComparable(operand)
    switch (operator) {
      case '$eq':
        return operand === null ? fieldValue === null : value === target
      case '$ne':
        return operand === null ? fieldValue !== null : value !== target
      case '$in':
        return (operand as unknown[]).includes(fieldValue)
      case '$nin':
        return !(operand as unknown[]).includes(fieldValue)
      case '$gte':
        return fieldValue !== null && (value as number) >= (target as number)
      case '$gt':
        return fieldValue !== null && (value as number) > (target as number)
      case '$lt':
        return fieldValue !== null && (value as number) < (target as number)
      case '$lte':
        return fieldValue !== null && (value as number) <= (target as number)
      default:
        throw new Error(`Unsupported operator ${operator}`)
    }
  })
}

function matchesFilters(deal: FakeDeal, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([field, condition]) => {
    if (field === '$and') return (condition as Array<Record<string, unknown>>).every((entry) => matchesFilters(deal, entry))
    return matchesCondition((deal as unknown as Record<string, unknown>)[field], condition)
  })
}

type QueryArgs = {
  fields: string[]
  sort?: Array<{ field: string; dir: string }>
  page: { page: number; pageSize: number }
  filters: Record<string, unknown>
  organizationIds?: string[]
}

function fakeQuery(_entity: string, args: QueryArgs) {
  let rows = deals.filter((deal) => {
    if (args.organizationIds && !args.organizationIds.includes(deal.organization_id)) return false
    return matchesFilters(deal, args.filters)
  })
  for (const sort of [...(args.sort ?? [])].reverse()) {
    rows = [...rows].sort((left, right) => {
      const leftValue = String((left as unknown as Record<string, unknown>)[sort.field] ?? '')
      const rightValue = String((right as unknown as Record<string, unknown>)[sort.field] ?? '')
      const order = leftValue.localeCompare(rightValue)
      return sort.dir === 'desc' ? -order : order
    })
  }
  const start = (args.page.page - 1) * args.page.pageSize
  return Promise.resolve({ items: rows.slice(start, start + args.page.pageSize), total: rows.length })
}

function readInIds(where: Record<string, unknown>, key: string): string[] {
  const condition = where[key] as { $in?: string[] } | undefined
  return condition?.$in ?? []
}

function fakeFind(_em: unknown, entity: unknown, where: Record<string, unknown>) {
  if (entity === CustomerDeal) {
    const ids = readInIds(where, 'id')
    return Promise.resolve(
      deals
        .filter((deal) => ids.includes(deal.id))
        .map((deal) => ({
          id: deal.id,
          title: `${deal.title} (decrypted)`,
          status: deal.status,
          valueAmount: deal.value_amount,
          valueCurrency: 'EUR',
          probability: 40,
          expectedCloseAt: deal.expected_close_at ? new Date(deal.expected_close_at) : null,
          pipelineId: deal.pipeline_id,
          pipelineStageId: deal.pipeline_stage_id,
          pipelineStage: deal.pipeline_stage,
          ownerUserId: deal.owner_user_id,
          updatedAt: new Date('2026-10-01T10:00:00.000Z'),
        })),
    )
  }
  if (entity === CustomerDealCompanyLink) {
    const ids = readInIds(where, 'deal')
    return Promise.resolve(ids.map((id) => ({ deal: { id }, company: { id: companyId, displayName: 'Veridian Labs' } })))
  }
  if (entity === CustomerDealPersonLink) {
    const ids = readInIds(where, 'deal')
    return Promise.resolve(ids.map((id) => ({ deal: { id }, person: { id: personId, displayName: 'Ingrid Malmberg' } })))
  }
  if (entity === CustomerPipeline) {
    return Promise.resolve([
      { id: pipelineId, name: 'Sales', isDefault: true },
      { id: otherPipelineId, name: 'Partners', isDefault: false },
    ].filter((pipeline) => {
      const ids = readInIds(where, 'id')
      return ids.length === 0 || ids.includes(pipeline.id)
    }))
  }
  if (entity === CustomerPipelineStage) {
    const pipelineIds = readInIds(where, 'pipelineId')
    return Promise.resolve([
      { id: stageLate, pipelineId, label: 'Negotiate', order: 2 },
      { id: stageEarly, pipelineId, label: 'Qualify', order: 1 },
      { id: stageEmpty, pipelineId, label: 'Contract', order: 3 },
    ].filter((stage) => pipelineIds.includes(stage.pipelineId)))
  }
  if (entity === CustomerDictionaryEntry) {
    return Promise.resolve([{ normalizedValue: 'qualify', color: 'success' }])
  }
  return Promise.resolve([])
}

const today = toUtcDateKey(new Date()) as string
const thisWeek = alignToBucketStart(today, 'week')
const lastWeek = addDays(thisWeek, -7)
const nextWeek = addDays(thisWeek, 7)

async function callTimeline(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(new Request(`https://example.test/api/customers/deals/timeline?${query}`))
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function grid(query: string): Promise<DealTimelineResponse> {
  const result = await callTimeline(query)
  expect(result.status).toBe(200)
  return result.body as unknown as DealTimelineResponse
}

describe('customers deals timeline route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    deals = []
    dealCounter = 0
    getAuthMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    resolveScopeMock.mockResolvedValue({ tenantId, filterIds: [organizationId] })
    findWithDecryptionMock.mockImplementation(fakeFind)
    queryMock.mockImplementation(fakeQuery)
    rbacMock.userHasAllFeatures.mockResolvedValue(true)
    findMatchingMock.mockResolvedValue(null)
  })

  it('groups deals into owner lanes and week cells with date-then-id ordering', async () => {
    deals = [
      makeDeal({ expected_close_at: addDays(thisWeek, 2) }),
      makeDeal({ expected_close_at: addDays(thisWeek, 1) }),
      makeDeal({ expected_close_at: addDays(thisWeek, 1) }),
      makeDeal({ expected_close_at: addDays(nextWeek, 0) }),
      makeDeal({ owner_user_id: ownerB, expected_close_at: addDays(lastWeek, 3) }),
    ]
    const body = await grid(`from=${lastWeek}&perCell=2`)
    expect(body.from).toBe(lastWeek)
    expect(body.columns).toHaveLength(5)
    expect(body.columns[1]).toMatchObject({ from: thisWeek, total: 3, truncated: false, isCurrent: true })
    const laneA = body.lanes.find((lane) => lane.key === ownerA)
    expect(laneA?.total).toBe(4)
    expect(laneA?.owner).toEqual({ id: ownerA })
    const busy = laneA?.cells[1]
    expect(busy?.total).toBe(3)
    expect(busy?.items.map((item) => item.id)).toEqual([deals[1].id, deals[2].id])
    expect(busy?.items[0]).toMatchObject({
      title: 'Deal (decrypted)',
      valueAmount: 1000,
      expectedCloseAt: addDays(thisWeek, 1),
      primaryCompany: { id: companyId, label: 'Veridian Labs' },
      primaryPerson: { id: personId, label: 'Ingrid Malmberg' },
      pipelineStage: 'Qualify',
    })
    expect(body.lanes.find((lane) => lane.key === ownerB)?.cells[0].total).toBe(1)
  })

  it('counts a deal on a column boundary exactly once', async () => {
    deals = [makeDeal({ expected_close_at: nextWeek })]
    const body = await grid(`from=${lastWeek}`)
    const totals = body.columns.map((column) => column.total)
    expect(totals).toEqual([0, 0, 1, 0, 0])
  })

  it('adds selected owners without deals and keeps the unassigned lane last', async () => {
    deals = [
      makeDeal({ owner_user_id: null, expected_close_at: thisWeek }),
      makeDeal({ owner_user_id: ownerB, expected_close_at: thisWeek }),
    ]
    const body = await grid(`from=${lastWeek}&ownerUserId=${ownerB}&ownerUserId=${ownerIdle}`)
    expect(body.lanes.map((lane) => lane.key)).toEqual([ownerB, ownerIdle])
    const all = await grid(`from=${lastWeek}`)
    expect(all.lanes.map((lane) => lane.key)).toEqual([ownerB, '__unassigned'])
    expect(all.lanes[1].owner).toBeNull()
  })

  it('builds stage lanes in pipeline order with empty stages and tones when pipelines are visible', async () => {
    deals = [
      makeDeal({ pipeline_stage_id: stageLate, pipeline_stage: 'Negotiate', expected_close_at: thisWeek }),
      makeDeal({ pipeline_stage_id: null, pipeline_stage: null, expected_close_at: thisWeek }),
    ]
    const body = await grid(`from=${lastWeek}&groupBy=stage&pipelineId=${pipelineId}`)
    expect(body.lanes.map((lane) => lane.key)).toEqual([stageEarly, stageLate, stageEmpty, `__nostage:${pipelineId}`])
    expect(body.lanes[0].stage).toMatchObject({ label: 'Qualify', tone: 'success', order: 1, pipelineName: 'Sales' })
    expect(body.lanes[2].total).toBe(0)
    expect(rbacMock.userHasAllFeatures).toHaveBeenCalledWith(userId, ['customers.pipelines.view'], expect.objectContaining({ tenantId }))
  })

  it('derives stage lanes from the window without pipeline metadata when pipelines are hidden', async () => {
    rbacMock.userHasAllFeatures.mockResolvedValue(false)
    deals = [
      makeDeal({ pipeline_stage_id: stageLate, pipeline_stage: 'Negotiate', expected_close_at: thisWeek }),
      makeDeal({ pipeline_stage_id: stageEarly, pipeline_stage: 'Qualify', expected_close_at: thisWeek }),
    ]
    const body = await grid(`from=${lastWeek}&groupBy=stage`)
    expect(body.lanes.map((lane) => lane.key)).toEqual([stageLate, stageEarly])
    expect(body.lanes[0].stage).toEqual({ label: 'Negotiate', pipelineId })
    expect(findWithDecryptionMock.mock.calls.some(([, entity]) => entity === CustomerPipeline)).toBe(false)
  })

  it('excludes closed deals by default including aliases, and honours an explicit status', async () => {
    deals = [
      makeDeal({ status: 'open', expected_close_at: thisWeek }),
      makeDeal({ status: 'won', expected_close_at: thisWeek }),
      makeDeal({ status: 'loose', expected_close_at: thisWeek }),
      makeDeal({ status: 'win', expected_close_at: thisWeek }),
    ]
    expect((await grid(`from=${lastWeek}`)).columns[1].total).toBe(1)
    expect((await grid(`from=${lastWeek}&excludeClosed=false`)).columns[1].total).toBe(4)
    const won = await grid(`from=${lastWeek}&status=win&excludeClosed=true`)
    expect(won.columns[1].total).toBe(2)
  })

  it('keeps builder status and close-date conditions when merging', () => {
    const merged = mergeFieldCondition({ status: { $in: ['open', 'win'] } }, 'status', { $nin: ['win'] })
    expect(merged.status).toEqual({ $in: ['open', 'win'], $nin: ['win'] })
    const collided = mergeFieldCondition({ expected_close_at: { $gte: new Date('2026-01-01') } }, 'expected_close_at', { $gte: new Date('2026-02-01'), $lt: new Date('2026-03-01') })
    expect(collided.expected_close_at).toEqual({ $gte: new Date('2026-01-01') })
    expect(collided.$and).toEqual([{ expected_close_at: { $gte: new Date('2026-02-01'), $lt: new Date('2026-03-01') } }])
  })

  it('flags a capped column as truncated with an exact total and partial lanes', async () => {
    deals = Array.from({ length: TIMELINE_COLUMN_CAP + 5 }, () => makeDeal({ expected_close_at: thisWeek }))
    const body = await grid(`from=${lastWeek}`)
    expect(body.columns[1]).toMatchObject({ total: TIMELINE_COLUMN_CAP + 5, truncated: true })
    expect(body.truncated).toBe(true)
    expect(body.lanes[0].partial).toBe(true)
    expect(body.lanes[0].cells[1]).toMatchObject({ total: TIMELINE_COLUMN_CAP, partial: true })
    expect(body.lanes[0].cells[0].partial).toBe(false)
  })

  it('caps the decrypted cards per response and keeps exact totals on emptied cells', async () => {
    const owners = Array.from({ length: 70 }, (_, index) => `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`)
    deals = owners.flatMap((owner) => [0, 1, 2, 3].map((week) => makeDeal({ owner_user_id: owner, expected_close_at: addDays(lastWeek, week * 7) })))
    const body = await grid(`from=${lastWeek}&perCell=1`)
    const cards = body.lanes.reduce((sum, lane) => sum + lane.cells.reduce((inner, cell) => inner + cell.items.length, 0), 0)
    expect(cards).toBe(TIMELINE_RESPONSE_CARD_CAP)
    expect(body.cardsTruncated).toBe(true)
    const lastLane = body.lanes[body.lanes.length - 1]
    expect(lastLane.cells[0]).toMatchObject({ total: 1, items: [] })
  })

  it('never sorts the light pass on an encrypted field', async () => {
    deals = [makeDeal({ expected_close_at: thisWeek })]
    await grid(`from=${lastWeek}`)
    for (const [, args] of queryMock.mock.calls as Array<[string, QueryArgs]>) {
      for (const sort of args.sort ?? []) expect(['expected_close_at', 'id']).toContain(sort.field)
    }
  })

  it('passes the multi-organization scope through to every query', async () => {
    resolveScopeMock.mockResolvedValue({ tenantId, filterIds: [organizationId, secondOrgId] })
    deals = [
      makeDeal({ expected_close_at: thisWeek }),
      makeDeal({ expected_close_at: thisWeek, organization_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    ]
    const body = await grid(`from=${lastWeek}`)
    expect(body.columns[1].total).toBe(1)
    for (const [, args] of queryMock.mock.calls as Array<[string, QueryArgs]>) {
      expect(args.organizationIds).toEqual([organizationId, secondOrgId])
    }
  })

  it('reports overdue, undated and adjacent side data', async () => {
    const twoWeeksAhead = addDays(nextWeek, 49)
    deals = [
      makeDeal({ expected_close_at: addDays(lastWeek, -10) }),
      makeDeal({ expected_close_at: addDays(lastWeek, -3) }),
      makeDeal({ status: 'win', expected_close_at: addDays(lastWeek, -1) }),
      makeDeal({ expected_close_at: null }),
      makeDeal({ status: 'lost', expected_close_at: null }),
      makeDeal({ expected_close_at: twoWeeksAhead }),
    ]
    const body = await grid(`from=${lastWeek}`)
    expect(body.overdueBefore).toEqual({ count: 2, latestExpectedCloseAt: addDays(lastWeek, -3) })
    expect(body.undatedCount).toBe(1)
    expect(body.adjacent).toEqual({ previous: addDays(lastWeek, -3), next: twoWeeksAhead })
  })

  it('tells first run apart from filtered or closed-only organizations', async () => {
    expect((await grid(`from=${lastWeek}`)).scopeHasDeals).toBe(false)
    deals = [makeDeal({ status: 'win', expected_close_at: thisWeek })]
    expect((await grid(`from=${lastWeek}`)).scopeHasDeals).toBe(true)
    deals = [makeDeal({ expected_close_at: null })]
    expect((await grid(`from=${lastWeek}`)).scopeHasDeals).toBe(true)
    deals = [makeDeal({ owner_user_id: ownerB, expected_close_at: thisWeek })]
    const filtered = await grid(`from=${lastWeek}&ownerUserId=${ownerIdle}`)
    expect(filtered.scopeHasDeals).toBe(true)
    expect(filtered.columns.every((column) => column.total === 0)).toBe(true)
  })

  describe('cell mode', () => {
    it('pages one owner cell with the window bounds', async () => {
      deals = [
        makeDeal({ expected_close_at: addDays(thisWeek, 2) }),
        makeDeal({ expected_close_at: addDays(thisWeek, 1) }),
        makeDeal({ expected_close_at: addDays(thisWeek, 3) }),
        makeDeal({ expected_close_at: nextWeek }),
        makeDeal({ owner_user_id: ownerB, expected_close_at: thisWeek }),
      ]
      const first = (await callTimeline(`from=${lastWeek}&cellLane=${ownerA}&cellColumn=1&pageSize=2`)).body as unknown as DealTimelineCellResponse
      expect(first).toMatchObject({ lane: ownerA, column: 1, total: 3, page: 1, pageSize: 2, totalPages: 2 })
      expect(first.items.map((item) => item.id)).toEqual([deals[1].id, deals[0].id])
      const second = (await callTimeline(`from=${lastWeek}&cellLane=${ownerA}&cellColumn=1&pageSize=2&page=2`)).body as unknown as DealTimelineCellResponse
      expect(second.items.map((item) => item.id)).toEqual([deals[2].id])
    })

    it('supports the unassigned, stage and no-stage lanes', async () => {
      deals = [
        makeDeal({ owner_user_id: null, expected_close_at: thisWeek }),
        makeDeal({ expected_close_at: thisWeek }),
        makeDeal({ pipeline_stage_id: null, expected_close_at: thisWeek }),
        makeDeal({ pipeline_id: otherPipelineId, pipeline_stage_id: null, expected_close_at: thisWeek }),
      ]
      const unassigned = (await callTimeline(`from=${lastWeek}&cellLane=__unassigned&cellColumn=1`)).body as unknown as DealTimelineCellResponse
      expect(unassigned.items.map((item) => item.id)).toEqual([deals[0].id])
      const stage = (await callTimeline(`from=${lastWeek}&groupBy=stage&cellLane=${stageEarly}&cellColumn=1`)).body as unknown as DealTimelineCellResponse
      expect(stage.total).toBe(2)
      const noStage = (await callTimeline(`from=${lastWeek}&groupBy=stage&cellLane=__nostage:${pipelineId}&cellColumn=1`)).body as unknown as DealTimelineCellResponse
      expect(noStage.items.map((item) => item.id)).toEqual([deals[2].id])
    })
  })

  describe('validation', () => {
    it.each([
      'bucket=day',
      'columns=9',
      'from=2026-13-01',
      'perCell=0',
      `cellLane=${ownerA}`,
      'cellColumn=1',
      'cellLane=not-a-uuid&cellColumn=0',
      `cellLane=${ownerA}&cellColumn=8`,
      'pageSize=101&cellLane=__unassigned&cellColumn=0',
    ])('rejects %s with 400', async (query) => {
      expect((await callTimeline(query)).status).toBe(400)
    })

    it('returns 401 without a tenant', async () => {
      getAuthMock.mockResolvedValue(null)
      expect((await callTimeline('')).status).toBe(401)
    })
  })
})
