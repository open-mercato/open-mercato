/** @jest-environment node */

const mockFetchStuckDealIds = jest.fn()

jest.mock('../../../lib/stuckDeals', () => ({
  fetchStuckDealIds: (...args: unknown[]) => mockFetchStuckDealIds(...args),
}))

import { buildDealListFilters, dealListQuerySchema } from '../route'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function createDealFilterContext(rows: Array<{ id: string }>, url = 'https://example.test/api/customers/deals'): {
  ctx: CrudCtx
  execute: jest.Mock
} {
  const execute = jest.fn(async () => rows)
  const em = {
    getConnection: () => ({ execute }),
  }
  const ctx = {
    auth: { tenantId, orgId: organizationId },
    request: new Request(url),
    container: {
      resolve: (key: string) => {
        if (key !== 'em') throw new Error(`Unexpected container key: ${key}`)
        return em
      },
    },
  } as unknown as CrudCtx

  return { ctx, execute }
}

// mergeAdvancedFilterTree returns `{ $and: [routeFilters, treeWhere] }` when the route
// contributed filters and the bare treeWhere otherwise — unwrap deterministically.
function extractTreeWhere(calledFilters: Record<string, unknown>): Record<string, unknown> {
  const andClauses = calledFilters.$and as Array<Record<string, unknown>> | undefined
  return andClauses && Array.isArray(andClauses)
    ? andClauses[andClauses.length - 1]
    : calledFilters
}

describe('customers deals list filters', () => {
  beforeEach(() => {
    mockFetchStuckDealIds.mockReset()
    mockFetchStuckDealIds.mockResolvedValue([])
  })

  it('parses explicit false booleans without applying stuck or overdue filters', async () => {
    const parsed = dealListQuerySchema.parse({
      isStuck: 'false',
      isOverdue: 'false',
      pipelineStageId: '__unassigned',
    })

    expect(parsed.isStuck).toBe(false)
    expect(parsed.isOverdue).toBe(false)

    const filters = await buildDealListFilters(parsed)

    expect(filters.pipeline_stage_id).toEqual({ $eq: null })
    expect(filters.expected_close_at).toBeUndefined()
  })

  it('keeps uuid pipeline stages as regular equality filters', async () => {
    const stageId = '11111111-1111-4111-8111-111111111111'
    const parsed = dealListQuerySchema.parse({ pipelineStageId: stageId })

    const filters = await buildDealListFilters(parsed)

    expect(filters.pipeline_stage_id).toEqual({ $eq: stageId })
  })

  it('applies $in when multiple statuses are provided', async () => {
    const parsed = dealListQuerySchema.parse({ status: ['open', 'won'] })
    const filters = await buildDealListFilters(parsed)
    // 'won' expands to canonical 'win' + alias 'won' so kanban + list agree regardless of spelling
    expect(filters.status).toEqual({ $in: ['open', 'win', 'won'] })
  })

  it('expands won/lost synonyms so kanban Win/Lose filters match list semantics', async () => {
    const wonParsed = dealListQuerySchema.parse({ status: ['won'] })
    const wonFilters = await buildDealListFilters(wonParsed)
    expect(wonFilters.status).toEqual({ $in: ['win', 'won'] })

    const winParsed = dealListQuerySchema.parse({ status: ['win'] })
    const winFilters = await buildDealListFilters(winParsed)
    expect(winFilters.status).toEqual({ $in: ['win', 'won'] })

    const lostParsed = dealListQuerySchema.parse({ status: ['lost'] })
    const lostFilters = await buildDealListFilters(lostParsed)
    expect(lostFilters.status).toEqual({ $in: expect.arrayContaining(['lost', 'loose']) })
    expect(lostFilters.status.$in).toHaveLength(2)
  })

  it('is case-insensitive for won/lost aliases and preserves unknown values', async () => {
    const upperWon = dealListQuerySchema.parse({ status: ['WON'] })
    const upperWonFilters = await buildDealListFilters(upperWon)
    // Strict superset: canonical spellings plus the caller's original token.
    expect(upperWonFilters.status).toEqual({ $in: ['win', 'won', 'WON'] })

    const mixed = dealListQuerySchema.parse({ status: ['wOn', 'LOST'] })
    const mixedFilters = await buildDealListFilters(mixed)
    expect((mixedFilters.status as { $in: string[] }).$in.sort()).toEqual(
      ['wOn', 'LOST', 'win', 'won', 'loose', 'lost'].sort(),
    )

    const unknown = dealListQuerySchema.parse({ status: ['renegotiating'] })
    const unknownFilters = await buildDealListFilters(unknown)
    expect(unknownFilters.status).toEqual({ $eq: 'renegotiating' })
  })

  it('expands the closed filter to the full terminal set', async () => {
    const parsed = dealListQuerySchema.parse({ status: ['closed'] })
    const filters = await buildDealListFilters(parsed)
    expect(filters.status).toEqual({ $in: expect.arrayContaining(['win', 'won', 'loose', 'lost', 'closed']) })
  })

  it('expands status aliases in the advanced-filter tree so list and kanban agree', async () => {
    const { makeRuleTree } = await import('@open-mercato/shared/lib/query/advanced-filter-tree')
    const { serializeTree } = await import('@open-mercato/shared/lib/query/advanced-filter')
    const tree = makeRuleTree({ field: 'status', operator: 'is', value: 'win' })
    const serialized = serializeTree(tree)
    const query = dealListQuerySchema.parse(serialized as Record<string, unknown>)
    const { ctx } = createDealFilterContext([])
    const utils = await import('../../utils')
    const spy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue(['11111111-1111-4111-8111-111111111111'])
    const filters = await buildDealListFilters(query as unknown as DealListQuery, ctx)
    expect(spy).toHaveBeenCalled()
    const calledFilters = (spy.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    // `filters` is non-empty on the ctx path, so mergeAdvancedFilterTree always emits $and.
    const treeWhere = extractTreeWhere(calledFilters)
    expect(treeWhere.status).toEqual({ $in: ['win', 'won'] })
    // Also ensure the final restrictedIds were intersected
    expect(filters.id).toEqual({ $in: ['11111111-1111-4111-8111-111111111111'] })
    spy.mockRestore()
  })

  it('expands is_not status rules to is_none_of with both spellings', async () => {
    const { makeRuleTree } = await import('@open-mercato/shared/lib/query/advanced-filter-tree')
    const { serializeTree } = await import('@open-mercato/shared/lib/query/advanced-filter')
    const tree = makeRuleTree({ field: 'status', operator: 'is_not', value: 'won' })
    const serialized = serializeTree(tree)
    const query = dealListQuerySchema.parse(serialized as Record<string, unknown>)
    const { ctx } = createDealFilterContext([])
    const utils = await import('../../utils')
    const spy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue([])
    await buildDealListFilters(query as unknown as DealListQuery, ctx)
    const calledFilters = (spy.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    const treeWhere = extractTreeWhere(calledFilters)
    expect(treeWhere.status).toEqual({ $nin: expect.arrayContaining(['win', 'won']) })
    spy.mockRestore()
  })

  it('expands is_any_of status rules preserving array semantics', async () => {
    const { makeMultiRuleTree, makeRuleTree } = await import('@open-mercato/shared/lib/query/advanced-filter-tree')
    void makeMultiRuleTree
    const { serializeTree } = await import('@open-mercato/shared/lib/query/advanced-filter')
    const tree = makeRuleTree({ field: 'status', operator: 'is_any_of', value: ['open', 'won'] })
    const serialized = serializeTree(tree)
    const query = dealListQuerySchema.parse(serialized as Record<string, unknown>)
    const { ctx } = createDealFilterContext([])
    const utils = await import('../../utils')
    const spy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue([])
    await buildDealListFilters(query as unknown as DealListQuery, ctx)
    const calledFilters = (spy.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    const treeWhere = extractTreeWhere(calledFilters)
    const inVals = (treeWhere.status as { $in: string[] }).$in
    expect(inVals).toContain('open')
    expect(inVals).toContain('win')
    expect(inVals).toContain('won')
    spy.mockRestore()
  })

  it('expands a closed rule on the tree to the full terminal set', async () => {
    const { makeRuleTree } = await import('@open-mercato/shared/lib/query/advanced-filter-tree')
    const { serializeTree } = await import('@open-mercato/shared/lib/query/advanced-filter')
    const tree = makeRuleTree({ field: 'status', operator: 'is', value: 'closed' })
    const serialized = serializeTree(tree)
    const query = dealListQuerySchema.parse(serialized as Record<string, unknown>)
    const { ctx } = createDealFilterContext([])
    const utils = await import('../../utils')
    const spy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue([])
    await buildDealListFilters(query as unknown as DealListQuery, ctx)
    const calledFilters = (spy.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    const treeWhere = extractTreeWhere(calledFilters)
    const inVals = (treeWhere.status as { $in: string[] }).$in
    for (const terminal of ['win', 'won', 'loose', 'lost', 'closed']) {
      expect(inVals).toContain(terminal)
    }
    spy.mockRestore()
  })

  it('leaves non-set operators like contains on status untouched', async () => {
    const { makeRuleTree } = await import('@open-mercato/shared/lib/query/advanced-filter-tree')
    const { serializeTree } = await import('@open-mercato/shared/lib/query/advanced-filter')
    const tree = makeRuleTree({ field: 'status', operator: 'contains', value: 'win' })
    const serialized = serializeTree(tree)
    const query = dealListQuerySchema.parse(serialized as Record<string, unknown>)
    const { ctx } = createDealFilterContext([])
    const utils = await import('../../utils')
    const spy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue([])
    await buildDealListFilters(query as unknown as DealListQuery, ctx)
    const calledFilters = (spy.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    const treeWhere = extractTreeWhere(calledFilters)
    // Exact scalar $ilike — the corrupted path would compile to '%win,won%', so an
    // exact match is what makes this test fail if the STATUS_TREE_OPERATORS guard
    // is ever dropped.
    expect(treeWhere.status).toEqual({ $ilike: '%win%' })
    spy.mockRestore()
  })

  it('kanban ?status=win and list filter[status][is]=win compile to the same match set', async () => {
    const { makeRuleTree } = await import('@open-mercato/shared/lib/query/advanced-filter-tree')
    const { serializeTree } = await import('@open-mercato/shared/lib/query/advanced-filter')
    const utils = await import('../../utils')

    const kanbanQuery = dealListQuerySchema.parse({ status: 'win' })
    const listTree = makeRuleTree({ field: 'status', operator: 'is', value: 'win' })
    const listQuery = dealListQuerySchema.parse(serializeTree(listTree) as Record<string, unknown>)

    const { ctx: kanbanCtx } = createDealFilterContext([], 'https://example.test/api/customers/deals?status=win')
    const kanbanSpy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue([])
    const kanbanFilters = await buildDealListFilters(kanbanQuery as unknown as DealListQuery, kanbanCtx)

    const { ctx: listCtx } = createDealFilterContext([])
    const listSpy = jest.spyOn(utils, 'findMatchingEntityIdsWithQueryEngine').mockResolvedValue([])
    await buildDealListFilters(listQuery as unknown as DealListQuery, listCtx)

    // Both surfaces resolve the same canonical status set.
    expect((kanbanFilters.status as { $in: string[] }).$in.sort()).toEqual(['win', 'won'])
    const listCalled = (listSpy.mock.calls[0][0] as { filters: Record<string, unknown> }).filters
    const treeWhere = extractTreeWhere(listCalled)
    expect((treeWhere.status as { $in: string[] }).$in).toEqual(
      expect.arrayContaining(['win', 'won']),
    )
    kanbanSpy.mockRestore()
    listSpy.mockRestore()
  })

  it('applies $eq when a single status is provided', async () => {
    const parsed = dealListQuerySchema.parse({ status: ['open'] })
    const filters = await buildDealListFilters(parsed)
    expect(filters.status).toEqual({ $eq: 'open' })
  })

  it('applies $in for multiple pipelineIds', async () => {
    const p1 = '11111111-1111-4111-8111-111111111111'
    const p2 = '22222222-2222-4222-8222-222222222222'
    const parsed = dealListQuerySchema.parse({ pipelineId: [p1, p2] })
    const filters = await buildDealListFilters(parsed)
    expect(filters.pipeline_id).toEqual({ $in: [p1, p2] })
  })

  it('applies $in for multiple ownerUserIds and dedupes by UUID', async () => {
    const o1 = '11111111-1111-4111-8111-111111111111'
    const o2 = '22222222-2222-4222-8222-222222222222'
    const parsed = dealListQuerySchema.parse({ ownerUserId: [o1, o2, o1] })
    const filters = await buildDealListFilters(parsed)
    expect(filters.owner_user_id).toEqual({ $in: [o1, o2] })
  })

  it('applies date range filter when expectedCloseAtFrom/To are provided', async () => {
    const parsed = dealListQuerySchema.parse({
      expectedCloseAtFrom: '2026-01-01',
      expectedCloseAtTo: new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10),
    })
    const filters = await buildDealListFilters(parsed)
    expect(filters.expected_close_at).toMatchObject({
      $gte: expect.any(Date),
      $lte: expect.any(Date),
    })
  })

  it('isOverdue=true narrows to open status with expected_close_at < today', async () => {
    const parsed = dealListQuerySchema.parse({ isOverdue: 'true' })
    const filters = await buildDealListFilters(parsed)
    expect(filters.status).toEqual({ $eq: 'open' })
    expect(filters.expected_close_at).toMatchObject({ $lt: expect.any(Date) })
  })

  it('isOverdue=true preserves caller-supplied status filter (does not overwrite)', async () => {
    const parsed = dealListQuerySchema.parse({ isOverdue: 'true', status: ['open', 'won'] })
    const filters = await buildDealListFilters(parsed)
    // Caller-supplied status wins; we only inject status=open when none was provided.
    // 'won' expands to win+won so the filter covers both spellings stored in the DB.
    expect(filters.status).toEqual({ $in: ['open', 'win', 'won'] })
    expect(filters.expected_close_at).toMatchObject({ $lt: expect.any(Date) })
  })

  it('isStuck without auth context is silently skipped (no throw, no filter)', async () => {
    // The route's isStuck branch only runs when `ctx.auth.{tenantId,orgId}` are both strings.
    // Calling without a ctx exercises the safety guard that the recent commit added —
    // the previous code path used `ctx.auth.organizationId` which is always undefined and
    // silently disabled the branch in production. We verify the no-ctx path is harmless.
    const parsed = dealListQuerySchema.parse({ isStuck: 'true' })
    const filters = await buildDealListFilters(parsed)
    expect(filters.id).toBeUndefined()
  })

  it('needsAttention=true unions overdue open deals with open stuck deals before pagination', async () => {
    const overdueDeal = '66666666-6666-4666-8666-666666666666'
    const openStuckDeal = '77777777-7777-4777-8777-777777777777'
    const closedStuckDeal = '88888888-8888-4888-8888-888888888888'
    const { ctx, execute } = createDealFilterContext([])
    execute
      .mockResolvedValueOnce([{ id: overdueDeal }])
      .mockResolvedValueOnce([{ id: openStuckDeal }])
    mockFetchStuckDealIds.mockResolvedValue([openStuckDeal, closedStuckDeal])

    const parsed = dealListQuerySchema.parse({ needsAttention: 'true' })
    const filters = await buildDealListFilters(parsed, ctx)

    expect(filters.id).toEqual({ $in: [overdueDeal, openStuckDeal] })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[0]?.[0]).toContain('expected_close_at < CURRENT_DATE')
    expect(execute.mock.calls[1]?.[0]).toContain('status IN (?,?)')
    expect(execute.mock.calls[1]?.[1]).toEqual([
      organizationId,
      tenantId,
      'open',
      'in_progress',
      openStuckDeal,
      closedStuckDeal,
    ])
  })

  it('narrows canonical personId/companyId filters before pagination', async () => {
    const personA = '33333333-3333-4333-8333-333333333333'
    const personB = '44444444-4444-4444-8444-444444444444'
    const companyA = '55555555-5555-4555-8555-555555555555'
    const dealA = '66666666-6666-4666-8666-666666666666'
    const dealB = '77777777-7777-4777-8777-777777777777'
    const { ctx, execute } = createDealFilterContext([{ id: dealA }, { id: dealB }])
    const parsed = dealListQuerySchema.parse({
      personId: `${personA},${personB}`,
      companyId: [companyA],
    })

    const filters = await buildDealListFilters(parsed, ctx)

    expect(filters.id).toEqual({ $in: [dealA, dealB] })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toContain('FROM customer_deals')
    expect(execute.mock.calls[0]?.[0]).toContain('customer_deal_people')
    expect(execute.mock.calls[0]?.[0]).toContain('customer_deal_companies')
    expect(execute.mock.calls[0]?.[1]).toEqual([
      organizationId,
      tenantId,
      personA,
      personB,
      companyA,
    ])
  })

  it('keeps legacy personEntityId/companyEntityId aliases as pre-pagination filters', async () => {
    const personA = '33333333-3333-4333-8333-333333333333'
    const personB = '44444444-4444-4444-8444-444444444444'
    const companyA = '55555555-5555-4555-8555-555555555555'
    const dealA = '66666666-6666-4666-8666-666666666666'
    const url =
      `https://example.test/api/customers/deals?personEntityId=${personA}` +
      `&personEntityId=${personB}&companyEntityId=${companyA}`
    const { ctx, execute } = createDealFilterContext([{ id: dealA }], url)
    const parsed = dealListQuerySchema.parse({})

    const filters = await buildDealListFilters(parsed, ctx)

    expect(filters.id).toEqual({ $in: [dealA] })
    expect(execute.mock.calls[0]?.[1]).toEqual([
      organizationId,
      tenantId,
      personA,
      personB,
      companyA,
    ])
  })

  it('collapses person/company association filters to no-match before pagination', async () => {
    const personA = '33333333-3333-4333-8333-333333333333'
    const { ctx } = createDealFilterContext([])
    const parsed = dealListQuerySchema.parse({ personId: personA })

    const filters = await buildDealListFilters(parsed, ctx)

    expect(filters.id).toEqual({ $eq: '00000000-0000-0000-0000-000000000000' })
  })
})
