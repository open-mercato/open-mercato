/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  hasGuardRisk,
  createDeferredDisposeManager,
  bindFlushTriggers,
  resolveUndoWindowMs,
  DEFAULT_UNDO_WINDOW_MS,
} from '../backend/caseload/hooks'

// Spec 4 Phase 3 (risk-aware approve): warn detection, the undo window's
// exactly-once dispose contract, the early-commit flush triggers, and the
// page/locale wiring invariants (the module has no page-level RTL harness —
// same source-invariant style as p0-honesty-safety.test.ts).

describe('hasGuardRisk', () => {
  it('is false for no checks and all-pass checks', () => {
    expect(hasGuardRisk([])).toBe(false)
    expect(hasGuardRisk([{ result: 'pass' }, { result: 'pass' }])).toBe(false)
  })

  it('is true when any check is warn or block', () => {
    expect(hasGuardRisk([{ result: 'pass' }, { result: 'warn' }])).toBe(true)
    expect(hasGuardRisk([{ result: 'block' }])).toBe(true)
  })
})

describe('createDeferredDisposeManager', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('commits exactly once when the window elapses', () => {
    const commits: string[] = []
    const manager = createDeferredDisposeManager<string>(8000, (id) => commits.push(id))
    manager.defer('p1', 'row')
    expect(manager.has('p1')).toBe(true)
    jest.advanceTimersByTime(7999)
    expect(commits).toEqual([])
    jest.advanceTimersByTime(1)
    expect(commits).toEqual(['p1'])
    // Late flushes and timers never re-commit a settled id.
    manager.flush('p1')
    manager.flushAll()
    jest.runOnlyPendingTimers()
    expect(commits).toEqual(['p1'])
    expect(manager.has('p1')).toBe(false)
  })

  it('undo cancels locally — zero commits even after the window', () => {
    const commits: string[] = []
    const manager = createDeferredDisposeManager<string>(8000, (id) => commits.push(id))
    manager.defer('p1', 'payload')
    expect(manager.undo('p1')).toBe('payload')
    jest.advanceTimersByTime(20_000)
    expect(commits).toEqual([])
    expect(manager.undo('p1')).toBeNull()
  })

  it('flushAll commits everything pending immediately, once', () => {
    const commits: string[] = []
    const manager = createDeferredDisposeManager<string>(8000, (id) => commits.push(id))
    manager.defer('p1', 'a')
    manager.defer('p2', 'b')
    manager.flushAll()
    expect(commits.sort()).toEqual(['p1', 'p2'])
    jest.advanceTimersByTime(20_000)
    expect(commits).toHaveLength(2)
  })

  it('re-deferring a pending id keeps the first window (no double commit)', () => {
    const commits: string[] = []
    const manager = createDeferredDisposeManager<string>(8000, (id) => commits.push(id))
    manager.defer('p1', 'first')
    jest.advanceTimersByTime(4000)
    manager.defer('p1', 'second')
    jest.advanceTimersByTime(4000)
    expect(commits).toEqual(['p1'])
    jest.advanceTimersByTime(20_000)
    expect(commits).toEqual(['p1'])
  })

  it('reports settled ids through onSettled for every exit path', () => {
    const settled: string[] = []
    const manager = createDeferredDisposeManager<string>(
      8000,
      () => {},
      (id) => settled.push(id),
    )
    manager.defer('committed', 'x')
    manager.defer('undone', 'y')
    jest.advanceTimersByTime(8000)
    manager.undo('undone')
    expect(settled.sort()).toEqual(['committed', 'undone'])
  })
})

describe('bindFlushTriggers', () => {
  type Listener = () => void
  function fakeTarget(visibilityState?: string) {
    const listeners = new Map<string, Listener[]>()
    return {
      visibilityState,
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener))
      },
      fire: (type: string) => (listeners.get(type) ?? []).forEach((listener) => listener()),
      count: (type: string) => (listeners.get(type) ?? []).length,
    }
  }

  it('flushes when the document becomes hidden (primary trigger)', () => {
    const doc = fakeTarget('hidden')
    const win = fakeTarget()
    const flush = jest.fn()
    bindFlushTriggers(doc, win, flush)
    doc.fire('visibilitychange')
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('does not flush while the document stays visible', () => {
    const doc = fakeTarget('visible')
    const win = fakeTarget()
    const flush = jest.fn()
    bindFlushTriggers(doc, win, flush)
    doc.fire('visibilitychange')
    expect(flush).not.toHaveBeenCalled()
  })

  it('flushes best-effort on beforeunload and unbinds cleanly', () => {
    const doc = fakeTarget('visible')
    const win = fakeTarget()
    const flush = jest.fn()
    const unbind = bindFlushTriggers(doc, win, flush)
    win.fire('beforeunload')
    expect(flush).toHaveBeenCalledTimes(1)
    unbind()
    expect(doc.count('visibilitychange')).toBe(0)
    expect(win.count('beforeunload')).toBe(0)
  })
})

describe('resolveUndoWindowMs', () => {
  afterEach(() => {
    delete (globalThis as { __omCaseloadUndoWindowMs?: unknown }).__omCaseloadUndoWindowMs
  })

  it('defaults to 8s and honors the integration-test override', () => {
    expect(resolveUndoWindowMs()).toBe(DEFAULT_UNDO_WINDOW_MS)
    ;(globalThis as { __omCaseloadUndoWindowMs?: unknown }).__omCaseloadUndoWindowMs = 1500
    expect(resolveUndoWindowMs()).toBe(1500)
    ;(globalThis as { __omCaseloadUndoWindowMs?: unknown }).__omCaseloadUndoWindowMs = -1
    expect(resolveUndoWindowMs()).toBe(DEFAULT_UNDO_WINDOW_MS)
  })
})

describe('caseload risk-aware approve wiring (source + locale invariants)', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const page = read('backend/caseload/page.tsx')
  const locales = ['en', 'es', 'de', 'pl'] as const
  const localeData = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>]),
  )

  it.each(locales)('locale %s carries the Phase-3 keys with their interpolation tokens', (locale) => {
    const data = localeData[locale]
    expect(data['agent_orchestrator.caseload.col.risk']).toBeTruthy()
    expect(data['agent_orchestrator.caseload.inbox.riskFlagged']).toContain('{count}')
    expect(data['agent_orchestrator.caseload.status.autoApproved']).toBeTruthy()
    expect(data['agent_orchestrator.caseload.undo.action']).toBeTruthy()
    expect(data['agent_orchestrator.caseload.undo.approved']).toContain('{summary}')
  })

  it('splits auto_approved into its own badge status', () => {
    expect(page).toMatch(/disposition === 'auto_approved'.*return 'autoApproved'/s)
    expect(page).toMatch(/autoApproved: 'info'/)
  })

  it('defers only single warn-flagged approves — bulk stays immediate', () => {
    expect(page).toMatch(/source === 'single' && pending\.length === 1 && pending\[0\]\.riskFlagged/)
    expect(page).toMatch(/approveRows\(selectedRows, 'bulk'\)/)
  })

  it('renders the risk chip in the inbox row and the list Risk column', () => {
    expect(page).toMatch(/<GuardRiskChip warn={row\.guardWarnCount} block={row\.guardBlockCount} \/>/)
    expect(page).toMatch(/accessorKey: 'riskFlagged'/)
  })

  it('wires the undo bar with a screen-reader status role and flushes on navigation', () => {
    expect(page).toMatch(/role="status"/)
    expect(page).toMatch(/deferredApprove\.flushAll\(\)\s*\n?\s*router\.push/)
    expect(page).toMatch(/setSelectedIds\(new Set\(\)\); deferredApprove\.flushAll\(\)/)
  })

  it('keeps the deferred committer on the guarded, lock-headered dispose path', () => {
    expect(page).toMatch(/commitDeferredRef\.current = \(id, row\) => {\s*\n\s*void disposeRows\(\[{ \.\.\.row, isPending: true/)
  })
})
