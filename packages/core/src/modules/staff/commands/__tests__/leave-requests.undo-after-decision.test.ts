import type { AwilixContainer } from 'awilix'

const mockFindOneWithDecryption = jest.fn()
const mockEmitCrudUndoSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudUndoSideEffects(...args)),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string) => key,
  }),
}))

type RegisteredCommand = {
  undo?: (args: { input?: unknown; ctx: unknown; logEntry: unknown }) => Promise<void>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const LEAVE_REQUEST_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_MEMBER_ID = '77777777-7777-4777-8777-777777777777'
const MANAGER_ID = '88888888-8888-4888-8888-888888888888'
const DECIDED_AT = new Date('2026-01-05T00:00:00.000Z')

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAVE_REQUEST_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    memberId: MEMBER_ID,
    startDate: '2026-01-10T00:00:00.000Z',
    endDate: '2026-01-11T00:00:00.000Z',
    timezone: 'UTC',
    status: 'pending',
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    note: null,
    decisionComment: null,
    submittedByUserId: null,
    decidedByUserId: null,
    decidedAt: null,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeLiveRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LEAVE_REQUEST_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    member: { id: MEMBER_ID },
    startDate: new Date('2026-01-10T00:00:00.000Z'),
    endDate: new Date('2026-01-11T00:00:00.000Z'),
    timezone: 'UTC',
    status: 'pending',
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    note: null,
    decisionComment: null,
    submittedByUserId: null,
    decidedByUserId: null,
    decidedAt: null,
    deletedAt: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function makeApproved(overrides: Record<string, unknown> = {}) {
  return makeLiveRequest({
    status: 'approved',
    decisionComment: 'Enjoy',
    decidedByUserId: MANAGER_ID,
    decidedAt: DECIDED_AT,
    ...overrides,
  })
}

function makeRejected(overrides: Record<string, unknown> = {}) {
  return makeLiveRequest({
    status: 'rejected',
    decisionComment: 'Busy week',
    decidedByUserId: MANAGER_ID,
    decidedAt: DECIDED_AT,
    ...overrides,
  })
}

function createEm(live: Record<string, unknown> | null) {
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(live),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function createCtx(em: unknown) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      isSuperAdmin: false,
    },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  }
}

async function loadLeaveRequestCommands() {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../leave-requests')
  return {
    create: commandRegistry.get('staff.leave-requests.create') as RegisteredCommand,
    update: commandRegistry.get('staff.leave-requests.update') as RegisteredCommand,
  }
}

function createUndoLog() {
  return { resourceId: LEAVE_REQUEST_ID, commandPayload: { undo: { after: makeSnapshot() } } }
}

function updateUndoLog(beforeOverrides: Record<string, unknown> = {}, afterOverrides: Record<string, unknown> = {}) {
  return {
    resourceId: LEAVE_REQUEST_ID,
    commandPayload: {
      undo: {
        before: makeSnapshot({ note: 'original', ...beforeOverrides }),
        after: makeSnapshot({ note: 'edited', ...afterOverrides }),
      },
    },
  }
}

type UndoHttpError = { status: number; body: unknown }

async function captureUndoError(run: () => Promise<void>): Promise<UndoHttpError> {
  try {
    await run()
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && 'body' in err) return err as UndoHttpError
    throw err
  }
  throw new Error('[internal] expected undo to throw')
}

describe('leave request undo after a decision', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitCrudUndoSideEffects.mockResolvedValue(undefined)
    mockFindOneWithDecryption.mockResolvedValue(null)
  })

  describe('create undo', () => {
    it('refuses with 409 and keeps an approved request', async () => {
      const { create } = await loadLeaveRequestCommands()
      const live = makeApproved()
      const em = createEm(live)

      const error = await captureUndoError(() => create.undo!({ ctx: createCtx(em), logEntry: createUndoLog() }))

      expect(error.status).toBe(409)
      expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.undoAfterDecision' })
      expect(live.deletedAt).toBeNull()
      expect(live.status).toBe('approved')
      expect(em.flush).not.toHaveBeenCalled()
      expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
    })

    it('refuses with 409 and keeps a rejected request', async () => {
      const { create } = await loadLeaveRequestCommands()
      const live = makeRejected()
      const em = createEm(live)

      const error = await captureUndoError(() => create.undo!({ ctx: createCtx(em), logEntry: createUndoLog() }))

      expect(error.status).toBe(409)
      expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.undoAfterDecision' })
      expect(live.deletedAt).toBeNull()
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('soft-deletes a request that is still pending', async () => {
      const { create } = await loadLeaveRequestCommands()
      const live = makeLiveRequest()
      const em = createEm(live)

      await create.undo!({ ctx: createCtx(em), logEntry: createUndoLog() })

      expect(live.deletedAt).toBeInstanceOf(Date)
      expect(em.flush).toHaveBeenCalledTimes(1)
      expect(mockEmitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }))
    })

    it('is a no-op when the request is already soft-deleted', async () => {
      const { create } = await loadLeaveRequestCommands()
      const deletedAt = new Date('2026-01-03T00:00:00.000Z')
      const live = makeApproved({ deletedAt })
      const em = createEm(live)

      await create.undo!({ ctx: createCtx(em), logEntry: createUndoLog() })

      expect(live.deletedAt).toBe(deletedAt)
      expect(em.flush).not.toHaveBeenCalled()
      expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
    })

    it('is a no-op when the request no longer exists', async () => {
      const { create } = await loadLeaveRequestCommands()
      const em = createEm(null)

      await create.undo!({ ctx: createCtx(em), logEntry: createUndoLog() })

      expect(em.flush).not.toHaveBeenCalled()
    })

    it('succeeds once the decision has been undone and the request is pending again', async () => {
      const { create } = await loadLeaveRequestCommands()
      const live = makeApproved()
      const em = createEm(live)
      const ctx = createCtx(em)

      const error = await captureUndoError(() => create.undo!({ ctx, logEntry: createUndoLog() }))
      expect(error.status).toBe(409)

      Object.assign(live, { status: 'pending', decisionComment: null, decidedByUserId: null, decidedAt: null })
      await create.undo!({ ctx, logEntry: createUndoLog() })

      expect(live.deletedAt).toBeInstanceOf(Date)
      expect(em.flush).toHaveBeenCalledTimes(1)
    })
  })

  describe('update undo', () => {
    it('refuses with 409 and leaves an approved request and its decision untouched', async () => {
      const { update } = await loadLeaveRequestCommands()
      const live = makeApproved({ note: 'edited' })
      const em = createEm(live)

      const error = await captureUndoError(() => update.undo!({ ctx: createCtx(em), logEntry: updateUndoLog() }))

      expect(error.status).toBe(409)
      expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.undoAfterDecision' })
      expect(live).toMatchObject({
        status: 'approved',
        note: 'edited',
        decisionComment: 'Enjoy',
        decidedByUserId: MANAGER_ID,
        decidedAt: DECIDED_AT,
      })
      expect(em.flush).not.toHaveBeenCalled()
      expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
    })

    it('refuses with 409 for a rejected request', async () => {
      const { update } = await loadLeaveRequestCommands()
      const live = makeRejected({ note: 'edited' })
      const em = createEm(live)

      const error = await captureUndoError(() => update.undo!({ ctx: createCtx(em), logEntry: updateUndoLog() }))

      expect(error.status).toBe(409)
      expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.undoAfterDecision' })
      expect(live).toMatchObject({ status: 'rejected', note: 'edited', decisionComment: 'Busy week', decidedAt: DECIDED_AT })
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('is a no-op when the request is already soft-deleted', async () => {
      const { update } = await loadLeaveRequestCommands()
      const live = makeLiveRequest({ note: 'edited', deletedAt: new Date('2026-01-03T00:00:00.000Z') })
      const em = createEm(live)

      await update.undo!({ ctx: createCtx(em), logEntry: updateUndoLog() })

      expect(live.note).toBe('edited')
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('restores the editable fields including the member and never writes status or decision fields', async () => {
      const { update } = await loadLeaveRequestCommands()
      const originalMember = { id: MEMBER_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }
      mockFindOneWithDecryption.mockResolvedValueOnce(originalMember)
      const live = makeLiveRequest({
        member: { id: OTHER_MEMBER_ID },
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        endDate: new Date('2026-02-02T00:00:00.000Z'),
        timezone: 'Europe/Warsaw',
        unavailabilityReasonEntryId: 'reason-edited',
        unavailabilityReasonValue: 'Edited',
        note: 'edited',
      })
      const assignedFields: string[] = []
      const tracked = new Proxy(live, {
        set(target, property, value) {
          assignedFields.push(String(property))
          return Reflect.set(target, property, value)
        },
      })
      const em = createEm(tracked)

      await update.undo!({
        ctx: createCtx(em),
        logEntry: updateUndoLog(
          { unavailabilityReasonEntryId: 'reason-original', unavailabilityReasonValue: 'Original' },
          { memberId: OTHER_MEMBER_ID },
        ),
      })

      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        em,
        expect.any(Function),
        { id: MEMBER_ID, deletedAt: null, tenantId: TENANT_ID, organizationId: ORG_ID },
        undefined,
        { tenantId: TENANT_ID, organizationId: ORG_ID },
      )
      expect(live).toMatchObject({
        member: originalMember,
        startDate: new Date('2026-01-10T00:00:00.000Z'),
        endDate: new Date('2026-01-11T00:00:00.000Z'),
        timezone: 'UTC',
        unavailabilityReasonEntryId: 'reason-original',
        unavailabilityReasonValue: 'Original',
        note: 'original',
        status: 'pending',
      })
      for (const field of ['status', 'decisionComment', 'decidedByUserId', 'decidedAt']) {
        expect(assignedFields).not.toContain(field)
      }
      expect(em.flush).toHaveBeenCalledTimes(1)
      expect(mockEmitCrudUndoSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated' }))
    })

    it('does not look up the member when it did not change', async () => {
      const { update } = await loadLeaveRequestCommands()
      const live = makeLiveRequest({ note: 'edited' })
      const em = createEm(live)

      await update.undo!({ ctx: createCtx(em), logEntry: updateUndoLog() })

      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
      expect(live.note).toBe('original')
      expect(live.member).toEqual({ id: MEMBER_ID })
    })

    it('refuses with 409 and writes nothing when the original member no longer exists', async () => {
      const { update } = await loadLeaveRequestCommands()
      mockFindOneWithDecryption.mockResolvedValueOnce(null)
      const live = makeLiveRequest({ member: { id: OTHER_MEMBER_ID }, note: 'edited' })
      const em = createEm(live)

      const error = await captureUndoError(() =>
        update.undo!({ ctx: createCtx(em), logEntry: updateUndoLog({}, { memberId: OTHER_MEMBER_ID }) }),
      )

      expect(error.status).toBe(409)
      expect(error.body).toEqual({ error: 'staff.leaveRequests.errors.undoMemberMissing' })
      expect(live).toMatchObject({ member: { id: OTHER_MEMBER_ID }, note: 'edited', status: 'pending' })
      expect(em.flush).not.toHaveBeenCalled()
      expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
    })
  })
})
