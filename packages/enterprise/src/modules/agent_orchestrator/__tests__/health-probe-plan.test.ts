/**
 * The rule that keeps a status screen from being a billing event.
 *
 * Every case here is a spend decision, so they are pinned individually: what a
 * page view may call, what only an operator may call, and how often even the
 * operator may call it.
 */
import {
  FORCE_FLOOR_MS,
  selectProbeTargets,
  type ProbeCandidate,
  type ProbeMode,
} from '../lib/webSearch/healthProbePlan'

const TTL_MS = 600_000

const candidates: ProbeCandidate[] = [
  { id: 'model-native', ready: true, probeCost: 'free' },
  { id: 'browser', ready: true, probeCost: 'heavy' },
  { id: 'firecrawl', ready: true, probeCost: 'billable' },
  { id: 'tavily', ready: false, probeCost: 'billable' },
]

const plan = (
  mode: ProbeMode,
  over: { force?: boolean; ages?: Record<string, number>; adapterId?: string | null } = {},
) =>
  selectProbeTargets({
    candidates,
    ageMsById: new Map(Object.entries(over.ages ?? {})),
    mode,
    force: over.force ?? false,
    ttlMs: TTL_MS,
    adapterId: over.adapterId ?? null,
  })

describe('selectProbeTargets', () => {
  it('calls nothing in readiness mode', () => {
    expect(plan('readiness')).toEqual([])
  })

  it('lets a page view call only what is free', () => {
    // The whole point: the tile can go green on entry without an invoice.
    expect(plan('auto')).toEqual(['model-native'])
  })

  it('never lets a page view reach a heavy or billable adapter, however stale', () => {
    expect(plan('auto', { ages: { browser: 10 * TTL_MS, firecrawl: 10 * TTL_MS } })).toEqual([
      'model-native',
    ])
  })

  it('reuses a fresh costly probe instead of paying again', () => {
    const targets = plan('live', { ages: { browser: 1_000, firecrawl: 1_000 } })
    expect(targets).toEqual(['model-native'])
  })

  it('pays again once the cached probe has expired', () => {
    const targets = plan('live', { ages: { browser: TTL_MS + 1, firecrawl: TTL_MS + 1 } })
    expect(targets).toEqual(['model-native', 'browser', 'firecrawl'])
  })

  it('treats a never-probed costly adapter as expired', () => {
    expect(plan('live')).toEqual(['model-native', 'browser', 'firecrawl'])
  })

  it('lets force shorten the wait but not remove it', () => {
    // Holding the button down must not bill per click.
    expect(plan('live', { force: true, ages: { firecrawl: FORCE_FLOOR_MS - 1, browser: 0 } })).toEqual([
      'model-native',
    ])
    expect(plan('live', { force: true, ages: { firecrawl: FORCE_FLOOR_MS, browser: 0 } })).toEqual([
      'model-native',
      'firecrawl',
    ])
  })

  it('keeps a targeted re-test from billing the other adapters', () => {
    expect(plan('live', { force: true, adapterId: 'firecrawl' })).toEqual(['firecrawl'])
  })

  it('never calls an adapter that is not configured', () => {
    // `tavily` is billable AND unready; readiness already answers for it.
    expect(plan('live')).not.toContain('tavily')
    expect(plan('live', { adapterId: 'tavily' })).toEqual([])
  })
})
