/** @jest-environment node */

import { buildDealListFilters, dealListQuerySchema } from '../route'

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
      expectedCloseAtTo: '2026-12-31',
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
})
