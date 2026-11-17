/** @jest-environment node */
import type { AwilixContainer } from 'awilix'

const mockEmitCrudSideEffects = jest.fn()
const mockEmitCrudUndoSideEffects = jest.fn()
const mockEmitTaskAssigneeChanged = jest.fn()
const mockIsActiveProjectAssigner = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: (...args: unknown[]) => mockEmitCrudSideEffects(...args),
  emitCrudUndoSideEffects: (...args: unknown[]) => mockEmitCrudUndoSideEffects(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) => em.findOne(cls, where)),
}))

jest.mock('../../lib/time-tracking/projectAssignment', () => ({
  isActiveProjectAssigner: (...args: unknown[]) => mockIsActiveProjectAssigner(...args),
  resolveAssignmentGraceDaysFromContainer: jest.fn(async () => null),
}))

jest.mock('../timesheets-tasks', () => ({
  TASK_LIST_CACHE_RESOURCE: 'staff.timesheets.time_task',
  emitTaskAssigneeChanged: (...args: unknown[]) => mockEmitTaskAssigneeChanged(...args),
  taskCrudEvents: { module: 'staff', entity: 'timesheets.time_task' },
  taskCrudIndexer: { entityType: 'staff:staff_time_task' },
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const TASK_ID = '77777777-7777-4777-8777-777777777777'
const ACTOR_MEMBER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_MEMBER_ID = '66666666-6666-4666-8666-6666666666ff'

type TaskRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  taskStatusId: string
  assigneeStaffMemberId: string | null
  updatedAt: Date
  deletedAt: Date | null
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  buildLog: (args: { result: unknown }) => Promise<{ payload: { undo: unknown } }>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

async function loadCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-task-assignment')
  return commandRegistry.get(id) as unknown as RegisteredCommand
}

function makeWorld(options: {
  assignee?: string | null
  isDone?: boolean
  raceWinner?: string
  raceMovedToDone?: boolean
  afterWinningUpdate?: (task: TaskRow) => void
} = {}) {
  const task: TaskRow = {
    id: TASK_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: 'project-1',
    taskStatusId: options.isDone ? 'status-done' : 'status-1',
    assigneeStaffMemberId: options.assignee ?? null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  }
  const nativeUpdate = jest.fn(async (_cls: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
    if (options.raceWinner) {
      task.assigneeStaffMemberId = options.raceWinner
      options.raceWinner = undefined
    }
    if (options.raceMovedToDone) {
      task.taskStatusId = 'status-done'
      options.raceMovedToDone = undefined
    }
    if (task.deletedAt !== null || task.assigneeStaffMemberId !== where.assigneeStaffMemberId) return 0
    const statusFilter = where.taskStatusId as { $nin?: string[] } | undefined
    if (statusFilter?.$nin?.includes(task.taskStatusId)) return 0
    Object.assign(task, data)
    const barrier = options.afterWinningUpdate
    options.afterWinningUpdate = undefined
    barrier?.(task)
    return 1
  })
  const em: Record<string, unknown> = {
    nativeUpdate,
    clear: jest.fn(),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      if (cls.name === 'StaffTimeTaskStatus' && where.isDone === true) return [{ id: 'status-done' }]
      return []
    }),
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      if (cls.name === 'StaffTimeTask') return where.id === TASK_ID ? { ...task } : null
      if (cls.name === 'StaffTeamMember') return where.userId === USER_ID ? { id: ACTOR_MEMBER_ID, userId: USER_ID } : null
      return null
    }),
  }
  em.fork = () => em
  const ctx = {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, roles: [], isSuperAdmin: false },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer,
  }
  return { task, ctx, nativeUpdate }
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string) {
  const error = (await promise.then(() => null, (err: unknown) => err)) as { status?: number; body?: { code?: string } } | null
  expect(error?.status).toBe(status)
  if (code) expect(error?.body?.code).toBe(code)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsActiveProjectAssigner.mockResolvedValue(true)
})

describe('staff.timesheets.tasks.claim', () => {
  it('claims an unassigned task with a conditional update', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { task, ctx, nativeUpdate } = makeWorld()

    const result = await command.execute({ id: TASK_ID }, ctx)

    expect(result).toEqual(expect.objectContaining({ taskId: TASK_ID, assigneeStaffMemberId: ACTOR_MEMBER_ID }))
    expect(task.assigneeStaffMemberId).toBe(ACTOR_MEMBER_ID)
    expect(nativeUpdate.mock.calls[0][1]).toEqual(expect.objectContaining({ id: TASK_ID, assigneeStaffMemberId: null, deletedAt: null }))
    expect(mockEmitCrudSideEffects).toHaveBeenCalledTimes(1)
    expect(mockEmitTaskAssigneeChanged).toHaveBeenCalledWith(expect.objectContaining({ id: TASK_ID }), null, 'claim', USER_ID)
  })

  it('answers 409 to the loser of a concurrent claim and emits nothing', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { task, ctx } = makeWorld({ raceWinner: OTHER_MEMBER_ID })

    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 409, 'task_already_claimed')

    expect(task.assigneeStaffMemberId).toBe(OTHER_MEMBER_ID)
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
    expect(mockEmitTaskAssigneeChanged).not.toHaveBeenCalled()
  })

  it('answers 409 when the task is already assigned', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { ctx, nativeUpdate } = makeWorld({ assignee: OTHER_MEMBER_ID })
    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 409, 'task_already_claimed')
    expect(nativeUpdate).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not an active assigner', async () => {
    mockIsActiveProjectAssigner.mockResolvedValue(false)
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { ctx } = makeWorld()
    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 403, 'task_not_assigner')
  })

  it('refuses a task in a done column', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { ctx } = makeWorld({ isDone: true })
    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 422, 'task_not_claimable')
  })

  it('excludes done columns inside the conditional update, so a task moved to done meanwhile is not claimed', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { task, ctx, nativeUpdate } = makeWorld({ raceMovedToDone: true })

    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 422, 'task_not_claimable')

    expect(nativeUpdate.mock.calls[0][1]).toEqual(expect.objectContaining({ taskStatusId: { $nin: ['status-done'] } }))
    expect(task.assigneeStaffMemberId).toBeNull()
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('undo puts the task back to unassigned only while the claim still holds', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const { task, ctx } = makeWorld()
    const result = await command.execute({ id: TASK_ID }, ctx)
    const log = await command.buildLog({ result })

    await command.undo({ logEntry: { commandPayload: log.payload }, ctx })

    expect(task.assigneeStaffMemberId).toBeNull()
    expect(mockEmitCrudUndoSideEffects).toHaveBeenCalledTimes(1)

    task.assigneeStaffMemberId = OTHER_MEMBER_ID
    mockEmitCrudUndoSideEffects.mockClear()
    await command.undo({ logEntry: { commandPayload: log.payload }, ctx })
    expect(task.assigneeStaffMemberId).toBe(OTHER_MEMBER_ID)
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('reports the winning claim even when a manager reassigns before the result is captured, and undo leaves the later assignee alone', async () => {
    const command = await loadCommand('staff.timesheets.tasks.claim')
    const managerAssignedAt = new Date('2026-02-02T00:00:00.000Z')
    const { task, ctx, nativeUpdate } = makeWorld({
      afterWinningUpdate: (row) => {
        row.assigneeStaffMemberId = OTHER_MEMBER_ID
        row.updatedAt = managerAssignedAt
      },
    })

    const result = await command.execute({ id: TASK_ID }, ctx)
    const claimData = nativeUpdate.mock.calls[0][2] as { updatedAt: Date }

    expect(result).toEqual(expect.objectContaining({
      assigneeStaffMemberId: ACTOR_MEMBER_ID,
      updatedAt: claimData.updatedAt.toISOString(),
    }))
    expect(mockEmitTaskAssigneeChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID, assigneeStaffMemberId: ACTOR_MEMBER_ID }),
      null,
      'claim',
      USER_ID,
    )
    expect(mockEmitCrudSideEffects.mock.calls[0][0].entity).toEqual(expect.objectContaining({ assigneeStaffMemberId: ACTOR_MEMBER_ID }))

    const log = await command.buildLog({ result })
    expect(log.payload.undo).toEqual(expect.objectContaining({ previousAssigneeStaffMemberId: null, nextAssigneeStaffMemberId: ACTOR_MEMBER_ID }))

    await command.undo({ logEntry: { commandPayload: log.payload }, ctx })

    expect(task.assigneeStaffMemberId).toBe(OTHER_MEMBER_ID)
    expect(task.updatedAt).toBe(managerAssignedAt)
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })
})

describe('staff.timesheets.tasks.release', () => {
  it('releases a task the caller holds and undo gives it back', async () => {
    const command = await loadCommand('staff.timesheets.tasks.release')
    const { task, ctx } = makeWorld({ assignee: ACTOR_MEMBER_ID })

    const result = await command.execute({ id: TASK_ID }, ctx)
    expect(result).toEqual(expect.objectContaining({ assigneeStaffMemberId: null, previousAssigneeStaffMemberId: ACTOR_MEMBER_ID }))
    expect(task.assigneeStaffMemberId).toBeNull()
    expect(mockEmitTaskAssigneeChanged).toHaveBeenCalledWith(expect.objectContaining({ id: TASK_ID }), ACTOR_MEMBER_ID, 'release', USER_ID)

    const log = await command.buildLog({ result })
    await command.undo({ logEntry: { commandPayload: log.payload }, ctx })
    expect(task.assigneeStaffMemberId).toBe(ACTOR_MEMBER_ID)
  })

  it('refuses someone who is not the current assignee', async () => {
    const command = await loadCommand('staff.timesheets.tasks.release')
    const { ctx } = makeWorld({ assignee: OTHER_MEMBER_ID })
    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 403, 'task_not_assignee')
  })

  it('answers 409 when the assignee changed under the release', async () => {
    const command = await loadCommand('staff.timesheets.tasks.release')
    const { ctx } = makeWorld({ assignee: ACTOR_MEMBER_ID, raceWinner: OTHER_MEMBER_ID })
    await expectHttpError(command.execute({ id: TASK_ID }, ctx), 409, 'task_assignment_changed')
  })

  it('announces the release it made even when someone claims the task before the result is captured', async () => {
    const command = await loadCommand('staff.timesheets.tasks.release')
    const { task, ctx } = makeWorld({
      assignee: ACTOR_MEMBER_ID,
      afterWinningUpdate: (row) => {
        row.assigneeStaffMemberId = OTHER_MEMBER_ID
      },
    })

    const result = await command.execute({ id: TASK_ID }, ctx)

    expect(result).toEqual(expect.objectContaining({ assigneeStaffMemberId: null, previousAssigneeStaffMemberId: ACTOR_MEMBER_ID }))
    expect(mockEmitTaskAssigneeChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID, assigneeStaffMemberId: null }),
      ACTOR_MEMBER_ID,
      'release',
      USER_ID,
    )

    const log = await command.buildLog({ result })
    await command.undo({ logEntry: { commandPayload: log.payload }, ctx })
    expect(task.assigneeStaffMemberId).toBe(OTHER_MEMBER_ID)
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('undo announces the assignee it restored, not one written after the restore', async () => {
    const command = await loadCommand('staff.timesheets.tasks.release')
    const world = makeWorld({ assignee: ACTOR_MEMBER_ID })
    const result = await command.execute({ id: TASK_ID }, world.ctx)
    const log = await command.buildLog({ result })
    world.nativeUpdate.mockImplementationOnce(async (_cls: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (world.task.assigneeStaffMemberId !== where.assigneeStaffMemberId) return 0
      Object.assign(world.task, data)
      world.task.assigneeStaffMemberId = OTHER_MEMBER_ID
      return 1
    })
    mockEmitTaskAssigneeChanged.mockClear()

    await command.undo({ logEntry: { commandPayload: log.payload }, ctx: world.ctx })

    expect(mockEmitCrudUndoSideEffects.mock.calls[0][0].entity).toEqual(expect.objectContaining({ assigneeStaffMemberId: ACTOR_MEMBER_ID }))
    expect(mockEmitTaskAssigneeChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID, assigneeStaffMemberId: ACTOR_MEMBER_ID }),
      null,
      'manual',
      USER_ID,
    )
  })
})
