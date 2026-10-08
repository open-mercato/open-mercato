import { buildBottlenecks } from '../bottlenecks'
import { buildBreakdown } from '../breakdown'
import { buildProcessMap } from '../dfg'
import { buildDurations, type OpenCensus } from '../durations'
import { buildRework } from '../rework'
import { buildVariants, limitVariants } from '../variants'
import type { AnalyticsEventRow } from '../trace'
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
    expect(map.events).toEqual({ raw: 6 * 4 + 5, collapsed: 6 * 4 + 3, debounced: 0, corrected: 2 })
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
    expect(variants.items[0].rawVariantHashes).toHaveLength(1)
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
    expect(durations.completed.stats).toEqual({ n: 5, medianMs: 3 * DAY_MS, p90Ms: null, lowConfidence: true })
    expect(durations.completed.excludedSyncRun).toBe(1)
    expect(durations.open).toEqual(expect.objectContaining({ censored: true, stats: { n: 7, medianMs: 2 * DAY_MS, p90Ms: null, lowConfidence: true } }))
    expect(durations.open.histogram.find((bucket) => bucket.bucket === '1d_7d')?.count).toBe(7)
    const withSync = buildDurations(cases, buildContext(WINDOW, { k: 5, includeSyncRun: true }), census)
    expect(withSync.completed.stats.n).toBe(6)
    expect(withSync.completed.excludedSyncRun).toBe(0)
  })

  it('splits durations per organization and suppresses small organizations (Simpson guard)', () => {
    const cases = [
      ...Array.from({ length: 6 }, (_unused, index) => wonCase(index + 1, { durationDays: 2 })),
      ...Array.from({ length: 2 }, (_unused, index) => wonCase(index + 30, { durationDays: 20, organizationId: ANALYTICS_OTHER_ORG })),
    ]
    const durations = buildDurations(cases, buildContext(WINDOW, { k: 5 }), emptyCensus())
    expect(durations.byOrganization.map((entry) => entry.organizationId)).toEqual([ANALYTICS_ORG, ANALYTICS_OTHER_ORG])
    expect(durations.byOrganization[0].completed?.stats.medianMs).toBe(2 * DAY_MS)
    expect(durations.byOrganization[1].completed).toBeNull()
    expect(durations.byOrganization[1].open).toBeNull()
    expect(durations.completed.stats.n).toBe(8)
  })

  it('separates rework from corrections', () => {
    const correctionCase = caseIdOf(60)
    const reworkCase = caseIdOf(61)
    const cases = [
      prepareRows(correctionCase, [
        ...creation(correctionCase, BASE_MS),
        stepRow(correctionCase, { key: 'status:lost', atMs: BASE_MS + HOUR_MS }),
        stepRow(correctionCase, { key: 'status:open', atMs: BASE_MS + HOUR_MS + 30_000 }),
      ], WINDOW),
      prepareRows(reworkCase, [
        ...creation(reworkCase, BASE_MS),
        stepRow(reworkCase, { key: 'status:qualified', atMs: BASE_MS + DAY_MS }),
        stepRow(reworkCase, { key: 'status:open', atMs: BASE_MS + 3 * DAY_MS, actor: actorOf(2) }),
      ], WINDOW),
    ]
    const rework = buildRework(cases, buildContext(WINDOW, { k: 5 }))
    expect(rework).toEqual(expect.objectContaining({
      n: 2,
      rework: 1,
      reworkRaw: 2,
      corrections: 1,
      debounced: 0,
      casesWithRework: 1,
      casesWithReworkRaw: 2,
      reworkRate: 0.5,
    }))
    expect(rework.byStage).toEqual([])
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
