import { testRegistry } from '../../process/__tests__/processTestSupport'
import {
  AnalyticsFilterTooNarrowError,
  createAnalyticsCacheState,
  createXrayAnalytics,
  resolveDefaultWindow,
  type AnalyticsOrgSettings,
  type AnalyticsRequestInput,
  type ListCasesRequestInput,
} from '../index'
import { ANALYTICS_ORG, BASE_MS } from './analyticsTestSupport'
import {
  createScriptedAnalyticsDb,
  drillDownPopulation,
  listingOf,
  type ScriptedListingRow,
} from './scriptedAnalyticsDb'

const TENANT = '11111111-0000-4000-8000-000000000001'
const COMPUTED_THROUGH = '2026-01-05T08:00:00.000000Z'
const UNKNOWN_HASH = 'f'.repeat(64)
const population = drillDownPopulation()

function subject(listing: readonly ScriptedListingRow[] = [], options: { actorCensus?: { cases: number; actors: number }; listedActors?: number } = {}) {
  const scripted = createScriptedAnalyticsDb({ events: population.events, listing, computedThrough: COMPUTED_THROUGH, actorCensus: options.actorCensus, listedActors: options.listedActors })
  const settings = new Map<string, AnalyticsOrgSettings>([[ANALYTICS_ORG, { kAnonymity: 5, debounceSeconds: 120, individualsEnabled: false }]])
  const analytics = createXrayAnalytics({
    db: scripted.db,
    loadSettings: async () => settings,
    registry: () => testRegistry(),
    cache: null,
    cacheState: createAnalyticsCacheState(),
    clock: () => BASE_MS,
  })
  return { analytics, scripted }
}

function request(overrides: Partial<AnalyticsRequestInput> = {}): AnalyticsRequestInput {
  return {
    scope: { tenantId: TENANT, organizationIds: [ANALYTICS_ORG] },
    processKey: 'test.deal',
    window: { windowKey: '30d' },
    viewer: { userId: '33333333-0000-4000-8000-000000000001', features: ['insights.xray.view'], canViewIndividuals: false },
    ...overrides,
  }
}

function cases(extra: Partial<ListCasesRequestInput> = {}, overrides: Partial<AnalyticsRequestInput> = {}): ListCasesRequestInput {
  return { ...request(overrides), ...extra }
}

const defaultWindow = resolveDefaultWindow('30d', BASE_MS, 'UTC')

const suppressedPage = {
  processKey: 'test.deal',
  organizationIds: [ANALYTICS_ORG],
  window: { from: defaultWindow.from, to: defaultWindow.to, windowKey: '30d', timeZone: 'UTC' },
  n: 0,
  computedThrough: COMPUTED_THROUGH,
  incomplete: false,
  suppressed: true,
  items: [],
  nextCursor: null,
}

function itemsOf(listing: readonly ScriptedListingRow[]) {
  return listing.map((row) => ({ caseId: row.caseId, organizationId: row.organizationId }))
}

describe('X-Ray case drill-downs follow the cell rule of the map and the variants (facade)', () => {
  it('answers an empty, suppressed page for an activity whose map node is suppressed, without listing anything', async () => {
    const { analytics, scripted } = subject(listingOf(population.cases.priority))
    const map = await analytics.getProcessMap(request())
    expect(map.nodes.map((node) => node.activityKey)).not.toContain('priority:high')
    expect(map.suppressed.minCases).toBeGreaterThan(0)
    expect(await analytics.listCases(cases({ activityKey: 'priority:high' }))).toEqual(suppressedPage)
    expect(scripted.count('case_count')).toBe(0)
    expect(scripted.count('case_page')).toBe(0)
  })

  it('treats a node hidden only by complementary suppression as suppressed', async () => {
    const { analytics, scripted } = subject(listingOf(population.cases.won))
    const map = await analytics.getProcessMap(request())
    expect(map.nodes.map((node) => node.activityKey)).toEqual(expect.arrayContaining(['created', 'status:open', 'status:qualified', 'status:lost']))
    expect(map.nodes.map((node) => node.activityKey)).not.toContain('status:won')
    expect(map.suppressed.complementary).toBeGreaterThan(0)
    expect(population.cases.won).toHaveLength(7)
    expect(await analytics.listCases(cases({ activityKey: 'status:won' }))).toEqual(suppressedPage)
    expect(scripted.count('case_page')).toBe(0)
  })

  it('lists the case ids of a visible node unchanged', async () => {
    const listing = listingOf([...population.cases.qualifiedLost, ...population.cases.lost])
    const { analytics, scripted } = subject(listing)
    expect(await analytics.listCases(cases({ activityKey: 'status:lost' }))).toEqual({
      ...suppressedPage,
      n: listing.length,
      suppressed: false,
      items: itemsOf(listing),
    })
    expect(scripted.count('case_count')).toBe(1)
    expect(scripted.count('case_page')).toBe(1)
  })

  it('answers a suppressed page for a suppressed, complementary-suppressed or unknown variant hash', async () => {
    const { analytics, scripted } = subject(listingOf(population.cases.qualifiedLost))
    const variants = await analytics.getVariants({ ...request(), limit: 100 })
    expect(variants.items.map((item) => item.rawVariantHashes)).toEqual([[population.storedHashes.won]])
    expect(variants.suppressed.complementary).toBeGreaterThan(0)
    for (const variantHash of [population.storedHashes.lost, population.storedHashes.qualifiedLost, UNKNOWN_HASH]) {
      expect(await analytics.listCases(cases({ variantHash }))).toEqual(suppressedPage)
    }
    expect(await analytics.listCases(cases({ variantHashes: [population.storedHashes.qualifiedLost] }))).toEqual(suppressedPage)
    expect(scripted.count('case_page')).toBe(0)
  })

  it('lists the cases of a visible variant unchanged and requires every requested hash to be visible', async () => {
    const listing = listingOf(population.cases.won)
    const { analytics, scripted } = subject(listing)
    const visible = { ...suppressedPage, n: listing.length, suppressed: false, items: itemsOf(listing) }
    expect(await analytics.listCases(cases({ variantHash: population.storedHashes.won }))).toEqual(visible)
    expect(await analytics.listCases(cases({ variantHashes: [population.storedHashes.won] }))).toEqual(visible)
    expect(scripted.count('case_page')).toBe(2)
    expect(await analytics.listCases(cases({ variantHashes: [population.storedHashes.won, population.storedHashes.qualifiedLost] }))).toEqual(suppressedPage)
    expect(await analytics.listCases(cases({ variantHash: population.storedHashes.won, variantHashes: [population.storedHashes.lost] }))).toEqual(suppressedPage)
    expect(scripted.count('case_page')).toBe(2)
  })

  it('requires both cells when an activity and a variant are combined', async () => {
    const listing = listingOf(population.cases.won)
    const { analytics } = subject(listing)
    expect(await analytics.listCases(cases({ activityKey: 'status:qualified', variantHash: population.storedHashes.won })))
      .toEqual({ ...suppressedPage, n: listing.length, suppressed: false, items: itemsOf(listing) })
    expect(await analytics.listCases(cases({ activityKey: 'status:won', variantHash: population.storedHashes.won }))).toEqual(suppressedPage)
    expect(await analytics.listCases(cases({ activityKey: 'status:qualified', variantHash: population.storedHashes.lost }))).toEqual(suppressedPage)
  })

  it('suppresses a drill-down narrower than its visible cell when the listed population fails the k / three-actor rule', async () => {
    const won = listingOf(population.cases.won)
    const fewCases = subject(won.slice(0, 4))
    expect(await fewCases.analytics.listCases(cases({ variantHash: population.storedHashes.won, statuses: ['completed'] }))).toEqual(suppressedPage)
    expect(fewCases.scripted.count('case_page')).toBe(1)
    const twoActors = subject(won, { listedActors: 2 })
    expect(await twoActors.analytics.listCases(cases({ activityKey: 'status:qualified', variantHash: population.storedHashes.won }))).toEqual(suppressedPage)
    const automatedOnly = subject(won, { listedActors: 0 })
    expect(await automatedOnly.analytics.listCases(cases({ variantHash: population.storedHashes.won })))
      .toEqual({ ...suppressedPage, n: won.length, suppressed: false, items: itemsOf(won) })
    const threeActors = subject(won, { listedActors: 3 })
    expect(await threeActors.analytics.listCases(cases({ variantHash: population.storedHashes.won })))
      .toEqual({ ...suppressedPage, n: won.length, suppressed: false, items: itemsOf(won) })
    expect(threeActors.scripted.count('listed_actors')).toBe(1)
  })

  it('leaves listings without a drill-down unchanged and computes no analytics cell for them', async () => {
    const listing = listingOf([...population.cases.won, ...population.cases.qualifiedLost, ...population.cases.lost])
    const { analytics, scripted } = subject(listing)
    expect(await analytics.listCases(cases({ statuses: ['completed'] }))).toEqual({ ...suppressedPage, n: listing.length, suppressed: false, items: itemsOf(listing) })
    expect(scripted.count('case_events')).toBe(0)
    expect(scripted.count('listed_actors')).toBe(0)
  })

  it('answers a drill-down on an explicitly empty organization scope as suppressed without reading', async () => {
    const { analytics, scripted } = subject(listingOf(population.cases.won))
    expect(await analytics.listCases(cases({ activityKey: 'status:lost' }, { scope: { tenantId: TENANT, organizationIds: [] } }))).toEqual({
      ...suppressedPage,
      organizationIds: [],
      computedThrough: null,
    })
    expect(scripted.statements).toEqual([])
  })

  it('still refuses an actor filter that singles out a small group before any drill-down listing', async () => {
    const { analytics, scripted } = subject(listingOf(population.cases.won), { actorCensus: { cases: 2, actors: 1 } })
    const filters = { actorRoleIds: ['99999999-0000-4000-8000-000000000001'] }
    await expect(analytics.listCases(cases({ activityKey: 'status:lost' }, { filters }))).rejects.toBeInstanceOf(AnalyticsFilterTooNarrowError)
    await expect(analytics.listCases(cases({ variantHash: population.storedHashes.won }, { filters }))).rejects.toBeInstanceOf(AnalyticsFilterTooNarrowError)
    expect(scripted.count('case_page')).toBe(0)
  })
})
