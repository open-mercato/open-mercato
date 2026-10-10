import { buildBottlenecks } from '../bottlenecks'
import { buildBreakdown } from '../breakdown'
import { buildProcessMap } from '../dfg'
import { buildDurations, type OpenCensus } from '../durations'
import { buildRework } from '../rework'
import { buildVariants, limitVariants } from '../variants'
import { prepareCase, type AnalyticsEventRow, type PreparedCase } from '../trace'
import { XRAY_MAP_END, XRAY_MAP_START } from '../types'
import {
  ANALYTICS_ORG,
  ANALYTICS_OTHER_ORG,
  BASE_MS,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  actorOf,
  buildContext,
  caseIdOf,
  creation,
  prepareRows,
  stepRow,
  windowOf,
} from './analyticsTestSupport'

const WINDOW = windowOf(BASE_MS - DAY_MS, BASE_MS + 60 * DAY_MS)
const ROLE_SALES = '99999999-0000-4000-8000-000000000001'
const THIRD_ORG = '22222222-0000-4000-8000-000000000003'

function emptyCensus(): OpenCensus {
  return { asOf: new Date(WINDOW.toMs).toISOString(), overall: { n: 0, medianMs: null, p90Ms: null, buckets: {} }, byOrganization: new Map() }
}

function wonCase(index: number, options: { actor?: number; durationDays?: number; startMs?: number; organizationId?: string; sync?: boolean } = {}) {
  const caseId = caseIdOf(index)
  const start = options.startMs ?? BASE_MS + index * HOUR_MS
  const actor = actorOf(options.actor ?? (index % 3) + 1)
  const rows: AnalyticsEventRow[] = [
    ...creation(caseId, start, { actor, cause: options.sync ? 'sync_run' : 'user', sync: options.sync }, options.organizationId),
    stepRow(caseId, { key: 'status:qualified', atMs: start + DAY_MS, actor }, options.organizationId),
    stepRow(caseId, { key: 'status:won', atMs: start + (options.durationDays ?? 2) * DAY_MS, actor }, options.organizationId),
  ]
  return prepareRows(caseId, rows, WINDOW, { organizationId: options.organizationId })
}

describe('X-Ray analytics builders', () => {
  it('builds a directly-follows graph with raw and collapsed counts, cause tags and start/end edges', () => {
    const cases = Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1))
    const correctionCaseId = caseIdOf(50)
    cases.push(prepareRows(correctionCaseId, [
      ...creation(correctionCaseId, BASE_MS, { actor: actorOf(1) }),
      stepRow(correctionCaseId, { key: 'status:lost', atMs: BASE_MS + HOUR_MS, actor: actorOf(1) }),
      stepRow(correctionCaseId, { key: 'status:open', atMs: BASE_MS + HOUR_MS + 30_000, actor: actorOf(1) }),
      stepRow(correctionCaseId, { key: 'status:qualified', atMs: BASE_MS + 2 * DAY_MS, actor: null, cause: 'workflow' }),
    ], WINDOW))
    const map = buildProcessMap(cases, buildContext(WINDOW, { k: 5 }))
    expect(map.n).toBe(7)
    expect(map.lowConfidence).toBe(true)
    expect(map.events).toEqual({ raw: 7 + 8 + 7, collapsed: 7 + 7 + 7, debounced: 0, corrected: 0 })
    expect(map.suppressed).toEqual(expect.objectContaining({ minCases: 3, complementary: 2 }))
    expect(map.nodes.map((candidate) => candidate.activityKey).sort()).toEqual(['created', 'status:open', 'status:qualified'])
    const edge = (from: string, to: string) => map.edges.find((candidate) => candidate.from === from && candidate.to === to)
    expect(edge(XRAY_MAP_START, 'created')).toEqual(expect.objectContaining({ raw: 7, collapsed: 7, cases: 7 }))
    expect(edge('status:open', 'status:qualified')).toEqual(expect.objectContaining({ raw: 7, collapsed: 7 }))
    expect(edge('status:open', 'status:qualified')?.causes).toEqual({ human: 6, automated: 1, legacy: 0, other: 0, byKind: { user: 6, workflow: 1 } })
    expect(edge('status:won', XRAY_MAP_END)).toEqual(expect.objectContaining({ raw: 6, collapsed: 6, cases: 6 }))
    expect(edge('status:open', 'status:lost')).toBeUndefined()
    expect(map.suppressed.cells).toBeGreaterThanOrEqual(2)
    expect(map.casesStarted).toBe(7)
    expect(map.casesEnded).toBe(6)
    const node = map.nodes.find((candidate) => candidate.activityKey === 'status:open')
    expect(node).toEqual(expect.objectContaining({ raw: 8, collapsed: 7, activityKind: 'stage' }))
  })

  it('suppresses cells below k cases or with fewer than three distinct actors', () => {
    const fourCases = Array.from({ length: 4 }, (_unused, index) => wonCase(index + 1))
    const small = buildProcessMap(fourCases, buildContext(WINDOW, { k: 5 }))
    expect(small.n).toBe(4)
    expect(small.nodes).toEqual([])
    expect(small.edges).toEqual([])
    expect(small.suppressed.minCases).toBeGreaterThan(0)
    const twoActors = Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { actor: (index % 2) + 1 }))
    const fewActors = buildProcessMap(twoActors, buildContext(WINDOW, { k: 5 }))
    expect(fewActors.edges).toEqual([])
    expect(fewActors.suppressed.minActors).toBeGreaterThan(0)
    expect(fewActors.suppressed.minCases).toBe(0)
  })

  it('groups completed cases into collapsed variants with guarded cycle times', () => {
    const cases = Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { durationDays: index + 2 }))
    const variants = buildVariants(cases, buildContext(WINDOW, { k: 5 }), 20)
    expect(variants.n).toBe(6)
    expect(variants.items).toHaveLength(1)
    expect(variants.items[0]).toEqual(expect.objectContaining({
      activityKeys: ['created', 'status:open', 'status:qualified', 'status:won'],
      cases: 6,
      share: 1,
    }))
    expect(variants.items[0].cycleTime).toEqual({ n: 6, medianMs: Math.round(4.5 * DAY_MS), p90Ms: null, lowConfidence: true })
    expect(variants.distinctVariants).toEqual({ raw: 1, collapsed: 1 })
    expect(variants.items[0]).toEqual(expect.objectContaining({ rawVariantHashes: [], rawVariantHashesTruncated: false }))
    expect(limitVariants(variants, 1)).toBe(variants)
  })

  it('reports completed cycle times and right-censored open cases separately, excluding sync_run durations by default', () => {
    const cases = [
      ...Array.from({ length: 5 }, (_unused, index) => wonCase(index + 1, { durationDays: 3 })),
      wonCase(20, { durationDays: 30, sync: true }),
    ]
    const census: OpenCensus = {
      asOf: new Date(WINDOW.toMs).toISOString(),
      overall: { n: 7, medianMs: 2 * DAY_MS, p90Ms: 9 * DAY_MS, buckets: { '1d_7d': 7 } },
      byOrganization: new Map([[ANALYTICS_ORG, { n: 7, medianMs: 2 * DAY_MS, p90Ms: 9 * DAY_MS, buckets: { '1d_7d': 7 } }]]),
    }
    const durations = buildDurations(cases, buildContext(WINDOW, { k: 5 }), census)
    expect(durations.n).toBe(6)
    expect(durations.completed?.stats).toEqual({ n: 5, medianMs: 3 * DAY_MS, p90Ms: null, lowConfidence: true })
    expect(durations.completed?.excludedSyncRun).toBe(1)
    expect(durations.open).toEqual(expect.objectContaining({ censored: true, stats: { n: 7, medianMs: 2 * DAY_MS, p90Ms: null, lowConfidence: true } }))
    expect(durations.open?.histogram.find((bucket) => bucket.bucket === '1d_7d')?.count).toBe(7)
    const withSync = buildDurations(cases, buildContext(WINDOW, { k: 5, includeSyncRun: true }), census)
    expect(withSync.completed?.stats.n).toBe(6)
    expect(withSync.completed?.excludedSyncRun).toBe(0)
  })

  it('splits durations per organization and suppresses small organizations (Simpson guard)', () => {
    const cases = [
      ...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { durationDays: 2 })),
      ...Array.from({ length: 2 }, (_unused, index) => wonCase(index + 30, { durationDays: 20, organizationId: ANALYTICS_OTHER_ORG })),
    ]
    const durations = buildDurations(cases, buildContext(WINDOW, { k: 5 }), emptyCensus())
    expect(durations.byOrganization.map((entry) => entry.organizationId)).toEqual([ANALYTICS_ORG, ANALYTICS_OTHER_ORG])
    expect(durations.byOrganization.map((entry) => entry.completed)).toEqual([null, null])
    expect(durations.byOrganization.map((entry) => entry.open?.empty)).toEqual([true, true])
    expect(durations.completed?.stats.n).toBe(8)
  })

  it('separates rework from corrections', () => {
    const corrections = Array.from({ length: 6 }, (_unused, index) => {
      const caseId = caseIdOf(60 + index)
      const actor = actorOf((index % 3) + 1)
      const start = BASE_MS + index * HOUR_MS
      return prepareRows(caseId, [
        ...creation(caseId, start, { actor }),
        stepRow(caseId, { key: 'status:lost', atMs: start + HOUR_MS, actor }),
        stepRow(caseId, { key: 'status:open', atMs: start + HOUR_MS + 30_000, actor }),
      ], WINDOW)
    })
    const reworked = Array.from({ length: 6 }, (_unused, index) => {
      const caseId = caseIdOf(80 + index)
      const actor = actorOf((index % 3) + 1)
      const start = BASE_MS + index * HOUR_MS
      return prepareRows(caseId, [
        ...creation(caseId, start, { actor }),
        stepRow(caseId, { key: 'status:qualified', atMs: start + DAY_MS, actor }),
        stepRow(caseId, { key: 'status:open', atMs: start + 3 * DAY_MS, actor }),
      ], WINDOW)
    })
    const rework = buildRework([...corrections, ...reworked], buildContext(WINDOW, { k: 5 }))
    expect(rework).toEqual(expect.objectContaining({
      n: 12,
      rework: 6,
      reworkRaw: 12,
      corrections: 6,
      debounced: 0,
      casesWithRework: 6,
      casesWithReworkRaw: 12,
      reworkRate: 0.5,
    }))
    expect(rework.byStage).toEqual([
      { activityKey: 'status:open', rework: 6, reworkRaw: 12, corrections: 0, cases: 12 },
      { activityKey: 'status:lost', rework: 0, reworkRaw: 0, corrections: 6, cases: 6 },
    ])
    expect(rework.suppressed.cells).toBe(0)
  })

  it('ranks bottlenecks by guarded median wait and excludes sync_run transitions', () => {
    const cases = Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { durationDays: 5 }))
    const syncCase = caseIdOf(70)
    cases.push(prepareRows(syncCase, [
      ...creation(syncCase, BASE_MS),
      stepRow(syncCase, { key: 'status:qualified', atMs: BASE_MS + 20 * DAY_MS, cause: 'sync_run', sync: true, actor: null }),
    ], WINDOW))
    const bottlenecks = buildBottlenecks(cases, buildContext(WINDOW, { k: 5 }))
    expect(bottlenecks.transitions).toEqual({ raw: 6 * 3 + 2, collapsed: 6 * 3 + 2, measured: 6 * 3 + 1, excludedSyncRun: 1 })
    expect(bottlenecks.items[0]).toEqual(expect.objectContaining({ from: 'status:qualified', to: 'status:won', transitions: 6, rawTransitions: 6, cases: 6 }))
    expect(bottlenecks.items[0].wait.medianMs).toBe(4 * DAY_MS)
    const qualified = bottlenecks.items.find((item) => item.from === 'status:open' && item.to === 'status:qualified')
    expect(qualified).toEqual(expect.objectContaining({ transitions: 7, cases: 7 }))
    expect(qualified?.wait.n).toBe(6)
  })

  it('breaks activity down per organization, role and person with the person view exempt from the actor rule', () => {
    const cases: ReturnType<typeof prepareRows>[] = []
    for (let index = 1; index <= 6; index += 1) {
      const caseId = caseIdOf(100 + index)
      cases.push(prepareRows(caseId, [
        ...creation(caseId, BASE_MS + index * MINUTE_MS * 10, { actor: actorOf(9) }),
        stepRow(caseId, { key: 'status:qualified', atMs: BASE_MS + DAY_MS, actor: actorOf(9), roleIds: [ROLE_SALES] }),
      ], WINDOW))
    }
    const byOrg = buildBreakdown(cases, buildContext(WINDOW, { k: 5 }), 'org')
    expect(byOrg.items).toEqual([])
    expect(byOrg.suppressed.minActors).toBe(1)
    const byPerson = buildBreakdown(cases, buildContext(WINDOW, { k: 5 }), 'user')
    expect(byPerson.perPerson).toBe(true)
    expect(byPerson.items).toEqual([expect.objectContaining({ organizationId: ANALYTICS_ORG, group: actorOf(9), collapsed: 18, cases: 6, actors: 1 })])
    const byRole = buildBreakdown(cases, buildContext(WINDOW, { k: 5 }), 'role')
    expect(byRole.overlapping).toBe(true)
    expect(byRole.items).toEqual([])
  })
})

function lostCase(index: number, actor: number): PreparedCase {
  const caseId = caseIdOf(index)
  const start = BASE_MS + index * HOUR_MS
  return prepareRows(caseId, [
    ...creation(caseId, start, { actor: actorOf(actor) }),
    stepRow(caseId, { key: 'status:lost', atMs: start + DAY_MS, actor: actorOf(actor) }),
  ], WINDOW)
}

function shortCase(index: number, actor: number): PreparedCase {
  const caseId = caseIdOf(index)
  const start = BASE_MS + index * HOUR_MS
  return prepareRows(caseId, [
    ...creation(caseId, start, { actor: actorOf(actor) }),
    stepRow(caseId, { key: 'status:won', atMs: start + 2 * DAY_MS, actor: actorOf(actor) }),
  ], WINDOW)
}

function storedHash(index: number): string {
  return index.toString(16).padStart(64, '0')
}

describe('X-Ray analytics complementary suppression', () => {
  it('suppresses complementary map cells and reports totals over the visible cells only', () => {
    const cases = [...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1)), lostCase(40, 4)]
    const map = buildProcessMap(cases, buildContext(WINDOW, { k: 5 }))
    expect(map.n).toBe(7)
    expect(map.suppressed).toEqual(expect.objectContaining({ cells: 5, minCases: 3, minActors: 0, complementary: 2 }))
    expect(map.nodes.map((node) => node.activityKey).sort()).toEqual(['created', 'status:open', 'status:won'])
    expect(map.edges.find((edge) => edge.from === 'status:open' && edge.to === 'status:qualified')).toBeUndefined()
    expect(map.events).toEqual({ raw: 20, collapsed: 20, debounced: 0, corrected: 0 })
    expect(map.casesStarted).toBe(7)
    expect(map.casesEnded).toBe(6)
  })

  it('draws start and end edges only where the filtered sequence starts and ends with the trace', () => {
    const cases = Array.from({ length: 6 }, (_unused, index) => {
      const caseId = caseIdOf(200 + index)
      const start = BASE_MS + index * HOUR_MS
      return prepareRows(caseId, [
        ...creation(caseId, start, { actor: null, cause: 'workflow' }),
        stepRow(caseId, { key: 'status:qualified', atMs: start + DAY_MS, actor: actorOf((index % 3) + 1) }),
        stepRow(caseId, { key: 'status:won', atMs: start + 2 * DAY_MS, actor: null, cause: 'workflow' }),
      ], WINDOW, { filters: { causeKinds: ['user'] } })
    })
    const filtered = buildProcessMap(cases, buildContext(WINDOW, { k: 5 }))
    expect(filtered.n).toBe(6)
    expect(filtered.edges.filter((edge) => edge.from === XRAY_MAP_START || edge.to === XRAY_MAP_END)).toEqual([])
    expect(filtered.casesStarted).toBe(0)
    expect(filtered.casesEnded).toBe(0)
    const unfiltered = buildProcessMap(cases.map((prepared) => prepareCase(prepared.trace, 120_000, {})), buildContext(WINDOW, { k: 5 }))
    expect(unfiltered.casesStarted).toBe(6)
    expect(unfiltered.casesEnded).toBe(6)
  })

  it('keeps the overall duration cell under the rule of its organizations and suppresses complementary organizations', () => {
    const single = buildDurations(Array.from({ length: 3 }, (_unused, index) => wonCase(index + 1)), buildContext(WINDOW, { k: 5 }), emptyCensus())
    expect(single.completed).toBeNull()
    expect(single.byOrganization).toEqual([expect.objectContaining({ organizationId: ANALYTICS_ORG, completed: null })])
    const pair = buildDurations([
      ...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { durationDays: 2 })),
      ...Array.from({ length: 2 }, (_unused, index) => wonCase(index + 30, { durationDays: 20, organizationId: ANALYTICS_OTHER_ORG })),
    ], buildContext(WINDOW, { k: 5 }), emptyCensus())
    expect(pair.completed?.stats.n).toBe(8)
    expect(pair.byOrganization.map((entry) => entry.completed)).toEqual([null, null])
    expect(pair.suppressed).toEqual(expect.objectContaining({ minCases: 1, complementary: 1 }))
    const triple = buildDurations([
      ...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { durationDays: 2 })),
      ...Array.from({ length: 2 }, (_unused, index) => wonCase(index + 30, { durationDays: 20, organizationId: ANALYTICS_OTHER_ORG })),
      ...Array.from({ length: 4 }, (_unused, index) => wonCase(index + 40, { durationDays: 9, organizationId: THIRD_ORG })),
    ], buildContext(WINDOW, { k: 5 }), emptyCensus())
    expect(triple.byOrganization.map((entry) => [entry.organizationId, entry.completed?.stats.n ?? null])).toEqual([
      [ANALYTICS_ORG, 6],
      [ANALYTICS_OTHER_ORG, null],
      [THIRD_ORG, null],
    ])
    expect(triple.completed?.stats.n).toBe(12)
  })

  it('marks empty duration cells instead of counting them as suppressed', () => {
    const census: OpenCensus = {
      asOf: new Date(WINDOW.toMs).toISOString(),
      overall: { n: 6, medianMs: 3 * DAY_MS, p90Ms: null, buckets: { '1d_7d': 6 } },
      byOrganization: new Map([[ANALYTICS_OTHER_ORG, { n: 6, medianMs: 3 * DAY_MS, p90Ms: null, buckets: { '1d_7d': 6 } }]]),
    }
    const durations = buildDurations(Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1)), buildContext(WINDOW, { k: 5 }), census)
    expect(durations.suppressed.cells).toBe(0)
    const [own, other] = durations.byOrganization
    expect(own.completed).toEqual(expect.objectContaining({ empty: false, stats: expect.objectContaining({ n: 6 }) }))
    expect(own.open).toEqual(expect.objectContaining({ empty: true, stats: expect.objectContaining({ n: 0 }) }))
    expect(other.completed).toEqual(expect.objectContaining({ empty: true }))
    expect(other.open).toEqual(expect.objectContaining({ empty: false, stats: expect.objectContaining({ n: 6, medianMs: 3 * DAY_MS }) }))
    const nothing = buildDurations([], buildContext(WINDOW, { k: 5 }), emptyCensus())
    expect(nothing.completed).toEqual(expect.objectContaining({ empty: true }))
    expect(nothing.open).toEqual(expect.objectContaining({ empty: true }))
    expect(nothing.suppressed.cells).toBe(0)
  })

  it('suppresses complementary variants and counts distinct variants over the visible ones', () => {
    const cases = [...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1)), lostCase(40, 4)]
    const lone = buildVariants(cases, buildContext(WINDOW, { k: 5 }), 20)
    expect(lone.items).toEqual([])
    expect(lone.distinctVariants).toEqual({ raw: 0, collapsed: 0 })
    expect(lone.suppressed).toEqual(expect.objectContaining({ minCases: 1, complementary: 1 }))
    const withShort = buildVariants([...cases, ...Array.from({ length: 5 }, (_unused, index) => shortCase(50 + index, (index % 3) + 1))], buildContext(WINDOW, { k: 5 }), 20)
    expect(withShort.n).toBe(12)
    expect(withShort.items.map((item) => item.cases)).toEqual([6])
    expect(withShort.distinctVariants).toEqual({ raw: 1, collapsed: 1 })
  })

  it('lists the stored variant hashes of a variant and flags when more than twenty were cut', () => {
    const cases = Array.from({ length: 21 }, (_unused, index) => {
      const caseId = caseIdOf(300 + index)
      const start = BASE_MS + index * HOUR_MS
      const actor = actorOf((index % 3) + 1)
      const caseRow = { startedAt: null, endedAt: null, status: null, variantHash: storedHash(index) }
      return prepareRows(caseId, [
        ...creation(caseId, start, { actor }),
        stepRow(caseId, { key: 'status:qualified', atMs: start + DAY_MS, actor }),
        stepRow(caseId, { key: 'status:won', atMs: start + 2 * DAY_MS, actor }),
      ], WINDOW, { caseRow })
    })
    const all = buildVariants(cases, buildContext(WINDOW, { k: 5 }), 20)
    expect(all.items[0]).toEqual(expect.objectContaining({ cases: 21, rawVariantHashesTruncated: true }))
    expect(all.items[0].rawVariantHashes).toEqual(Array.from({ length: 21 }, (_unused, index) => storedHash(index)).sort().slice(0, 20))
    const few = buildVariants(cases.slice(0, 6), buildContext(WINDOW, { k: 5 }), 20)
    expect(few.items[0]).toEqual(expect.objectContaining({ rawVariantHashesTruncated: false }))
    expect(few.items[0].rawVariantHashes).toEqual(Array.from({ length: 6 }, (_unused, index) => storedHash(index)))
  })

  it('reports rework totals over the visible stage cells when a stage is suppressed', () => {
    const reworked = Array.from({ length: 6 }, (_unused, index) => {
      const caseId = caseIdOf(500 + index)
      const start = BASE_MS + index * HOUR_MS
      const actor = actorOf((index % 3) + 1)
      return prepareRows(caseId, [
        ...creation(caseId, start, { actor }),
        stepRow(caseId, { key: 'status:qualified', atMs: start + DAY_MS, actor }),
        stepRow(caseId, { key: 'status:open', atMs: start + 3 * DAY_MS, actor }),
      ], WINDOW)
    })
    const loneId = caseIdOf(520)
    const lone = prepareRows(loneId, [
      ...creation(loneId, BASE_MS, { actor: actorOf(4) }),
      stepRow(loneId, { key: 'status:qualified', atMs: BASE_MS + DAY_MS, actor: actorOf(4) }),
      stepRow(loneId, { key: 'status:proposal', atMs: BASE_MS + 2 * DAY_MS, actor: actorOf(4) }),
      stepRow(loneId, { key: 'status:qualified', atMs: BASE_MS + 4 * DAY_MS, actor: actorOf(4) }),
    ], WINDOW)
    const rework = buildRework([...reworked, lone], buildContext(WINDOW, { k: 5 }))
    expect(rework.n).toBe(7)
    expect(rework.byStage).toEqual([])
    expect(rework).toEqual(expect.objectContaining({ rework: 0, reworkRaw: 0, corrections: 0, casesWithRework: 0, casesWithReworkRaw: 0, reworkRate: 0 }))
    expect(rework.suppressed).toEqual(expect.objectContaining({ minCases: 1, complementary: 1 }))
    const visibleOnly = buildRework(reworked, buildContext(WINDOW, { k: 5 }))
    expect(visibleOnly).toEqual(expect.objectContaining({ rework: 6, reworkRaw: 6, casesWithRework: 6, reworkRate: 1 }))
    expect(visibleOnly.byStage).toEqual([{ activityKey: 'status:open', rework: 6, reworkRaw: 6, corrections: 0, cases: 6 }])
  })

  it('withholds the total wait below five measured waits and keeps transition totals equal to the visible items', () => {
    const cases = Array.from({ length: 6 }, (_unused, index) => {
      const caseId = caseIdOf(600 + index)
      const start = BASE_MS + index * HOUR_MS
      const actor = actorOf((index % 3) + 1)
      const viaSync = index < 2
      return prepareRows(caseId, [
        ...creation(caseId, start, { actor }),
        stepRow(caseId, { key: 'status:qualified', atMs: start + DAY_MS, actor: viaSync ? null : actor, cause: viaSync ? 'sync_run' : 'user', sync: viaSync }),
        stepRow(caseId, { key: 'status:won', atMs: start + 3 * DAY_MS, actor }),
      ], WINDOW)
    })
    const bottlenecks = buildBottlenecks([...cases, lostCase(40, 4)], buildContext(WINDOW, { k: 5 }))
    const item = (from: string, to: string) => bottlenecks.items.find((candidate) => candidate.from === from && candidate.to === to)
    expect(item('status:qualified', 'status:won')).toEqual(expect.objectContaining({ transitions: 6, totalWaitMs: null }))
    expect(item('status:qualified', 'status:won')?.wait.n).toBe(4)
    expect(item('created', 'status:open')?.totalWaitMs).toBe(0)
    expect(item('status:open', 'status:qualified')).toBeUndefined()
    const sum = (pick: (entry: (typeof bottlenecks.items)[number]) => number) => bottlenecks.items.reduce((total, entry) => total + pick(entry), 0)
    expect(bottlenecks.transitions).toEqual({
      raw: sum((entry) => entry.rawTransitions),
      collapsed: sum((entry) => entry.transitions),
      measured: sum((entry) => entry.wait.n),
      excludedSyncRun: 2,
    })
    expect(bottlenecks.suppressed).toEqual(expect.objectContaining({ minCases: 1, complementary: 1 }))
  })

  it('suppresses complementary breakdown cells so no organization is recoverable from the population', () => {
    const cases = [
      ...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1)),
      ...Array.from({ length: 2 }, (_unused, index) => wonCase(index + 30, { organizationId: ANALYTICS_OTHER_ORG })),
    ]
    const byOrg = buildBreakdown(cases, buildContext(WINDOW, { k: 5 }), 'org')
    expect(byOrg.n).toBe(8)
    expect(byOrg.items).toEqual([])
    expect(byOrg.suppressed).toEqual(expect.objectContaining({ minCases: 1, complementary: 1 }))
  })
})
