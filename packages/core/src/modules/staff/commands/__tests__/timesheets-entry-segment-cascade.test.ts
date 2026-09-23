/** @jest-environment node */
// Command-level coverage for the segment cascade: soft-deleting a StaffTimeEntry
// has to take its StaffTimeEntrySegment rows with it, on both paths that stamp
// `deletedAt` on an entry. Before this, undoing a `start_timer` left the work
// segment live AND open (`ended_at = NULL`) — a segment still running against an
// entry that no longer existed — and `time_entries.delete` left every segment live.
//
// The delete round-trip is keyed on a single shared `deletedAt` instant recorded
// in the undo payload, which is what stops undo from resurrecting a segment the
// user had deleted individually beforehand.
import type { AwilixContainer } from 'awilix'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
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

jest.mock('@open-mercato/core/modules/staff/events', () => ({
  emitStaffEvent: jest.fn((...args: unknown[]) => mockEmitStaffEvent(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_MEMBER_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_ORG_ID = '88888888-8888-4888-8888-888888888888'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'

type SegmentRow = {
  id: string
  tenantId: string
  organizationId: string
  timeEntryId: string
  startedAt: Date
  endedAt: Date | null
  deletedAt: Date | null
}

type EntryRow = {
  id: string
  tenantId: string
  organizationId: string
  staffMemberId: string
  date: Date
  durationMinutes: number
  startedAt: Date | null
  endedAt: Date | null
  notes: string | null
  timeProjectId: string | null
  customerId: string | null
  dealId: string | null
  orderId: string | null
  source: string
  deletedAt: Date | null
  updatedAt: Date
}

type LoadedCommands = {
  createEntry: {
    undo: (params: { logEntry: unknown; ctx: unknown }) => Promise<void>
    redo: (params: { input: unknown; logEntry: unknown; ctx: unknown }) => Promise<unknown>
  }
  startTimer: {
    undo: (params: { logEntry: unknown; ctx: unknown }) => Promise<void>
  }
  deleteEntry: {
    execute: (input: unknown, ctx: unknown) => Promise<{ timeEntryId: string; segmentsDeletedAt: string }>
    buildLog: (args: unknown) => Promise<{ payload?: Record<string, unknown> } | null>
    undo: (params: { logEntry: unknown; ctx: unknown }) => Promise<void>
  }
}

async function loadCommands(): Promise<LoadedCommands> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-entries')
  return {
    createEntry: commandRegistry.get('staff.timesheets.time_entries.create') as never,
    startTimer: commandRegistry.get('staff.timesheets.time_entries.start_timer') as never,
    deleteEntry: commandRegistry.get('staff.timesheets.time_entries.delete') as never,
  }
}

function makeEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    staffMemberId: STAFF_MEMBER_ID,
    date: new Date('2026-08-26T00:00:00.000Z'),
    durationMinutes: 0,
    startedAt: new Date('2026-08-26T10:00:00.000Z'),
    endedAt: null,
    notes: null,
    timeProjectId: null,
    customerId: null,
    dealId: null,
    orderId: null,
    source: 'timer',
    deletedAt: null,
    updatedAt: new Date('2026-08-26T10:00:00.000Z'),
    ...overrides,
  }
}

function makeSegment(overrides: Partial<SegmentRow> & { id: string }): SegmentRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeEntryId: ENTRY_ID,
    startedAt: new Date('2026-08-26T10:00:00.000Z'),
    endedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function snapshotOf(entry: EntryRow): Record<string, unknown> {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    staffMemberId: entry.staffMemberId,
    date: '2026-08-26',
    durationMinutes: entry.durationMinutes,
    startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
    endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
    notes: entry.notes,
    timeProjectId: entry.timeProjectId,
    customerId: entry.customerId,
    dealId: entry.dealId,
    orderId: entry.orderId,
    source: entry.source,
    deletedAt: null,
  }
}

/**
 * The segment table is filtered by the where clause the helper actually passes, so
 * a helper that dropped its scope predicate would change these results rather than
 * silently pass.
 */
function installWorld(entry: EntryRow | null, segments: SegmentRow[]) {
  mockFindOneWithDecryption.mockImplementation(async () => entry)
  mockFindWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) =>
    segments.filter((row) =>
      Object.entries(where).every(([field, expected]) => {
        const actual = (row as unknown as Record<string, unknown>)[field]
        if (expected === null) return actual === null
        if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
        return actual === expected
      }),
    ),
  )
}

function makeCtx(entry: EntryRow | null) {
  const em = {
    fork: jest.fn(),
    // Honours the where clause rather than returning the row unconditionally, so a
    // lookup that dropped its tenant/organization predicate fails these tests instead
    // of passing silently.
    findOne: jest.fn(async (_cls: unknown, where: Record<string, unknown> = {}) => {
      if (!entry) return null
      const matches = Object.entries(where).every(([field, expected]) => {
        if (expected === null) return (entry as unknown as Record<string, unknown>)[field] === null
        return (entry as unknown as Record<string, unknown>)[field] === expected
      })
      return matches ? entry : null
    }),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return {}
      if (token === 'rbacService') return { userHasAllFeatures: jest.fn(async () => true) }
      return undefined
    }),
  } as unknown as AwilixContainer
  return {
    em,
    ctx: {
      container,
      auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
    },
  }
}

beforeEach(() => {
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockEmitStaffEvent.mockReset()
})

describe('start_timer undo', () => {
  it('soft-deletes the work segment it opened and closes it at the delete instant', async () => {
    const { startTimer } = await loadCommands()
    const entry = makeEntry()
    const segment = makeSegment({ id: 'seg-a' })
    installWorld(entry, [segment])
    const { ctx } = makeCtx(entry)

    await startTimer.undo({ ctx, logEntry: { payload: { undo: { after: snapshotOf(entry) } } } })

    expect(entry.deletedAt).toBeInstanceOf(Date)
    expect(segment.deletedAt).toBe(entry.deletedAt)
    expect(segment.endedAt).toBe(entry.deletedAt)
  })

  it('leaves no segment open after the undo', async () => {
    const { startTimer } = await loadCommands()
    const entry = makeEntry()
    const open = makeSegment({ id: 'seg-a' })
    const closed = makeSegment({ id: 'seg-b', endedAt: new Date('2026-08-26T11:00:00.000Z') })
    installWorld(entry, [open, closed])
    const { ctx } = makeCtx(entry)

    await startTimer.undo({ ctx, logEntry: { payload: { undo: { after: snapshotOf(entry) } } } })

    expect([open, closed].every((segment) => segment.endedAt !== null)).toBe(true)
    expect([open, closed].every((segment) => segment.deletedAt !== null)).toBe(true)
  })
})

describe('time_entries.delete', () => {
  it('stamps the entry and every live segment with one shared instant, and records it', async () => {
    const { deleteEntry } = await loadCommands()
    const entry = makeEntry()
    const first = makeSegment({ id: 'seg-a', endedAt: new Date('2026-08-26T11:00:00.000Z') })
    const second = makeSegment({ id: 'seg-b' })
    installWorld(entry, [first, second])
    const { ctx } = makeCtx(entry)

    const result = await deleteEntry.execute({ id: ENTRY_ID }, ctx)

    expect(entry.deletedAt).toBeInstanceOf(Date)
    expect(first.deletedAt).toBe(entry.deletedAt)
    expect(second.deletedAt).toBe(entry.deletedAt)
    expect(result.segmentsDeletedAt).toBe((entry.deletedAt as Date).toISOString())

    const log = await deleteEntry.buildLog({ result, snapshots: { before: snapshotOf(makeEntry()) } })
    expect((log?.payload?.undo as Record<string, unknown>).segmentsDeletedAt).toBe(result.segmentsDeletedAt)
  })

  it('does not cascade a segment that was already soft-deleted individually', async () => {
    const { deleteEntry } = await loadCommands()
    const entry = makeEntry()
    const individuallyDeletedAt = new Date('2026-08-26T12:00:00.000Z')
    const live = makeSegment({ id: 'seg-a' })
    const individually = makeSegment({ id: 'seg-b', deletedAt: individuallyDeletedAt })
    installWorld(entry, [live, individually])
    const { ctx } = makeCtx(entry)

    await deleteEntry.execute({ id: ENTRY_ID }, ctx)

    expect(live.deletedAt).toBe(entry.deletedAt)
    expect(individually.deletedAt).toBe(individuallyDeletedAt)
  })
})

describe('time_entries.delete undo', () => {
  it('restores exactly the cascaded set and leaves an individually-deleted segment deleted', async () => {
    const { deleteEntry } = await loadCommands()
    const entry = makeEntry()
    const individuallyDeletedAt = new Date('2026-08-26T12:00:00.000Z')
    const cascaded = makeSegment({ id: 'seg-a' })
    const individually = makeSegment({ id: 'seg-b', deletedAt: individuallyDeletedAt })
    installWorld(entry, [cascaded, individually])
    const { ctx } = makeCtx(entry)

    const before = snapshotOf(makeEntry())
    const result = await deleteEntry.execute({ id: ENTRY_ID }, ctx)
    const log = await deleteEntry.buildLog({ result, snapshots: { before } })

    await deleteEntry.undo({ ctx, logEntry: { payload: log?.payload } })

    expect(entry.deletedAt).toBeNull()
    expect(cascaded.deletedAt).toBeNull()
    expect(cascaded.endedAt).toBeNull()
    expect(individually.deletedAt).toBe(individuallyDeletedAt)
  })

  it('restores a segment that was already closed before the cascade without re-opening it', async () => {
    const { deleteEntry } = await loadCommands()
    const entry = makeEntry()
    const closedAt = new Date('2026-08-26T11:00:00.000Z')
    const closed = makeSegment({ id: 'seg-a', endedAt: closedAt })
    installWorld(entry, [closed])
    const { ctx } = makeCtx(entry)

    const before = snapshotOf(makeEntry())
    const result = await deleteEntry.execute({ id: ENTRY_ID }, ctx)
    const log = await deleteEntry.buildLog({ result, snapshots: { before } })

    await deleteEntry.undo({ ctx, logEntry: { payload: log?.payload } })

    expect(closed.deletedAt).toBeNull()
    expect(closed.endedAt).toBe(closedAt)
  })

  it('restores no segment for a legacy payload that carries no recorded instant', async () => {
    const { deleteEntry } = await loadCommands()
    const entry = makeEntry({ deletedAt: new Date('2026-08-26T16:42:11.000Z') })
    const untouched = makeSegment({ id: 'seg-a' })
    installWorld(entry, [untouched])
    const { ctx } = makeCtx(entry)

    await deleteEntry.undo({ ctx, logEntry: { payload: { undo: { before: snapshotOf(makeEntry()) } } } })

    expect(entry.deletedAt).toBeNull()
    expect(untouched.deletedAt).toBeNull()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})

describe('create undo/redo', () => {
  it('undoing a create cascades to segments the entry accrued afterwards', async () => {
    const { createEntry } = await loadCommands()
    const entry = makeEntry({ source: 'manual' })
    const open = makeSegment({ id: 'seg-a' })
    const closed = makeSegment({ id: 'seg-b', endedAt: new Date('2026-08-26T11:00:00.000Z') })
    installWorld(entry, [open, closed])
    const { ctx } = makeCtx(entry)

    await createEntry.undo({ ctx, logEntry: { payload: { undo: { after: snapshotOf(entry) } } } })

    expect(entry.deletedAt).toBeInstanceOf(Date)
    expect(open.deletedAt).toBe(entry.deletedAt)
    expect(closed.deletedAt).toBe(entry.deletedAt)
    expect(open.endedAt).toBe(entry.deletedAt)
  })

  it('redo restores exactly the segments the undo cascaded, keyed on the entry instant', async () => {
    const { createEntry } = await loadCommands()
    const entry = makeEntry({ source: 'manual' })
    const individuallyDeletedAt = new Date('2026-08-26T12:00:00.000Z')
    const cascaded = makeSegment({ id: 'seg-a' })
    const individually = makeSegment({ id: 'seg-b', deletedAt: individuallyDeletedAt })
    installWorld(entry, [cascaded, individually])
    const { ctx } = makeCtx(entry)
    const snapshot = snapshotOf(entry)

    await createEntry.undo({ ctx, logEntry: { payload: { undo: { after: snapshot } } } })
    const cascadeInstant = entry.deletedAt as Date
    expect(cascaded.deletedAt).toBe(cascadeInstant)

    await createEntry.redo({ input: {}, ctx, logEntry: { payload: { undo: { after: snapshot } } } })

    expect(cascaded.deletedAt).toBeNull()
    expect(cascaded.endedAt).toBeNull()
    expect(individually.deletedAt).toBe(individuallyDeletedAt)
  })
})

describe('create redo scope isolation', () => {
  /**
   * The segments are in the caller's own scope, so the segment query alone cannot
   * reject this — only the entry lookup's tenant/organization filter can. Drop either
   * predicate from `beforeRestore` and the foreign row's `deletedAt` is read and the
   * segments come back, failing this test. That makes the assertion falsifiable, which
   * the segment-scoped variant was not.
   */
  it('will not read a soft-deleted entry that belongs to another organization', async () => {
    const { createEntry } = await loadCommands()
    const cascadeInstant = new Date('2026-08-26T16:42:11.000Z')
    const foreignEntry = makeEntry({ source: 'manual', organizationId: OTHER_ORG_ID, deletedAt: cascadeInstant })
    const inScopeSegment = makeSegment({ id: 'seg-a', deletedAt: cascadeInstant, endedAt: cascadeInstant })
    installWorld(foreignEntry, [inScopeSegment])
    const { ctx } = makeCtx(foreignEntry)

    const snapshot = snapshotOf(makeEntry({ source: 'manual' }))

    await createEntry.redo({ input: {}, ctx, logEntry: { payload: { undo: { after: snapshot } } } })

    expect(inScopeSegment.deletedAt).toBe(cascadeInstant)
    expect(inScopeSegment.endedAt).toBe(cascadeInstant)
  })
})
