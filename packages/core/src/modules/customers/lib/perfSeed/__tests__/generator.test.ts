import { buildBatch, buildEntityBundle, isCompanyIndex, planEntity, resolveEntityCount } from '../generator'
import { PERF_V1 } from '../profile'
import type { SqlRow } from '../types'
import { buildTestContext, TEST_ANCHOR } from './fixtures'

const DAY_MS = 24 * 60 * 60 * 1000

describe('perf seed generator determinism', () => {
  it('pins the first records of perf-v1 seed 42', () => {
    const ctx = buildTestContext()
    const company = buildEntityBundle(ctx, 0)
    expect(company.plan).toMatchObject({
      id: '547afff3-f7f6-5807-b520-2ab1c37a61cf',
      kind: 'company',
      bucket: 'medium',
      interactionCount: 6,
      displayName: 'Onyxa Logistics Group',
    })
    expect(company.rows.customer_entities[0]).toMatchObject({
      display_name: 'Onyxa Logistics Group',
      primary_email: 'hello@onyxalogistics-0.example',
      primary_phone: '+48 500 451 696',
      status: 'active',
      next_interaction_name: 'Review contract',
      next_interaction_ref_id: '852a6109-f5f5-55f0-8900-113c2e537416',
    })
    const loner = buildEntityBundle(ctx, 1)
    expect(loner.plan).toMatchObject({ kind: 'person', bucket: 'light', interactionCount: 1, companyIndex: null, displayName: 'Maron Ashkford' })
    expect(loner.rows.customer_entities[0].primary_email).toBe('maron.ashkford.1@perf-mail.example')
    const employee = planEntity(ctx, 2)
    expect(employee).toMatchObject({ kind: 'person', bucket: 'medium', interactionCount: 7, companyIndex: 0, displayName: 'Viniel Hartford' })
  })

  it('produces identical output for identical inputs and different output for another seed', () => {
    const ctx = buildTestContext()
    expect(buildEntityBundle(ctx, 17)).toEqual(buildEntityBundle(ctx, 17))
    expect(buildEntityBundle(buildTestContext({ seed: 7 }), 17).plan.displayName).not.toBe(buildEntityBundle(ctx, 17).plan.displayName)
  })

  it('namespaces record ids by tenant and organization', () => {
    const ctx = buildTestContext()
    const other = { ...ctx, scope: { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: ctx.scope.organizationId } }
    expect(planEntity(other, 5).id).not.toBe(planEntity(ctx, 5).id)
    expect(planEntity(other, 5).displayName).toBe(planEntity(ctx, 5).displayName)
  })

  it('resolves tier volumes with the scale multiplier', () => {
    expect(resolveEntityCount(PERF_V1, 'XS', 1)).toBe(2000)
    expect(resolveEntityCount(PERF_V1, 'S', 1)).toBe(50000)
    expect(resolveEntityCount(PERF_V1, 'L', 0.05)).toBe(50000)
  })
})

describe('perf seed generator integrity', () => {
  const ctx = buildTestContext()
  const batch = buildBatch(ctx, 0, 2000)

  it('keeps every person company reference pointing at an earlier company record', () => {
    for (const plan of batch.plans) {
      for (const companyIndex of [plan.companyIndex, plan.extraCompanyIndex]) {
        if (companyIndex === null) continue
        expect(companyIndex).toBeLessThan(plan.index)
        expect(isCompanyIndex(PERF_V1, companyIndex)).toBe(true)
      }
    }
  })

  it('generates unique primary keys and respects unique constraints', () => {
    const ids = new Set<string>()
    let total = 0
    for (const rows of Object.values(batch.rows)) {
      for (const row of rows) {
        ids.add(String(row.id))
        total += 1
      }
    }
    expect(ids.size).toBe(total)
    const tagPairs = new Set(batch.rows.customer_tag_assignments.map((row) => `${row.tag_id}|${row.entity_id}`))
    expect(tagPairs.size).toBe(batch.rows.customer_tag_assignments.length)
    const stagePairs = new Set(batch.rows.customer_deal_stage_transitions.map((row) => `${row.deal_id}|${row.stage_id}`))
    expect(stagePairs.size).toBe(batch.rows.customer_deal_stage_transitions.length)
  })

  it('keeps next_interaction fields consistent with the earliest planned interaction', () => {
    const interactionsByEntity = new Map<string, SqlRow[]>()
    for (const row of batch.rows.customer_interactions) {
      const list = interactionsByEntity.get(String(row.entity_id)) ?? []
      list.push(row)
      interactionsByEntity.set(String(row.entity_id), list)
    }
    const mismatches: string[] = []
    for (const entity of batch.rows.customer_entities) {
      const planned = (interactionsByEntity.get(String(entity.id)) ?? [])
        .filter((row) => row.status === 'planned' && row.scheduled_at instanceof Date)
        .sort((left, right) => (left.scheduled_at as Date).getTime() - (right.scheduled_at as Date).getTime())
      const first = planned[0]
      const consistent = first
        ? entity.next_interaction_ref_id === first.id
          && (entity.next_interaction_at as Date).getTime() === (first.scheduled_at as Date).getTime()
          && entity.next_interaction_name === first.title
          && entity.next_interaction_icon === first.appearance_icon
        : entity.next_interaction_ref_id === null && entity.next_interaction_at === null
      if (!consistent) mismatches.push(String(entity.id))
    }
    expect(mismatches).toEqual([])
  })

  it('places interaction dates between three years ago and three months ahead of the anchor', () => {
    const anchor = Date.parse(`${TEST_ANCHOR}T00:00:00Z`)
    const outOfRange = batch.rows.customer_interactions.filter((row) => {
      const time = ((row.occurred_at ?? row.scheduled_at) as Date).getTime()
      return time < anchor - PERF_V1.interactionPastDays * DAY_MS || time > anchor + PERF_V1.interactionFutureDays * DAY_MS
    })
    expect(outOfRange).toEqual([])
  })
})

describe('perf seed generator distributions (10k sample)', () => {
  const ctx = buildTestContext({ entityCount: 10000 })
  const batch = buildBatch(ctx, 0, 10000)
  const people = batch.plans.filter((plan) => plan.kind === 'person')
  const share = (count: number, total: number) => count / total

  it('splits people and companies 75/25 with about three people per company', () => {
    expect(batch.rows.customer_companies.length).toBe(2500)
    expect(batch.rows.customer_people.length).toBe(7500)
    const withoutCompany = people.filter((plan) => plan.companyIndex === null).length
    expect(share(withoutCompany, people.length)).toBeCloseTo(PERF_V1.personWithoutCompanyRate, 1)
    const withCompany = people.length - withoutCompany
    const multi = people.filter((plan) => plan.extraCompanyIndex !== null).length
    expect(Math.abs(share(multi, withCompany) - PERF_V1.multiCompanyRate)).toBeLessThan(0.015)
    expect(withCompany / 2500).toBeGreaterThan(2.5)
    expect(withCompany / 2500).toBeLessThan(3.1)
  })

  it('matches the interaction power-law buckets', () => {
    for (const spec of PERF_V1.interactionBuckets) {
      const members = batch.plans.filter((plan) => plan.bucket === spec.bucket)
      const tolerance = spec.weight >= 0.1 ? 0.02 : 0.006
      expect(Math.abs(share(members.length, batch.plans.length) - spec.weight)).toBeLessThan(tolerance)
      for (const plan of members) {
        expect(plan.interactionCount).toBeGreaterThanOrEqual(spec.min)
        expect(plan.interactionCount).toBeLessThanOrEqual(spec.max)
      }
    }
    const perEntity = batch.rows.customer_interactions.length / batch.plans.length
    expect(perEntity).toBeGreaterThan(8)
    expect(perEntity).toBeLessThan(12)
    const done = batch.rows.customer_interactions.filter((row) => row.status === 'done').length
    expect(Math.abs(share(done, batch.rows.customer_interactions.length) - PERF_V1.interactionDoneRate)).toBeLessThan(0.02)
    const types = new Set(batch.rows.customer_interactions.map((row) => row.interaction_type))
    expect(Array.from(types).sort()).toEqual(['call', 'email', 'meeting', 'note', 'task'])
  })

  it('matches deal, transition, comment and stuck shapes', () => {
    const deals = batch.rows.customer_deals
    expect(Math.abs(deals.length / batch.plans.length - 0.5)).toBeLessThan(0.05)
    const transitionsPerDeal = batch.rows.customer_deal_stage_transitions.length / deals.length
    expect(transitionsPerDeal).toBeGreaterThan(2.5)
    expect(transitionsPerDeal).toBeLessThan(3.5)
    const commentsPerDeal = batch.rows.customer_comments.length / deals.length
    expect(Math.abs(commentsPerDeal - 2)).toBeLessThan(0.25)
    const pipelines = new Set(deals.map((row) => row.pipeline_id))
    expect(pipelines.size).toBe(2)
    expect(new Set(deals.map((row) => row.pipeline_stage_id)).size).toBe(12)
    const currencies = new Set(deals.map((row) => row.value_currency))
    expect(currencies.size).toBe(3)
    const anchor = Date.parse(`${TEST_ANCHOR}T00:00:00Z`)
    const lastTransition = new Map<string, number>()
    for (const row of batch.rows.customer_deal_stage_transitions) {
      const at = (row.transitioned_at as Date).getTime()
      lastTransition.set(String(row.deal_id), Math.max(lastTransition.get(String(row.deal_id)) ?? 0, at))
    }
    const openDeals = deals.filter((row) => row.status === 'open')
    const stuck = openDeals.filter((row) => (lastTransition.get(String(row.id)) ?? 0) < anchor - 14 * DAY_MS).length
    expect(Math.abs(share(stuck, openDeals.length) - PERF_V1.stuckRate)).toBeLessThan(0.03)
    for (const row of deals) expect(row.owner_user_id).toEqual(expect.any(String))
  })

  it('matches address, geocoding, tag and custom field shapes', () => {
    const addresses = batch.rows.customer_addresses
    const personAddresses = addresses.length - 2500
    expect(Math.abs(personAddresses / people.length - PERF_V1.personAddressRate)).toBeLessThan(0.03)
    const geocoded = addresses.filter((row) => row.latitude !== null && row.longitude !== null).length
    expect(Math.abs(share(geocoded, addresses.length) - PERF_V1.geocodedRate)).toBeLessThan(0.03)
    const tagsPerEntity = batch.rows.customer_tag_assignments.length / batch.plans.length
    expect(tagsPerEntity).toBeGreaterThan(1)
    expect(tagsPerEntity).toBeLessThan(1.6)
    const personFields = batch.customFields.filter((draft) => draft.entityId === 'customers:customer_person_profile')
    expect(Math.abs(personFields.length / (people.length * 3) - PERF_V1.customFieldFillRate)).toBeLessThan(0.03)
    for (const entity of batch.rows.customer_entities) expect(entity.owner_user_id).toEqual(expect.any(String))
  })
})
