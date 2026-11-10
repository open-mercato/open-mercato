/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  parseQueueState,
  serializeQueueState,
  firstFailureMessage,
  pruneSelectionAfterDispose,
  QUEUE_STATE_DEFAULTS,
} from '../backend/caseload/hooks'

// Spec 4 Phase 5 (state & polish): URL queue-state round-trip, bulk-outcome
// aggregation helpers, and the page/locale wiring invariants (same
// source-invariant style as caseload-undo.test.ts — no page-level RTL harness).

describe('parseQueueState', () => {
  it('returns pure defaults for a missing or empty params object', () => {
    expect(parseQueueState(null)).toEqual(QUEUE_STATE_DEFAULTS)
    expect(parseQueueState(new URLSearchParams())).toEqual(QUEUE_STATE_DEFAULTS)
  })

  it('reads every queue param', () => {
    const params = new URLSearchParams('view=list&segment=approved&q=fraud&sort=agentAsc&page=3&pageSize=50')
    expect(parseQueueState(params)).toEqual({
      view: 'list',
      segment: 'approved',
      q: 'fraud',
      sort: 'agentAsc',
      page: 3,
      pageSize: 50,
    })
  })

  it('falls back to defaults for unknown enums and junk numbers', () => {
    const params = new URLSearchParams('view=grid&segment=nope&sort=zzz&page=-2&pageSize=37')
    expect(parseQueueState(params)).toEqual(QUEUE_STATE_DEFAULTS)
    expect(parseQueueState(new URLSearchParams('page=abc&pageSize=1e3'))).toEqual(QUEUE_STATE_DEFAULTS)
  })
})

describe('serializeQueueState', () => {
  it('serializes an all-default state to the empty string (bare URL)', () => {
    expect(serializeQueueState(QUEUE_STATE_DEFAULTS)).toBe('')
  })

  it('omits default values and keeps a canonical param order', () => {
    const qs = serializeQueueState({ ...QUEUE_STATE_DEFAULTS, view: 'list', page: 2 })
    expect(qs).toBe('view=list&page=2')
  })

  it('round-trips through parse for a fully non-default state', () => {
    const state = { view: 'list', segment: 'all', q: 'inv-42', sort: 'confidenceDesc', page: 4, pageSize: 10 } as const
    expect(parseQueueState(new URLSearchParams(serializeQueueState(state)))).toEqual(state)
  })

  it('drops junk params on a parse→serialize normalization pass', () => {
    const forwarded = new URLSearchParams('segment=rejected&utm_source=mail&drawer=open')
    expect(serializeQueueState(parseQueueState(forwarded))).toBe('segment=rejected')
  })
})

describe('firstFailureMessage', () => {
  it('returns the first human-readable message, skipping conflict (null) entries', () => {
    expect(
      firstFailureMessage([
        { id: 'a', message: null },
        { id: 'b', message: 'boom' },
        { id: 'c', message: 'later' },
      ]),
    ).toBe('boom')
  })

  it('returns null when every failure already surfaced on the conflict bar', () => {
    expect(firstFailureMessage([{ id: 'a', message: null }])).toBeNull()
    expect(firstFailureMessage([])).toBeNull()
  })
})

describe('pruneSelectionAfterDispose', () => {
  it('removes succeeded ids and keeps failed + unrelated selections', () => {
    const prev = new Set(['a', 'b', 'c'])
    const next = pruneSelectionAfterDispose(prev, ['b'])
    expect(Array.from(next).sort()).toEqual(['a', 'c'])
  })

  it('returns the same reference when no succeeded id was selected', () => {
    const prev = new Set(['a'])
    expect(pruneSelectionAfterDispose(prev, ['x', 'y'])).toBe(prev)
    expect(pruneSelectionAfterDispose(prev, [])).toBe(prev)
  })
})

describe('page wiring invariants (spec 4 Phase 5)', () => {
  const moduleRoot = path.join(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const listPage = read('backend/caseload/page.tsx')
  const detailPage = read('backend/caseload/[proposalId]/page.tsx')

  it('list page mirrors queue state into the URL and forwards it on the detail link', () => {
    expect(listPage).toContain('serializeQueueState({ view, segment, q: search, sort: sortKey, page, pageSize })')
    expect(listPage).toMatch(/router\.replace\(queueQuery \? `\/backend\/caseload\?\$\{queueQuery\}` : '\/backend\/caseload'/)
    expect(listPage).toContain('${encodeURIComponent(row.id)}${queueQuery ? `?${queueQuery}` : ')
    expect(listPage).not.toContain("router.push(`/backend/caseload/${encodeURIComponent(row.id)}`)")
  })

  it('detail page rebuilds the queue URL from forwarded params for back and post-dispose', () => {
    expect(detailPage).toContain('serializeQueueState(parseQueueState(searchParams))')
    expect(detailPage).toContain('router.push(caseloadHref)')
    expect(detailPage).toContain('backHref={caseloadHref}')
    expect(detailPage).not.toContain("router.push('/backend/caseload')")
    expect(detailPage).not.toContain('document.referrer')
  })

  it('deep-linked page is not clobbered by the mount-time page reset', () => {
    expect(listPage).toContain('skipPageResetRef')
  })

  it('bulk dispose aggregates into one summary flash and keeps failed ids selected', () => {
    expect(listPage).toContain("'agent_orchestrator.caseload.bulk.summary'")
    expect(listPage).toContain("'agent_orchestrator.caseload.bulk.summaryRejected'")
    expect(listPage).toMatch(/setSelectedIds\(\(prev\) => pruneSelectionAfterDispose\(prev, succeededIds\)\)/)
    // The per-row error flash inside the dispose loop is gone — the catch
    // collects failures (conflicts marked null) for one flashDisposeOutcome.
    expect(listPage).toContain('flashDisposeOutcome')
    expect(listPage).toContain('const conflictSurfaced = surfaceRecordConflict(err, t)')
    expect(listPage).toMatch(/failures\.push\(\{\s*id: row\.id,/)
  })

  it('select-all header renders only when the active tab has selectable rows', () => {
    expect(listPage).toMatch(/selectableIds\.length === 0 \? null :/)
  })

  it('subtitle states the shared queue with the active sort; the gated-copy contradiction is gone', () => {
    expect(listPage).toContain("'agent_orchestrator.caseload.subtitleQueue'")
    expect(listPage).toContain("t('agent_orchestrator.caseload.inbox.needsDecision')")
    expect(listPage).not.toContain('subtitlePersonal')
    expect(listPage).not.toContain('gatedTitle')
  })

  it('ships the Phase-5 keys with interpolation tokens (and drops the replaced keys) in all four locales', () => {
    for (const locale of ['en', 'pl', 'de', 'es']) {
      const catalog = JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>
      for (const key of [
        'agent_orchestrator.caseload.bulk.summary',
        'agent_orchestrator.caseload.bulk.summaryRejected',
      ]) {
        const value = catalog[key]
        expect(value).toBeTruthy()
        expect(value).toContain('{ok}')
        expect(value).toContain('{failed}')
        expect(value).toContain('{error}')
      }
      expect(catalog['agent_orchestrator.caseload.inbox.needsDecision']).toBeTruthy()
      const subtitle = catalog['agent_orchestrator.caseload.subtitleQueue']
      expect(subtitle).toContain('{count}')
      expect(subtitle).toContain('{sort}')
      expect(catalog['agent_orchestrator.caseload.inbox.gatedTitle']).toBeUndefined()
      expect(catalog['agent_orchestrator.caseload.subtitlePersonal']).toBeUndefined()
    }
  })
})
