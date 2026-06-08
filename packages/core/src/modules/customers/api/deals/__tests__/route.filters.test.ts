/** @jest-environment node */

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

describe('customers deals list filters', () => {
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
    expect(filters.status).toEqual({ $in: ['open', 'won'] })
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
    expect(filters.status).toEqual({ $in: ['open', 'won'] })
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
