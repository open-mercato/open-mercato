/** @jest-environment node */
// T3.3 (US-C2): the board drag. The card moves optimistically in the browser, so the
// server side of that bargain is what these tests pin down — the move lands where the
// pointer was released, an omitted position appends, a column from another project is
// refused, done-ness follows the target column, a stale version loses with a 409 the
// board can roll back on, and the broadcast carries origin + destination + slot so a
// second board can move the card without refetching.
import type { AwilixContainer } from 'awilix'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const mockEmitCrudSideEffects = jest.fn()
const mockEmitStaffEvent = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudSideEffects(...args)),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => mockEmitStaffEvent(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: { find: Function }, cls: unknown, where: unknown) => em.find(cls, where)),
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) =>
    em.findOne(cls, where),
  ),
}))

const COMMAND_ID = 'staff.timesheets.tasks.status_change'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'

const BACKLOG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROGRESS_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const DONE_ID = 'aaaaaaaa-0000-4000-8000-000000000004'
const FOREIGN_STATUS_ID = 'dddddddd-0000-4000-8000-000000000001'

const TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
const NEIGHBOUR_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const SECOND_NEIGHBOUR_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000003'

const TASK_UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')

type StatusRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  position: number
  isDefault: boolean
  isDone: boolean
  deletedAt: Date | null
}

type TaskRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  parentTaskId: string | null
  taskStatusId: string
  sequenceNumber: number
  reference: string
  title: string
  description: string | null
  assigneeStaffMemberId: string | null
  position: number
  createdByUserId: string | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function statusRow(overrides: Partial<StatusRow> & Pick<StatusRow, 'id' | 'position'>): StatusRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: PROJECT_ID,
    isDefault: false,
    isDone: false,
    deletedAt: null,
    ...overrides,
  }
}

function board(): StatusRow[] {
  return [
    statusRow({ id: BACKLOG_ID, position: 1000, isDefault: true }),
    statusRow({ id: PROGRESS_ID, position: 2000 }),
    statusRow({ id: DONE_ID, position: 3000, isDone: true }),
    // Another project's board, reachable in the same tenant — the drag must not
    // accept it as a destination.
    statusRow({ id: FOREIGN_STATUS_ID, position: 1000, timeProjectId: OTHER_PROJECT_ID }),
  ]
}

function taskRow(overrides: Partial<TaskRow> & Pick<TaskRow, 'id'>): TaskRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: PROJECT_ID,
    parentTaskId: null,
    taskStatusId: BACKLOG_ID,
    sequenceNumber: 1,
    reference: 'TT-1',
    title: 'Migracja koszyka B2B',
    description: null,
    assigneeStaffMemberId: null,
    position: 1000,
    createdByUserId: USER_ID,
    closedAt: null,
    createdAt: TASK_UPDATED_AT,
    updatedAt: TASK_UPDATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadStatusChangeCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-tasks')
  return commandRegistry.get(COMMAND_ID) as RegisteredCommand
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected === null) return actual === null
    return actual === expected
  })
}

type HarnessOptions = {
  statuses?: StatusRow[]
  tasks?: TaskRow[]
}

function makeHarness(options: HarnessOptions = {}) {
  const statuses = options.statuses ?? board()
  const tasks = options.tasks ?? [taskRow({ id: TASK_ID })]
  const whereLog: { entity: string; where: Record<string, unknown> }[] = []

  function tableFor(name: string): Record<string, unknown>[] {
    if (name === 'StaffTimeTaskStatus') return statuses as unknown as Record<string, unknown>[]
    if (name === 'StaffTimeTask') return tasks as unknown as Record<string, unknown>[]
    return []
  }

  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      whereLog.push({ entity: cls.name, where })
      return tableFor(cls.name).filter((row) => matches(row, where))
    }),
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      whereLog.push({ entity: cls.name, where })
      return tableFor(cls.name).find((row) => matches(row, where)) ?? null
    }),
    count: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      whereLog.push({ entity: cls.name, where })
      return tableFor(cls.name).filter((row) => matches(row, where)).length
    }),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return { em, tasks, statuses, whereLog }
}

function ctxFor(
  em: unknown,
  overrides: { tenantId?: string; expectedUpdatedAt?: string } = {},
) {
  const headers: Record<string, string> = {}
  if (overrides.expectedUpdatedAt) headers[OPTIMISTIC_LOCK_HEADER_NAME] = overrides.expectedUpdatedAt
  return {
    auth: {
      sub: USER_ID,
      tenantId: overrides.tenantId ?? TENANT_ID,
      orgId: ORG_ID,
      roles: [],
      isSuperAdmin: false,
    },
    selectedOrganizationId: ORG_ID,
    request: new Request(`http://localhost/api/staff/timesheets/tasks/${TASK_ID}/status`, {
      method: 'PATCH',
      headers,
    }),
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer,
  }
}

type ErrorBody = { code?: string; fieldErrors?: Record<string, string>; currentUpdatedAt?: string; expectedUpdatedAt?: string }

async function captureError(promise: Promise<unknown>): Promise<{ status: number; body: ErrorBody }> {
  try {
    await promise
  } catch (err) {
    const typed = err as { status?: number; body?: ErrorBody }
    return { status: typed.status ?? 0, body: typed.body ?? {} }
  }
  throw new Error('[internal] expected the command to reject')
}

function lastBroadcast(): Record<string, unknown> {
  const call = mockEmitStaffEvent.mock.calls.at(-1) as unknown as [string, Record<string, unknown>] | undefined
  if (!call) throw new Error('[internal] no event was emitted')
  return call[1]
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmitCrudSideEffects.mockResolvedValue(undefined)
})

describe('staff.timesheets.tasks.status_change', () => {
  it('reorders a card inside its own column', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness({
      tasks: [
        taskRow({ id: TASK_ID, position: 1000 }),
        taskRow({ id: NEIGHBOUR_TASK_ID, position: 2000, sequenceNumber: 2, reference: 'TT-2' }),
      ],
    })

    const result = await command.execute({ id: TASK_ID, taskStatusId: BACKLOG_ID, position: 3000 }, ctxFor(em))

    expect(result).toMatchObject({
      taskId: TASK_ID,
      previousTaskStatusId: BACKLOG_ID,
      taskStatusId: BACKLOG_ID,
      position: 3000,
    })
    expect(tasks[0].position).toBe(3000)
    expect(tasks[0].taskStatusId).toBe(BACKLOG_ID)
  })

  it('moves a card to another column at the requested slot', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness()

    const result = await command.execute({ id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1500 }, ctxFor(em))

    expect(result).toMatchObject({
      previousTaskStatusId: BACKLOG_ID,
      taskStatusId: PROGRESS_ID,
      position: 1500,
      timeProjectId: PROJECT_ID,
    })
    expect(tasks[0].taskStatusId).toBe(PROGRESS_ID)
    expect(tasks[0].position).toBe(1500)
  })

  it('appends to the end of the target column when no position is sent', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness({
      tasks: [
        taskRow({ id: TASK_ID }),
        taskRow({ id: NEIGHBOUR_TASK_ID, taskStatusId: PROGRESS_ID, position: 1000, sequenceNumber: 2, reference: 'TT-2' }),
        taskRow({
          id: SECOND_NEIGHBOUR_TASK_ID,
          taskStatusId: PROGRESS_ID,
          position: 2000,
          sequenceNumber: 3,
          reference: 'TT-3',
        }),
      ],
    })

    // The drawer's subtask tick sends the destination column and nothing else.
    const result = await command.execute({ id: TASK_ID, taskStatusId: PROGRESS_ID }, ctxFor(em))

    expect(result).toMatchObject({ taskStatusId: PROGRESS_ID, position: 3000 })
    expect(tasks[0].position).toBe(3000)
  })

  it('refuses a column that belongs to another project', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness()

    const { status, body } = await captureError(
      command.execute({ id: TASK_ID, taskStatusId: FOREIGN_STATUS_ID }, ctxFor(em)),
    )

    expect(status).toBe(422)
    expect(body.fieldErrors?.taskStatusId).toBeTruthy()
    expect(tasks[0].taskStatusId).toBe(BACKLOG_ID)
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  it('stamps closedAt on a done column and clears it on the way out', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness()

    await command.execute({ id: TASK_ID, taskStatusId: DONE_ID, position: 1000 }, ctxFor(em))
    expect(tasks[0].closedAt).toBeInstanceOf(Date)

    await command.execute({ id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 }, ctxFor(em))
    expect(tasks[0].closedAt).toBeNull()
    expect(tasks[0].taskStatusId).toBe(PROGRESS_ID)
  })

  it('accepts a move whose version header matches the stored record', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness()

    await command.execute(
      { id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 },
      ctxFor(em, { expectedUpdatedAt: TASK_UPDATED_AT.toISOString() }),
    )

    expect(tasks[0].taskStatusId).toBe(PROGRESS_ID)
  })

  it('409s on a stale version header so the board can roll the card back', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness()

    const { status, body } = await captureError(
      command.execute(
        { id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 },
        ctxFor(em, { expectedUpdatedAt: '2025-12-31T00:00:00.000Z' }),
      ),
    )

    expect(status).toBe(409)
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(TASK_UPDATED_AT.toISOString())
    expect(body.expectedUpdatedAt).toBe('2025-12-31T00:00:00.000Z')
    // The losing drag changed nothing, which is what makes the client-side rollback
    // to the origin column truthful.
    expect(tasks[0].taskStatusId).toBe(BACKLOG_ID)
    expect(tasks[0].position).toBe(1000)
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  it('broadcasts the origin column, the destination column and the new slot', async () => {
    const command = await loadStatusChangeCommand()
    const { em } = makeHarness()

    await command.execute({ id: TASK_ID, taskStatusId: DONE_ID, position: 2500 }, ctxFor(em))

    expect(mockEmitStaffEvent).toHaveBeenCalledTimes(1)
    const [eventId, payload] = mockEmitStaffEvent.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ]
    expect(eventId).toBe('staff.timesheets.time_task.status_changed')
    expect(payload).toMatchObject({
      id: TASK_ID,
      taskId: TASK_ID,
      timeProjectId: PROJECT_ID,
      previousTaskStatusId: BACKLOG_ID,
      taskStatusId: DONE_ID,
      position: 2500,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    // Landing on a terminal column, so the broadcast already says the card is closed.
    expect(typeof payload.closedAt).toBe('string')
  })

  it('carries the new version so the next drag can send a fresh header', async () => {
    const command = await loadStatusChangeCommand()
    const { em } = makeHarness()

    const result = (await command.execute(
      { id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 },
      ctxFor(em),
    )) as { updatedAt: string | null }

    expect(result.updatedAt).toEqual(expect.any(String))
    expect(result.updatedAt).not.toBe(TASK_UPDATED_AT.toISOString())
    expect(lastBroadcast().updatedAt).toBe(result.updatedAt)
  })

  it('reindexes the task so the board list reflects the move', async () => {
    const command = await loadStatusChangeCommand()
    const { em } = makeHarness()

    await command.execute({ id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 }, ctxFor(em))

    expect(mockEmitCrudSideEffects).toHaveBeenCalledTimes(1)
    expect(mockEmitCrudSideEffects.mock.calls[0][0]).toMatchObject({
      action: 'updated',
      identifiers: { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
    })
  })

  it('404s on a task from another tenant without moving it', async () => {
    const command = await loadStatusChangeCommand()
    const { em, tasks } = makeHarness({
      tasks: [taskRow({ id: TASK_ID, tenantId: OTHER_TENANT_ID })],
    })

    const { status } = await captureError(
      command.execute({ id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 }, ctxFor(em)),
    )

    expect(status).toBe(404)
    expect(tasks[0].taskStatusId).toBe(BACKLOG_ID)
    expect(mockEmitStaffEvent).not.toHaveBeenCalled()
  })

  it('scopes every lookup to the caller tenant and organization', async () => {
    const command = await loadStatusChangeCommand()
    const { em, whereLog } = makeHarness()

    await command.execute({ id: TASK_ID, taskStatusId: PROGRESS_ID, position: 1000 }, ctxFor(em))

    expect(whereLog.length).toBeGreaterThan(0)
    for (const entry of whereLog) {
      expect(entry.where).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
    }
  })
})
