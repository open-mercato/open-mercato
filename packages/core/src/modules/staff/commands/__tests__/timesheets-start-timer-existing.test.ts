/** @jest-environment node */
// Command-level coverage for `staff.timesheets.time_entries.start_timer_existing`.
//
// Starting an existing entry used to be a hand-rolled route write that bypassed
// the command bus, so nothing invalidated the CRUD list cache and a list cached
// before the start kept rendering the entry as not-started — the same defect
// class as #2609, confirmed empirically against the legacy route. Moving the
// write into a command fixes that and relocates two guarantees that were
// previously pinned at the route:
//
//   * #2416 — the read-modify-write must happen inside a single transaction
//     holding a PESSIMISTIC_WRITE lock on the StaffTimeEntry row.
//   * #2855 — the single-active-timer invariant, re-checked under that lock.
//
// Both sets of assertions used to live in
// `api/timesheets/time-entries/__tests__/timer-segment-atomic-write.test.ts`;
// the route no longer touches the ORM, so they belong here now.
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import { buildTimeEntryListFilters } from '../../lib/timesheets/timeEntryListFilters'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockGetStaffMemberByUserId = jest.fn()
const mockEmitStaffEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/lib/staffMemberResolver', () => ({
  getStaffMemberByUserId: jest.fn((...args: unknown[]) => mockGetStaffMemberByUserId(...args)),
}))

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn((...args: unknown[]) => mockEmitStaffEvent(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_STAFF_MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const SEGMENT_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_ENTRY_ID = '77777777-7777-4777-8777-777777777777'

type StartExistingCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<{
    timeEntryId: string
    undoState: Record<string, unknown>
  }>
  prepare?: (input: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: unknown) => Promise<{ payload?: Record<string, unknown>; resourceKind?: string } | null>
  undo?: (params: { input: unknown; ctx: unknown; logEntry: unknown }) => Promise<void>
}

async function loadStartTimerExistingCommand(): Promise<StartExistingCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  return commandRegistry.get('staff.timesheets.time_entries.start_timer_existing') as unknown as StartExistingCommand
}

const findOneOptions: Array<Record<string, unknown> | undefined> = []
let transactionalCalls = 0
let flushCalls = 0

function makeEm() {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ id: SEGMENT_ID, ...data })),
    flush: jest.fn(async () => {
      flushCalls += 1
    }),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => {
      transactionalCalls += 1
      return cb(em)
    }),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    startedAt: null,
    endedAt: null,
    durationMinutes: 0,
    updatedAt: new Date('2026-01-01T08:00:00.000Z'),
    source: 'manual',
    ...overrides,
  }
}

function createCtx(em: unknown, options: { manageAll?: boolean } = {}) {
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        if (name === 'rbacService') return { userHasAllFeatures: async () => options.manageAll === true }
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
  }
}

function startInput() {
  return { tenantId: TENANT_ID, organizationId: ORG_ID, id: ENTRY_ID }
}

function lockWasRequested() {
  return findOneOptions.some((opt) => opt && opt.lockMode === LockMode.PESSIMISTIC_WRITE)
}

function undoLogEntry(undoState: Record<string, unknown>) {
  return { commandPayload: { undo: { before: undoState } } }
}

/**
 * The undo state as a start written before `execute` began clearing `endedAt`
 * would have recorded it — the field is absent entirely, not null.
 */
function legacyUndoStateWithoutEnd(undoState: Record<string, unknown>) {
  const legacyState = { ...undoState }
  delete legacyState.endedAt
  return legacyState
}

const RUNNING_FILTER_FIELD_BY_COLUMN: Record<string, 'startedAt' | 'endedAt'> = {
  started_at: 'startedAt',
  ended_at: 'endedAt',
}

/**
 * Evaluates the time-entries list route's own `?running=true` filter against a row,
 * so "the user can still see the timer they just started" is asserted through
 * `buildTimeEntryListFilters` instead of a hand-copied predicate that could drift
 * away from it.
 */
function matchesRunningFilter(entry: { startedAt: unknown; endedAt: unknown }) {
  return Object.entries(buildTimeEntryListFilters({ running: 'true' })).every(([column, condition]) => {
    const field = RUNNING_FILTER_FIELD_BY_COLUMN[column]
    // Without this the helper would silently score an unknown column as "absent",
    // which is exactly the drift it exists to catch.
    if (!field) throw new Error(`[internal] unmapped running-timer filter column: ${column}`)
    const value = entry[field]
    return (condition as { $exists: boolean }).$exists ? value != null : value == null
  })
}

// The single-active-timer guard (#2855) is the only lookup that queries with
// `id: { $ne }`; every other lookup targets this entry by its concrete id.
function isSiblingRunningTimerQuery(where: unknown) {
  const filter = where as Record<string, unknown>
  return Boolean(filter?.id) && typeof filter.id === 'object'
}

beforeEach(() => {
  jest.clearAllMocks()
  findOneOptions.length = 0
  transactionalCalls = 0
  flushCalls = 0
  mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  mockEmitStaffEvent.mockResolvedValue(undefined)
  mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
    findOneOptions.push(opts as Record<string, unknown> | undefined)
    if (isSiblingRunningTimerQuery(where)) return null
    return makeEntry()
  })
  mockFindWithDecryption.mockResolvedValue([])
})

describe('start_timer_existing command — transaction and lock (#2416)', () => {
  it('starts the timer and opens a work segment inside one locking transaction', async () => {
    const command = await loadStartTimerExistingCommand()
    const entry = makeEntry()
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      if (isSiblingRunningTimerQuery(where)) return null
      return entry
    })
    const em = makeEm()

    const result = await command.execute(startInput(), createCtx(em))

    expect(transactionalCalls).toBe(1)
    expect(lockWasRequested()).toBe(true)
    expect(flushCalls).toBe(1)
    expect(result.timeEntryId).toBe(ENTRY_ID)
    expect(entry.startedAt).toBeInstanceOf(Date)
    expect(entry.source).toBe('timer')
    // Assert the entity by name, not by class identity: `loadStartTimerExistingCommand`
    // calls `jest.resetModules()`, so the command's `StaffTimeEntrySegment` is a
    // different class object than one imported at the top of this file.
    const [segmentClass, segmentData] = em.create.mock.calls[0] as [{ name: string }, Record<string, unknown>]
    expect(segmentClass.name).toBe('StaffTimeEntrySegment')
    expect(segmentData).toMatchObject({ timeEntryId: ENTRY_ID, segmentType: 'work' })
    expect(mockEmitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.time_entry.timer_started',
      expect.objectContaining({ id: ENTRY_ID, staffMemberId: STAFF_MEMBER_ID }),
      expect.objectContaining({ persistent: true }),
    )
  })

  it('rejects with 409 when the lock observes startedAt already set', async () => {
    const command = await loadStartTimerExistingCommand()
    let call = 0
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      if (isSiblingRunningTimerQuery(where)) return null
      call += 1
      // The unlocked load races through; the locked re-read sees it started.
      return call === 1 ? makeEntry() : makeEntry({ startedAt: new Date('2026-01-01T08:00:00.000Z') })
    })
    const em = makeEm()

    await expect(command.execute(startInput(), createCtx(em))).rejects.toMatchObject({ status: 409 })

    expect(lockWasRequested()).toBe(true)
    expect(em.create).not.toHaveBeenCalled()
    expect(flushCalls).toBe(0)
  })

  it('rejects with 409 when the staff member already has another running entry (#2855)', async () => {
    const command = await loadStartTimerExistingCommand()
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      if (isSiblingRunningTimerQuery(where)) {
        return makeEntry({ id: OTHER_ENTRY_ID, startedAt: new Date('2026-01-01T07:00:00.000Z') })
      }
      return makeEntry()
    })
    const em = makeEm()

    await expect(command.execute(startInput(), createCtx(em))).rejects.toMatchObject({ status: 409 })

    expect(lockWasRequested()).toBe(true)
    expect(em.create).not.toHaveBeenCalled()
    expect(flushCalls).toBe(0)
  })

  it('rejects with 404 when the entry is not in scope', async () => {
    const command = await loadStartTimerExistingCommand()
    mockFindOneWithDecryption.mockResolvedValue(null)

    await expect(command.execute(startInput(), createCtx(makeEm()))).rejects.toMatchObject({ status: 404 })
  })
})

describe('start_timer_existing command — owner-only authorization', () => {
  it('rejects with 403 when the caller has no linked staff member', async () => {
    const command = await loadStartTimerExistingCommand()
    mockGetStaffMemberByUserId.mockResolvedValue(null)

    await expect(command.execute(startInput(), createCtx(makeEm()))).rejects.toMatchObject({ status: 403 })
    expect(transactionalCalls).toBe(0)
  })

  it("rejects a staff.timesheets.manage_all holder acting on someone else's entry", async () => {
    // Deliberate divergence from createTimeEntryCommand / startTimerCommand:
    // those let `manage_all` holders act on colleagues' entries, this one does
    // not, because the route it replaces never did.
    const command = await loadStartTimerExistingCommand()
    mockGetStaffMemberByUserId.mockResolvedValue({ id: OTHER_STAFF_MEMBER_ID })

    await expect(
      command.execute(startInput(), createCtx(makeEm(), { manageAll: true })),
    ).rejects.toMatchObject({ status: 403 })
    expect(transactionalCalls).toBe(0)
  })
})

describe('start_timer_existing command — audit log metadata', () => {
  it('returns a resourceKind so the command bus invalidates the list cache', async () => {
    const command = await loadStartTimerExistingCommand()
    const em = makeEm()
    const result = await command.execute(startInput(), createCtx(em))

    const log = await command.buildLog!({
      input: startInput(),
      result,
      ctx: createCtx(em),
      snapshots: {},
    })

    // `invalidateCacheAfterExecute` returns early without a resourceKind, which
    // is exactly what left the legacy route serving stale list payloads.
    expect(log?.resourceKind).toBe('staff.timesheets.time_entry')
    expect((log?.payload?.undo as { before?: Record<string, unknown> })?.before).toMatchObject({
      entryId: ENTRY_ID,
      startedAt: null,
      source: 'manual',
      createdSegmentId: SEGMENT_ID,
    })
  })
})

describe('start_timer_existing command — undo', () => {
  async function captureUndoState() {
    const command = await loadStartTimerExistingCommand()
    const result = await command.execute(startInput(), createCtx(makeEm()))
    return { command, undoState: result.undoState }
  }

  it('restores startedAt and source and retires the segment the start opened', async () => {
    const { command, undoState } = await captureUndoState()
    expect(undoState).toMatchObject({ startedAt: null, source: 'manual', createdSegmentId: SEGMENT_ID })

    findOneOptions.length = 0
    transactionalCalls = 0
    flushCalls = 0
    const startedEntry = makeEntry({ startedAt: new Date('2026-01-01T09:00:00.000Z'), source: 'timer' })
    const openedSegment = { id: SEGMENT_ID, timeEntryId: ENTRY_ID, deletedAt: null }
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      const filter = where as Record<string, unknown>
      if (filter.id === SEGMENT_ID) return openedSegment
      return startedEntry
    })

    await command.undo!({ input: startInput(), ctx: createCtx(makeEm()), logEntry: undoLogEntry(undoState) })

    expect(transactionalCalls).toBe(1)
    expect(lockWasRequested()).toBe(true)
    expect(flushCalls).toBe(1)
    expect(startedEntry.startedAt).toBeNull()
    expect(startedEntry.source).toBe('manual')
    expect(openedSegment.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses with 409 when the timer has since been stopped', async () => {
    const { command, undoState } = await captureUndoState()

    findOneOptions.length = 0
    flushCalls = 0
    // A stop landed after this start, so its endedAt and durationMinutes were
    // computed from the very segment undo would retire.
    const stoppedEntry = makeEntry({
      startedAt: new Date('2026-01-01T09:00:00.000Z'),
      endedAt: new Date('2026-01-01T10:00:00.000Z'),
      durationMinutes: 60,
      source: 'timer',
    })
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, _where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      return stoppedEntry
    })

    await expect(
      command.undo!({ input: startInput(), ctx: createCtx(makeEm()), logEntry: undoLogEntry(undoState) }),
    ).rejects.toMatchObject({ status: 409 })

    expect(stoppedEntry.startedAt).toBeInstanceOf(Date)
    expect(flushCalls).toBe(0)
  })

  it('is a no-op when the log entry carries no snapshot', async () => {
    const command = await loadStartTimerExistingCommand()
    const em = makeEm()

    await command.undo!({ input: startInput(), ctx: createCtx(em), logEntry: {} })

    expect(em.transactional).not.toHaveBeenCalled()
  })
})

// An entry can already carry an `ended_at` when its timer is started: a manual
// entry recording a finished stretch of work has one, and starting it is what the
// timer-start endpoint is for. The start opens a NEW work segment, so that end
// describes work that finished before the segment now running.
describe('start_timer_existing command — an entry that already carried an end', () => {
  const PREVIOUS_END = new Date('2026-01-01T07:30:00.000Z')

  function installEntryEndedBeforeStart() {
    const entry = makeEntry({ endedAt: PREVIOUS_END })
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      const filter = where as Record<string, unknown>
      if (isSiblingRunningTimerQuery(filter)) return null
      if (filter.id === SEGMENT_ID) return { id: SEGMENT_ID, timeEntryId: ENTRY_ID, deletedAt: null }
      return entry
    })
    return entry
  }

  it('clears the stale end so the started entry matches the running-timer lookup', async () => {
    const command = await loadStartTimerExistingCommand()
    const entry = installEntryEndedBeforeStart()

    await command.execute(startInput(), createCtx(makeEm()))

    expect(entry.startedAt).toBeInstanceOf(Date)
    expect(entry.endedAt).toBeNull()
    // Asserted through the list route's own definition of "running" rather than a
    // restatement of it, so the two cannot drift apart silently.
    expect(matchesRunningFilter(entry)).toBe(true)
  })

  it('never leaves the row with an end that predates its start', async () => {
    const command = await loadStartTimerExistingCommand()
    const entry = installEntryEndedBeforeStart()

    await command.execute(startInput(), createCtx(makeEm()))

    const startedAtMs = (entry.startedAt as Date).getTime()
    expect(entry.endedAt === null || (entry.endedAt as Date).getTime() >= startedAtMs).toBe(true)
  })

  it('can still be undone, and gives the entry its previous end back', async () => {
    const command = await loadStartTimerExistingCommand()
    const entry = installEntryEndedBeforeStart()

    // The same row object carries the state `execute` wrote into `undo`, so the
    // undo runs against the real post-start shape instead of a hand-built one.
    const { undoState } = await command.execute(startInput(), createCtx(makeEm()))

    await command.undo!({ input: startInput(), ctx: createCtx(makeEm()), logEntry: undoLogEntry(undoState) })

    expect(entry.startedAt).toBeNull()
    expect(entry.source).toBe('manual')
    expect((entry.endedAt as Date).toISOString()).toBe(PREVIOUS_END.toISOString())
  })

  // An action log written before `execute` cleared `endedAt` carries no `endedAt`
  // in its undo state. The restore reads that as null, which is only safe because
  // the undo guard refuses whenever the row still carries an end — the two cases
  // below pin both halves of that argument.
  it('refuses a legacy log whose start left the end in place, so the restore is never reached', async () => {
    const command = await loadStartTimerExistingCommand()
    const entry = installEntryEndedBeforeStart()

    const { undoState } = await command.execute(startInput(), createCtx(makeEm()))
    // A pre-fix start set startedAt and left the end untouched; recreate that row.
    entry.endedAt = PREVIOUS_END

    await expect(
      command.undo!({
        input: startInput(),
        ctx: createCtx(makeEm()),
        logEntry: undoLogEntry(legacyUndoStateWithoutEnd(undoState)),
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(entry.startedAt).toBeInstanceOf(Date)
    expect((entry.endedAt as Date).toISOString()).toBe(PREVIOUS_END.toISOString())
  })

  it('leaves the end null when a legacy log does reach the restore', async () => {
    const command = await loadStartTimerExistingCommand()
    const entry = installEntryEndedBeforeStart()

    const { undoState } = await command.execute(startInput(), createCtx(makeEm()))

    await command.undo!({
      input: startInput(),
      ctx: createCtx(makeEm()),
      logEntry: undoLogEntry(legacyUndoStateWithoutEnd(undoState)),
    })

    expect(entry.startedAt).toBeNull()
    expect(entry.source).toBe('manual')
    expect(entry.endedAt).toBeNull()
  })
})
