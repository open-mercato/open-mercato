/** @jest-environment node */
// Command-level coverage for `staff.timesheets.time_entries.stop_timer`.
//
// The stop used to be a hand-rolled route write that bypassed the command bus,
// so nothing invalidated the CRUD list cache and stopped timers kept rendering
// as running (#2609). Moving the write into a command fixes that, but it also
// moves two guarantees that were previously pinned at the route:
//
//   * #2416 — the read-modify-write must happen inside a single transaction
//     holding a PESSIMISTIC_WRITE lock on the StaffTimeEntry row, so concurrent
//     timer/segment writes serialize instead of racing on a shared snapshot.
//     Those assertions used to live in
//     `api/timesheets/time-entries/__tests__/timer-segment-atomic-write.test.ts`;
//     the route no longer touches the ORM, so they belong here now.
//   * Owner-only authorization — unlike its sibling commands, this one has no
//     `staff.timesheets.manage_all` bypass, because the endpoint it backs has
//     never had one.
//
// It also covers the undo path, which reverses a mutation spanning two rows.
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'

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

const SEGMENT_STARTED_AT = new Date('2026-01-01T08:00:00.000Z')

type StopCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<{
    timeEntryId: string
    durationMinutes: number
    undoState: Record<string, unknown>
  }>
  prepare?: (input: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: unknown) => Promise<{ payload?: Record<string, unknown>; resourceKind?: string } | null>
  undo?: (params: { input: unknown; ctx: unknown; logEntry: unknown }) => Promise<void>
}

async function loadStopTimerCommand(): Promise<StopCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  return commandRegistry.get('staff.timesheets.time_entries.stop_timer') as unknown as StopCommand
}

const findOneOptions: Array<Record<string, unknown> | undefined> = []
let transactionalCalls = 0
let flushCalls = 0

function makeEm() {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
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
    startedAt: SEGMENT_STARTED_AT,
    endedAt: null,
    durationMinutes: 0,
    updatedAt: new Date('2026-01-01T08:00:00.000Z'),
    source: 'timer',
    ...overrides,
  }
}

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: SEGMENT_ID,
    timeEntryId: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    segmentType: 'work',
    startedAt: SEGMENT_STARTED_AT,
    endedAt: null,
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

function stopInput() {
  return { tenantId: TENANT_ID, organizationId: ORG_ID, id: ENTRY_ID }
}

function lockWasRequested() {
  return findOneOptions.some((opt) => opt && opt.lockMode === LockMode.PESSIMISTIC_WRITE)
}

beforeEach(() => {
  jest.clearAllMocks()
  findOneOptions.length = 0
  transactionalCalls = 0
  flushCalls = 0
  mockGetStaffMemberByUserId.mockResolvedValue({ id: STAFF_MEMBER_ID })
  mockEmitStaffEvent.mockResolvedValue(undefined)
  mockFindOneWithDecryption.mockImplementation(async (_em, _cls, _where, opts) => {
    findOneOptions.push(opts as Record<string, unknown> | undefined)
    return makeEntry()
  })
  mockFindWithDecryption.mockResolvedValue([makeSegment()])
})

describe('stop_timer command — transaction and lock (#2416)', () => {
  it('stops the timer and recomputes duration inside one locking transaction', async () => {
    const command = await loadStopTimerCommand()
    const entry = makeEntry()
    const segment = makeSegment()
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, _where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      return entry
    })
    mockFindWithDecryption.mockResolvedValue([segment])

    const result = await command.execute(stopInput(), createCtx(makeEm()))

    expect(transactionalCalls).toBe(1)
    expect(lockWasRequested()).toBe(true)
    expect(flushCalls).toBe(1)
    expect(result.timeEntryId).toBe(ENTRY_ID)
    expect(typeof result.durationMinutes).toBe('number')
    // Both rows were mutated: the entry closed and the active segment closed.
    expect(entry.endedAt).toBeInstanceOf(Date)
    expect(segment.endedAt).toBeInstanceOf(Date)
    expect(mockEmitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.time_entry.timer_stopped',
      expect.objectContaining({ id: ENTRY_ID, staffMemberId: STAFF_MEMBER_ID }),
      expect.objectContaining({ persistent: true }),
    )
  })

  it('recomputes durationMinutes from every completed work segment', async () => {
    const command = await loadStopTimerCommand()
    mockFindWithDecryption.mockResolvedValue([
      // 30 completed work minutes from an earlier segment...
      makeSegment({
        id: 'earlier-segment',
        startedAt: new Date('2026-01-01T07:00:00.000Z'),
        endedAt: new Date('2026-01-01T07:30:00.000Z'),
      }),
      // ...a break that must not count...
      makeSegment({
        id: 'break-segment',
        segmentType: 'break',
        startedAt: new Date('2026-01-01T07:30:00.000Z'),
        endedAt: new Date('2026-01-01T08:00:00.000Z'),
      }),
      // ...and the active one, which the stop closes.
      makeSegment({ startedAt: new Date(Date.now() - 15 * 60000) }),
    ])

    const result = await command.execute(stopInput(), createCtx(makeEm()))

    expect(result.durationMinutes).toBe(45)
  })

  it('rejects with 409 when no active segment exists under the lock', async () => {
    const command = await loadStopTimerCommand()
    mockFindWithDecryption.mockResolvedValue([
      makeSegment({ endedAt: new Date('2026-01-01T09:00:00.000Z') }),
    ])

    await expect(command.execute(stopInput(), createCtx(makeEm()))).rejects.toMatchObject({ status: 409 })

    expect(lockWasRequested()).toBe(true)
    expect(flushCalls).toBe(0)
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  it('rejects with 404 when the entry is not in scope', async () => {
    const command = await loadStopTimerCommand()
    mockFindOneWithDecryption.mockResolvedValue(null)

    await expect(command.execute(stopInput(), createCtx(makeEm()))).rejects.toMatchObject({ status: 404 })
  })
})

describe('stop_timer command — owner-only authorization', () => {
  it('rejects with 403 when the caller has no linked staff member', async () => {
    const command = await loadStopTimerCommand()
    mockGetStaffMemberByUserId.mockResolvedValue(null)

    await expect(command.execute(stopInput(), createCtx(makeEm()))).rejects.toMatchObject({ status: 403 })
    expect(transactionalCalls).toBe(0)
  })

  it("rejects a staff.timesheets.manage_all holder acting on someone else's entry", async () => {
    // Deliberate divergence from createTimeEntryCommand / startTimerCommand /
    // updateTimeEntryCommand: those let `manage_all` holders act on colleagues'
    // entries, this one does not. Granting that here would widen authorization
    // beyond what the timer-stop endpoint has ever permitted (#2609 scope).
    const command = await loadStopTimerCommand()
    mockGetStaffMemberByUserId.mockResolvedValue({ id: OTHER_STAFF_MEMBER_ID })

    await expect(
      command.execute(stopInput(), createCtx(makeEm(), { manageAll: true })),
    ).rejects.toMatchObject({ status: 403 })
    expect(transactionalCalls).toBe(0)
  })
})

describe('stop_timer command — audit log metadata', () => {
  it('returns a resourceKind so the command bus invalidates the list cache (#2609)', async () => {
    const command = await loadStopTimerCommand()
    const em = makeEm()
    const result = await command.execute(stopInput(), createCtx(em))

    const log = await command.buildLog!({
      input: stopInput(),
      result,
      ctx: createCtx(em),
      snapshots: {},
    })

    // `invalidateCacheAfterExecute` returns early without a resourceKind, which
    // would leave the stale-list bug in place after the refactor.
    expect(log?.resourceKind).toBe('staff.timesheets.time_entry')
    expect((log?.payload?.undo as { before?: Record<string, unknown> })?.before).toMatchObject({
      entryId: ENTRY_ID,
      activeSegmentId: SEGMENT_ID,
      endedAt: null,
      durationMinutes: 0,
    })
  })
})

describe('stop_timer command — undo', () => {
  function undoLogEntry(undoState: Record<string, unknown>) {
    return { commandPayload: { undo: { before: undoState } } }
  }

  async function captureUndoState() {
    const command = await loadStopTimerCommand()
    const result = await command.execute(stopInput(), createCtx(makeEm()))
    return { command, undoState: result.undoState }
  }

  it('restores endedAt, durationMinutes, roundedMinutes and reopens the recorded segment', async () => {
    // The entry carried 30 minutes from an earlier completed segment before the
    // stop, so `durationMinutes` is not reconstructible from the after-state —
    // it has to come from the snapshot.
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, _where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      return makeEntry({ durationMinutes: 30, roundedMinutes: 30 })
    })
    const { command, undoState } = await captureUndoState()
    expect(undoState).toMatchObject({
      endedAt: null,
      durationMinutes: 30,
      roundedMinutes: 30,
      activeSegmentId: SEGMENT_ID,
    })

    findOneOptions.length = 0
    transactionalCalls = 0
    flushCalls = 0
    const restoredEntry = makeEntry({
      endedAt: new Date('2026-01-01T09:00:00.000Z'),
      durationMinutes: 90,
      roundedMinutes: 90,
    })
    const restoredSegment = makeSegment({ endedAt: new Date('2026-01-01T09:00:00.000Z') })
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      const filter = where as Record<string, unknown>
      // The single-active-timer re-check (#2855) queries with id: { $ne }.
      if (filter.id && typeof filter.id === 'object') return null
      if (filter.id === SEGMENT_ID) return restoredSegment
      return restoredEntry
    })

    await command.undo!({ input: stopInput(), ctx: createCtx(makeEm()), logEntry: undoLogEntry(undoState) })

    expect(transactionalCalls).toBe(1)
    expect(lockWasRequested()).toBe(true)
    expect(flushCalls).toBe(1)
    expect(restoredEntry.endedAt).toBeNull()
    expect(restoredEntry.durationMinutes).toBe(30)
    // D-7: cost reads rounded_minutes only, so it must return with the duration.
    expect(restoredEntry.roundedMinutes).toBe(30)
    expect(restoredSegment.endedAt).toBeNull()
  })

  it('leaves roundedMinutes untouched for a log written before the field was recorded', async () => {
    const { command, undoState } = await captureUndoState()
    const { roundedMinutes: _omitted, ...legacyUndoState } = undoState as Record<string, unknown>

    const restoredEntry = makeEntry({
      endedAt: new Date('2026-01-01T09:00:00.000Z'),
      durationMinutes: 90,
      roundedMinutes: 90,
    })
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where) => {
      const filter = where as Record<string, unknown>
      if (filter.id && typeof filter.id === 'object') return null
      if (filter.id === SEGMENT_ID) return makeSegment({ endedAt: new Date('2026-01-01T09:00:00.000Z') })
      return restoredEntry
    })

    await command.undo!({ input: stopInput(), ctx: createCtx(makeEm()), logEntry: undoLogEntry(legacyUndoState) })

    expect(restoredEntry.roundedMinutes).toBe(90)
  })

  it('refuses with 409 when another timer is already running for the staff member (#2855)', async () => {
    const { command, undoState } = await captureUndoState()

    findOneOptions.length = 0
    flushCalls = 0
    const restoredEntry = makeEntry({ endedAt: new Date('2026-01-01T09:00:00.000Z'), durationMinutes: 90 })
    mockFindOneWithDecryption.mockImplementation(async (_em, _cls, where, opts) => {
      findOneOptions.push(opts as Record<string, unknown> | undefined)
      const filter = where as Record<string, unknown>
      if (filter.id && typeof filter.id === 'object') {
        return makeEntry({ id: 'another-running-entry', endedAt: null })
      }
      return restoredEntry
    })

    await expect(
      command.undo!({ input: stopInput(), ctx: createCtx(makeEm()), logEntry: undoLogEntry(undoState) }),
    ).rejects.toMatchObject({ status: 409 })

    // Reopening would have left the staff member with two running timers.
    expect(restoredEntry.endedAt).toBeInstanceOf(Date)
    expect(flushCalls).toBe(0)
  })

  it('is a no-op when the log entry carries no snapshot', async () => {
    const command = await loadStopTimerCommand()
    const em = makeEm()

    await command.undo!({ input: stopInput(), ctx: createCtx(em), logEntry: {} })

    expect(em.transactional).not.toHaveBeenCalled()
  })
})
