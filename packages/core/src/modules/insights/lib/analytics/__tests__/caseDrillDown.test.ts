import { buildProcessMap } from '../dfg'
import { buildVariants } from '../variants'
import {
  areVariantHashesVisible,
  caseDrillDownOf,
  hasCaseDrillDown,
  isActivityNodeVisible,
} from '../caseDrillDown'
import { XRAY_ANALYTICS_LIMITS } from '../types'
import { ANALYTICS_ORG, BASE_MS, DAY_MS, buildContext, prepareRows, windowOf } from './analyticsTestSupport'
import { drillDownPopulation, storedCaseSummary } from './scriptedAnalyticsDb'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function variantItem(rawVariantHashes: string[], rawVariantHashesTruncated = false) {
  return {
    variantHash: HASH_C,
    rawVariantHashes,
    rawVariantHashesTruncated,
    activityKeys: ['created'],
    cases: 10,
    share: 1,
    cycleTime: { n: 10, medianMs: null, p90Ms: null, lowConfidence: true },
  }
}

function mapNode(activityKey: string) {
  return { activityKey, activityKind: 'stage', raw: 10, collapsed: 10, cases: 10, causes: { human: 10, automated: 0, legacy: 0, other: 0, byKind: { user: 10 } } }
}

describe('X-Ray case drill-down cell rule (pure)', () => {
  it('reads the drill-down of a listing: activity key, deduplicated stored hashes in code-unit order', () => {
    expect(caseDrillDownOf({})).toEqual({ activityKey: null, variantHashes: [] })
    expect(hasCaseDrillDown(caseDrillDownOf({}))).toBe(false)
    expect(caseDrillDownOf({ activityKey: 'status:won' })).toEqual({ activityKey: 'status:won', variantHashes: [] })
    expect(caseDrillDownOf({ variantHash: HASH_B, variantHashes: [HASH_C, HASH_A, HASH_B] })).toEqual({ activityKey: null, variantHashes: [HASH_A, HASH_B, HASH_C] })
    expect(hasCaseDrillDown(caseDrillDownOf({ variantHashes: [HASH_A] }))).toBe(true)
  })

  it('shows an activity only when the map reports its node (suppressed or omitted nodes are absent)', () => {
    const map = { nodes: [mapNode('created'), mapNode('status:open')] }
    expect(isActivityNodeVisible(map, 'status:open')).toBe(true)
    expect(isActivityNodeVisible(map, 'status:won')).toBe(false)
    expect(isActivityNodeVisible({ nodes: [] }, 'created')).toBe(false)
  })

  it('shows stored variant hashes only when every one is listed by a reported variant', () => {
    const variants = { items: [variantItem([HASH_A]), variantItem([HASH_B])] }
    expect(areVariantHashesVisible(variants, [HASH_A])).toBe(true)
    expect(areVariantHashesVisible(variants, [HASH_A, HASH_B])).toBe(true)
    expect(areVariantHashesVisible(variants, [HASH_A, HASH_C])).toBe(false)
    expect(areVariantHashesVisible(variants, [HASH_C])).toBe(false)
    expect(areVariantHashesVisible(variants, [])).toBe(false)
    expect(areVariantHashesVisible({ items: [] }, [HASH_A])).toBe(false)
  })

  it('fails closed for a stored hash cut from a truncated rawVariantHashes list', () => {
    const listed = Array.from({ length: XRAY_ANALYTICS_LIMITS.maxRawVariantHashes }, (_unused, index) => index.toString(16).padStart(64, '0'))
    const variants = { items: [variantItem(listed, true)] }
    expect(areVariantHashesVisible(variants, [listed[0]])).toBe(true)
    expect(areVariantHashesVisible(variants, ['f'.repeat(64)])).toBe(false)
  })

  it('applies the builders\' suppression, complementary suppression included, to the drill-down cells', () => {
    const population = drillDownPopulation()
    const window = windowOf(BASE_MS - 30 * DAY_MS, BASE_MS + DAY_MS)
    const byCase = new Map<string, typeof population.events>()
    for (const row of population.events) byCase.set(row.caseId, [...(byCase.get(row.caseId) ?? []), row])
    const prepared = Array.from(byCase.entries()).map(([caseId, rows]) => {
      const summary = storedCaseSummary(rows)
      const caseRow = summary ? { startedAt: summary.startedAt, endedAt: summary.endedAt, status: summary.status, variantHash: summary.variantHash } : null
      return prepareRows(caseId, rows, window, { organizationId: ANALYTICS_ORG, caseRow })
    })
    const context = buildContext(window, { k: 5 })
    const map = buildProcessMap(prepared, context)
    expect(map.suppressed.complementary).toBeGreaterThan(0)
    expect(isActivityNodeVisible(map, 'priority:high')).toBe(false)
    expect(isActivityNodeVisible(map, 'status:won')).toBe(false)
    for (const visible of ['created', 'status:open', 'status:qualified', 'status:lost']) expect(isActivityNodeVisible(map, visible)).toBe(true)
    const withoutRareStep = buildProcessMap(prepared.map((entry) => ({
      ...entry,
      filteredRaw: entry.filteredRaw.filter((event) => event.activityKey !== 'priority:high'),
      filteredCollapsed: entry.filteredCollapsed.filter((event) => event.activityKey !== 'priority:high'),
    })), context)
    expect(isActivityNodeVisible(withoutRareStep, 'status:won')).toBe(true)
    const variants = buildVariants(prepared, context, XRAY_ANALYTICS_LIMITS.maxVariants)
    expect(variants.suppressed).toEqual(expect.objectContaining({ minCases: 1, complementary: 1 }))
    expect(areVariantHashesVisible(variants, [population.storedHashes.won])).toBe(true)
    expect(areVariantHashesVisible(variants, [population.storedHashes.qualifiedLost])).toBe(false)
    expect(areVariantHashesVisible(variants, [population.storedHashes.lost])).toBe(false)
  })
})
