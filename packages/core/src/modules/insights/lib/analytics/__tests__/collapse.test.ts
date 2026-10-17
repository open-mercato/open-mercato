import { buildCaseTrace, classifyCause, collapseCaseEvents, normalizeCauseKind } from '../trace'
import {
  BASE_MS,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  actorOf,
  caseIdOf,
  creation,
  dealProcess,
  prepareRows,
  stepRow,
  windowOf,
} from './analyticsTestSupport'

const CASE = caseIdOf(1)
const WINDOW = windowOf(BASE_MS - DAY_MS, BASE_MS + 30 * DAY_MS)

function keysOf(events: Array<{ activityKey: string }>): string[] {
  return events.map((event) => event.activityKey)
}

describe('X-Ray query-time collapse (X4)', () => {
  it('keeps only the settled value of a burst of changes by one actor', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:qualified', atMs: BASE_MS + 10 * MINUTE_MS }),
      stepRow(CASE, { key: 'status:proposal', atMs: BASE_MS + 10 * MINUTE_MS + 30_000 }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(keysOf(prepared.collapsed)).toEqual(['created', 'status:open', 'status:proposal'])
    expect(keysOf(prepared.filteredDebounced)).toEqual(['status:qualified'])
    expect(prepared.filteredCorrections).toEqual([])
    expect(keysOf(prepared.filteredRaw)).toHaveLength(4)
  })

  it('drops a correction A→B→A by the same actor inside the window entirely', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:lost', atMs: BASE_MS + HOUR_MS }),
      stepRow(CASE, { key: 'status:open', atMs: BASE_MS + HOUR_MS + 40_000 }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(keysOf(prepared.collapsed)).toEqual(['created', 'status:open'])
    expect(prepared.filteredCorrections).toHaveLength(1)
    expect(prepared.filteredCorrections[0]).toEqual(expect.objectContaining({ field: 'status', activityKey: 'status:lost', inWindow: true }))
    expect(prepared.filteredDebounced).toEqual([])
  })

  it('never merges changes of different actors, cause kinds, automated steps or initial values', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:qualified', atMs: BASE_MS + 20_000 }),
      stepRow(CASE, { key: 'status:proposal', atMs: BASE_MS + 40_000, actor: actorOf(2) }),
      stepRow(CASE, { key: 'status:won', atMs: BASE_MS + 50_000, actor: actorOf(2), cause: 'legacy' }),
      stepRow(CASE, { key: 'status:lost', atMs: BASE_MS + 2 * HOUR_MS, actor: null, cause: 'workflow' }),
      stepRow(CASE, { key: 'status:open', atMs: BASE_MS + 2 * HOUR_MS + 5000, actor: null, cause: 'workflow' }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(prepared.collapsed).toHaveLength(rows.length)
  })

  it('anchors the debounce window at the first change of a burst', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:a', atMs: BASE_MS + HOUR_MS }),
      stepRow(CASE, { key: 'status:b', atMs: BASE_MS + HOUR_MS + 100_000 }),
      stepRow(CASE, { key: 'status:c', atMs: BASE_MS + HOUR_MS + 200_000 }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(keysOf(prepared.collapsed)).toEqual(['created', 'status:open', 'status:b', 'status:c'])
  })

  it('collapses each field separately and is disabled by a zero debounce', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:qualified', atMs: BASE_MS + HOUR_MS }),
      stepRow(CASE, { key: 'priority:changed', kind: 'followup', field: 'priority', value: 'high', atMs: BASE_MS + HOUR_MS + 10_000 }),
      stepRow(CASE, { key: 'status:open', atMs: BASE_MS + HOUR_MS + 20_000 }),
    ]
    const collapsed = prepareRows(CASE, rows, WINDOW)
    expect(keysOf(collapsed.collapsed)).toEqual(['created', 'status:open', 'priority:changed'])
    const disabled = prepareRows(CASE, rows, WINDOW, { debounceMs: 0 })
    expect(disabled.collapsed).toHaveLength(rows.length)
    expect(collapseCaseEvents(disabled.trace.events, -1).kept).toHaveLength(rows.length)
  })

  it('treats a longer loop back to the starting value as one correction', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:qualified', atMs: BASE_MS + HOUR_MS }),
      stepRow(CASE, { key: 'status:proposal', atMs: BASE_MS + HOUR_MS + 20_000 }),
      stepRow(CASE, { key: 'status:open', atMs: BASE_MS + HOUR_MS + 40_000 }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(keysOf(prepared.collapsed)).toEqual(['created', 'status:open'])
    expect(prepared.filteredCorrections).toHaveLength(1)
    expect(prepared.filteredCorrections[0].events).toHaveLength(3)
  })

  it('lets a change by someone else interrupt a burst', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:qualified', atMs: BASE_MS + HOUR_MS }),
      stepRow(CASE, { key: 'status:proposal', atMs: BASE_MS + HOUR_MS + 10_000, actor: null, cause: 'workflow' }),
      stepRow(CASE, { key: 'status:open', atMs: BASE_MS + HOUR_MS + 20_000 }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(prepared.collapsed).toHaveLength(rows.length)
    expect(prepared.filteredCorrections).toEqual([])
  })

  it('debounces follow-up reassignments and counts only removed events inside the window', () => {
    const rows = [
      ...creation(CASE, BASE_MS - DAY_MS - 30_000),
      stepRow(CASE, { key: 'ownerUserId:changed', kind: 'followup', field: 'ownerUserId', value: 'tk1:owner-a', atMs: BASE_MS - DAY_MS - 10_000 }),
      stepRow(CASE, { key: 'ownerUserId:changed', kind: 'followup', field: 'ownerUserId', value: 'tk1:owner-b', atMs: BASE_MS - DAY_MS + 10_000 }),
    ]
    const prepared = prepareRows(CASE, rows, WINDOW)
    expect(prepared.collapsed.map((event) => event.value)).toEqual([null, 'open', 'tk1:owner-b'])
    expect(prepared.filteredDebounced).toHaveLength(1)
    expect(prepared.filteredDebounced[0].inWindow).toBe(false)
  })

  it('buckets rows without a cause as legacy, never as human', () => {
    expect(normalizeCauseKind(null)).toBe('legacy')
    expect(normalizeCauseKind('')).toBe('legacy')
    expect(classifyCause('legacy')).toBe('legacy')
    expect(classifyCause('user')).toBe('human')
    expect(classifyCause('workflow')).toBe('automated')
    expect(classifyCause('sync_run')).toBe('automated')
    expect(classifyCause('redo')).toBe('other')
    const prepared = prepareRows(CASE, [...creation(CASE, BASE_MS, { cause: null })], WINDOW)
    expect(prepared.trace.events.map((event) => event.causeClass)).toEqual(['legacy', 'legacy'])
  })

  it('summarizes complete traces as of the window end and falls back to the stored case for cut histories', () => {
    const rows = [
      ...creation(CASE, BASE_MS),
      stepRow(CASE, { key: 'status:won', atMs: BASE_MS + 3 * DAY_MS }),
    ]
    const complete = prepareRows(CASE, rows, WINDOW)
    expect(complete.trace).toEqual(expect.objectContaining({ complete: true, status: 'completed', endedAtMs: BASE_MS + 3 * DAY_MS, startedAtMs: BASE_MS }))
    const beforeEnd = prepareRows(CASE, rows, windowOf(BASE_MS - DAY_MS, BASE_MS + DAY_MS))
    expect(beforeEnd.trace.status).toBe('open')
    const cut = buildCaseTrace({
      organizationId: complete.trace.organizationId,
      caseId: CASE,
      rows: [...rows, stepRow(CASE, { key: 'status:lost', atMs: BASE_MS + 4 * DAY_MS })],
      caseRow: { startedAt: new Date(BASE_MS - 30 * DAY_MS).toISOString(), endedAt: new Date(BASE_MS + 4 * DAY_MS).toISOString(), status: 'completed', variantHash: 'stored-hash' },
      process: dealProcess,
      window: WINDOW,
      perCaseLimit: 3,
    })
    expect(cut.complete).toBe(false)
    expect(cut.events).toHaveLength(3)
    expect(cut.startedAtMs).toBe(BASE_MS - 30 * DAY_MS)
    expect(cut.status).toBe('completed')
    expect(cut.storedVariantHash).toBe('stored-hash')
    const cutBeforeEnd = buildCaseTrace({
      organizationId: complete.trace.organizationId,
      caseId: CASE,
      rows,
      caseRow: { startedAt: new Date(BASE_MS).toISOString(), endedAt: new Date(BASE_MS + 40 * DAY_MS).toISOString(), status: 'completed', variantHash: null },
      process: dealProcess,
      window: WINDOW,
      perCaseLimit: 2,
    })
    expect(cutBeforeEnd.status).toBe('open')
    expect(cutBeforeEnd.endedAtMs).toBeNull()
  })
})
