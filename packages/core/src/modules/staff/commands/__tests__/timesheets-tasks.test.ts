/** @jest-environment node */
// T3.2 (D-2): a subtask is a child task, so the invariants that keep the board, the
// drawer and the rollup honest live in these commands — depth capped at one, a
// cascade that stops at the children and never touches time entries, done-ness owned
// by the status column, and a per-project reference that survives a lost race.
import type { AwilixContainer } from 'awilix'

const mockEmitCrudSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn((...args: unknown[]) => mockEmitCrudSideEffects(...args)),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

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

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const NEW_ID = '55555555-5555-4555-8555-555555555555'
const CREATOR_MEMBER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_MEMBER_ID = '66666666-6666-4666-8666-6666666666ff'

const BACKLOG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROGRESS_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const DONE_ID = 'aaaaaaaa-0000-4000-8000-000000000004'

const PARENT_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
const CHILD_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const SECOND_CHILD_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000003'
const LONE_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000004'

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

type EntryRow = { id: string; taskId: string; deletedAt: Date | null }

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
    title: 'Task',
    description: null,
    assigneeStaffMemberId: null,
    position: 1000,
    createdByUserId: USER_ID,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-tasks')
  return commandRegistry.get(id) as RegisteredCommand
}

class FakeUniqueViolation extends Error {
  code = '23505'
}

/**
 * Matches a fake row against a MikroORM-style where map. Only the operators these
 * commands actually use are supported — anything else would be a silent pass.
 */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object' && '$in' in (expected as Record<string, unknown>)) {
      const values = (expected as { $in: unknown[] }).$in
      return values.includes(actual)
    }
    if (expected === null) return actual === null
    return actual === expected
  })
}

type HarnessOptions = {
  statuses?: StatusRow[]
  tasks?: TaskRow[]
  entries?: EntryRow[]
  projects?: { id: string; code: string; tenantId: string; organizationId: string; deletedAt: Date | null }[]
  members?: { id: string; userId: string; tenantId: string; organizationId: string; deletedAt: Date | null }[]
  /** Create-attempt indexes (0-based) whose insert loses the reference race. */
  conflictOnCreate?: number[]
}

type Harness = {
  em: Record<string, jest.Mock>
  tasks: TaskRow[]
  entries: EntryRow[]
  created: Record<string, unknown>[]
  whereLog: { entity: string; where: Record<string, unknown> }[]
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const statuses = options.statuses ?? board()
  const tasks = options.tasks ?? []
  const entries = options.entries ?? []
  const projects = options.projects ?? [
    { id: PROJECT_ID, code: 'TT', tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
    { id: OTHER_PROJECT_ID, code: 'XX', tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
  ]
  const members = options.members ?? [
    { id: CREATOR_MEMBER_ID, userId: USER_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
    { id: OTHER_MEMBER_ID, userId: 'someone-else', tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
  ]
  const created: Record<string, unknown>[] = []
  const whereLog: { entity: string; where: Record<string, unknown> }[] = []
  const conflicts = new Set(options.conflictOnCreate ?? [])
  const settledCreates = new Set<number>()

  function tableFor(name: string): Record<string, unknown>[] {
    if (name === 'StaffTimeTaskStatus') return statuses as unknown as Record<string, unknown>[]
    if (name === 'StaffTimeTask') return tasks as unknown as Record<string, unknown>[]
    if (name === 'StaffTimeProject') return projects as unknown as Record<string, unknown>[]
    if (name === 'StaffTeamMember') return members as unknown as Record<string, unknown>[]
    if (name === 'StaffTimeEntry') return entries as unknown as Record<string, unknown>[]
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
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => {
      const row = { id: NEW_ID, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn((row: TaskRow) => {
      tasks.push(row)
    }),
    flush: jest.fn(async () => {
      const attempt = created.length - 1
      if (attempt < 0 || settledCreates.has(attempt)) return
      settledCreates.add(attempt)
      if (!conflicts.has(attempt)) return
      // The winner's row is already committed by the time we hear about it, and our
      // aborted attempt leaves nothing behind.
      const loser = created[attempt] as unknown as TaskRow
      const index = tasks.indexOf(loser)
      if (index >= 0) tasks.splice(index, 1)
      tasks.push(
        taskRow({
          id: `cccccccc-0000-4000-8000-00000000000${attempt + 1}`,
          sequenceNumber: loser.sequenceNumber,
          reference: loser.reference,
          title: 'winner',
        }),
      )
      throw new FakeUniqueViolation('duplicate key value violates unique constraint')
    }),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return { em, tasks, entries, created, whereLog }
}

function ctxFor(em: unknown, overrides: { tenantId?: string } = {}) {
  return {
    auth: {
      sub: USER_ID,
      tenantId: overrides.tenantId ?? TENANT_ID,
      orgId: ORG_ID,
      roles: [],
      isSuperAdmin: false,
    },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer,
  }
}

type ErrorBody = { code?: string; fieldErrors?: Record<string, string> }

async function captureError(promise: Promise<unknown>): Promise<{ status: number; body: ErrorBody }> {
  try {
    await promise
  } catch (err) {
    const typed = err as { status?: number; body?: ErrorBody }
    return { status: typed.status ?? 0, body: typed.body ?? {} }
  }
  throw new Error('[internal] expected the command to reject')
}

const baseCreateInput = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  timeProjectId: PROJECT_ID,
  title: 'Migracja koszyka B2B',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmitCrudSideEffects.mockResolvedValue(undefined)
})

describe('staff.timesheets.tasks.create', () => {
  it('needs only a title, landing on the default column with the creator assigned', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created } = makeHarness()

    const result = await command.execute(baseCreateInput, ctxFor(em))

    expect(result).toEqual({ taskId: NEW_ID })
    expect(created[0]).toMatchObject({
      title: 'Migracja koszyka B2B',
      taskStatusId: BACKLOG_ID,
      assigneeStaffMemberId: CREATOR_MEMBER_ID,
      createdByUserId: USER_ID,
      parentTaskId: null,
      sequenceNumber: 1,
      reference: 'TT-1',
      position: 1000,
      closedAt: null,
    })
  })

  it('numbers the next task from the highest the project ever handed out', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created } = makeHarness({
      tasks: [
        taskRow({ id: LONE_TASK_ID, sequenceNumber: 141, reference: 'TT-141' }),
        // A removed task never gives its number back, so TT-142 is not reused.
        taskRow({ id: PARENT_TASK_ID, sequenceNumber: 142, reference: 'TT-142', deletedAt: new Date() }),
      ],
    })

    await command.execute(baseCreateInput, ctxFor(em))

    expect(created[0]).toMatchObject({ sequenceNumber: 143, reference: 'TT-143' })
  })

  it('honours an explicit status and assignee', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created } = makeHarness()

    await command.execute(
      { ...baseCreateInput, taskStatusId: DONE_ID, assigneeStaffMemberId: OTHER_MEMBER_ID },
      ctxFor(em),
    )

    expect(created[0]).toMatchObject({ taskStatusId: DONE_ID, assigneeStaffMemberId: OTHER_MEMBER_ID })
    // Created straight into a terminal column, so it is born closed.
    expect(created[0].closedAt).toBeInstanceOf(Date)
  })

  it('appends to the end of the target column on the gap grid', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created } = makeHarness({
      tasks: [taskRow({ id: LONE_TASK_ID, taskStatusId: BACKLOG_ID, position: 3000 })],
    })

    await command.execute(baseCreateInput, ctxFor(em))

    expect(created[0]).toMatchObject({ position: 4000 })
  })

  it('creates a subtask under a top-level parent', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created } = makeHarness({ tasks: [taskRow({ id: PARENT_TASK_ID })] })

    await command.execute({ ...baseCreateInput, parentTaskId: PARENT_TASK_ID }, ctxFor(em))

    expect(created[0]).toMatchObject({ parentTaskId: PARENT_TASK_ID })
  })

  it('refuses a parent that is itself a subtask', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
      ],
    })

    const { status, body } = await captureError(
      command.execute({ ...baseCreateInput, parentTaskId: CHILD_TASK_ID }, ctxFor(em)),
    )

    expect(status).toBe(400)
    expect(body.code).toBe('subtask_depth_exceeded')
    expect(body.fieldErrors?.parentTaskId).toBeTruthy()
  })

  it('refuses a parent from another project', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em } = makeHarness({
      tasks: [taskRow({ id: PARENT_TASK_ID, timeProjectId: OTHER_PROJECT_ID })],
    })

    const { status, body } = await captureError(
      command.execute({ ...baseCreateInput, parentTaskId: PARENT_TASK_ID }, ctxFor(em)),
    )

    expect(status).toBe(422)
    expect(body.code).toBe('task_parent_project_mismatch')
  })

  it('refuses a column that belongs to another project', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em } = makeHarness({
      statuses: [...board(), statusRow({ id: 'dddddddd-0000-4000-8000-000000000001', position: 1000, timeProjectId: OTHER_PROJECT_ID })],
    })

    const { status, body } = await captureError(
      command.execute({ ...baseCreateInput, taskStatusId: 'dddddddd-0000-4000-8000-000000000001' }, ctxFor(em)),
    )

    expect(status).toBe(422)
    expect(body.fieldErrors?.taskStatusId).toBeTruthy()
  })

  it('rejects a project the caller cannot reach', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em } = makeHarness({ projects: [] })

    const { status, body } = await captureError(command.execute(baseCreateInput, ctxFor(em)))

    expect(status).toBe(422)
    expect(body.fieldErrors?.timeProjectId).toBeTruthy()
  })

  it('re-reads the project counter and takes the next number when it loses the race', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created, tasks } = makeHarness({ conflictOnCreate: [0] })

    const result = await command.execute(baseCreateInput, ctxFor(em))

    expect(result).toEqual({ taskId: NEW_ID })
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ reference: 'TT-1' })
    expect(created[1]).toMatchObject({ sequenceNumber: 2, reference: 'TT-2' })
    expect(new Set(tasks.map((task) => task.reference)).size).toBe(tasks.length)
  })

  it('scopes every lookup to the caller tenant and organization', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, whereLog } = makeHarness()

    await command.execute(baseCreateInput, ctxFor(em))

    expect(whereLog.length).toBeGreaterThan(0)
    for (const entry of whereLog) {
      expect(entry.where).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
    }
  })

  it('refuses to create against another tenant scope', async () => {
    const command = await loadCommand('staff.timesheets.tasks.create')
    const { em, created } = makeHarness()

    const { status } = await captureError(
      command.execute(baseCreateInput, ctxFor(em, { tenantId: OTHER_TENANT_ID })),
    )

    expect(status).toBe(403)
    expect(created).toHaveLength(0)
  })
})

describe('staff.timesheets.tasks.update', () => {
  it('re-parents a task under a top-level task', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em, tasks } = makeHarness({
      tasks: [taskRow({ id: PARENT_TASK_ID }), taskRow({ id: LONE_TASK_ID, sequenceNumber: 2, reference: 'TT-2' })],
    })

    await command.execute({ id: LONE_TASK_ID, parentTaskId: PARENT_TASK_ID }, ctxFor(em))

    expect(tasks.find((task) => task.id === LONE_TASK_ID)?.parentTaskId).toBe(PARENT_TASK_ID)
  })

  it('refuses to re-parent under a task that already has a parent', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em, tasks } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
        taskRow({ id: LONE_TASK_ID, sequenceNumber: 3, reference: 'TT-3' }),
      ],
    })

    const { status, body } = await captureError(
      command.execute({ id: LONE_TASK_ID, parentTaskId: CHILD_TASK_ID }, ctxFor(em)),
    )

    expect(status).toBe(400)
    expect(body.code).toBe('subtask_depth_exceeded')
    expect(tasks.find((task) => task.id === LONE_TASK_ID)?.parentTaskId).toBeNull()
  })

  it('refuses to turn a task that already has children into a subtask', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
        taskRow({ id: LONE_TASK_ID, sequenceNumber: 3, reference: 'TT-3' }),
      ],
    })

    const { status, body } = await captureError(
      command.execute({ id: PARENT_TASK_ID, parentTaskId: LONE_TASK_ID }, ctxFor(em)),
    )

    expect(status).toBe(400)
    expect(body.code).toBe('subtask_depth_exceeded')
  })

  it('detaches a subtask back to the board', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em, tasks } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
      ],
    })

    await command.execute({ id: CHILD_TASK_ID, parentTaskId: null }, ctxFor(em))

    expect(tasks.find((task) => task.id === CHILD_TASK_ID)?.parentTaskId).toBeNull()
  })

  it('closes the task when it lands on a done column and re-opens it when it leaves', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em, tasks } = makeHarness({ tasks: [taskRow({ id: LONE_TASK_ID })] })

    await command.execute({ id: LONE_TASK_ID, taskStatusId: DONE_ID }, ctxFor(em))
    const closedAt = tasks[0].closedAt
    expect(closedAt).toBeInstanceOf(Date)

    await command.execute({ id: LONE_TASK_ID, taskStatusId: PROGRESS_ID }, ctxFor(em))
    expect(tasks[0].closedAt).toBeNull()
    expect(tasks[0].taskStatusId).toBe(PROGRESS_ID)
  })

  it('keeps the original closing time when moving between two done columns', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const closedAt = new Date('2026-07-20T10:00:00.000Z')
    const secondDoneId = 'aaaaaaaa-0000-4000-8000-000000000005'
    const { em, tasks } = makeHarness({
      statuses: [...board(), statusRow({ id: secondDoneId, position: 4000, isDone: true })],
      tasks: [taskRow({ id: LONE_TASK_ID, taskStatusId: DONE_ID, closedAt })],
    })

    await command.execute({ id: LONE_TASK_ID, taskStatusId: secondDoneId }, ctxFor(em))

    expect(tasks[0].closedAt).toBe(closedAt)
  })

  it('rejects a move to another project instead of silently ignoring it', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em, tasks } = makeHarness({ tasks: [taskRow({ id: LONE_TASK_ID })] })

    const { status, body } = await captureError(
      command.execute({ id: LONE_TASK_ID, timeProjectId: OTHER_PROJECT_ID, title: 'Moved' }, ctxFor(em)),
    )

    expect(status).toBe(400)
    expect(body.code).toBe('task_project_move_unsupported')
    expect(tasks[0].timeProjectId).toBe(PROJECT_ID)
    expect(tasks[0].title).toBe('Task')
  })

  it('accepts the task own project id as a no-op', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em, tasks } = makeHarness({ tasks: [taskRow({ id: LONE_TASK_ID })] })

    await command.execute({ id: LONE_TASK_ID, timeProjectId: PROJECT_ID, title: 'Renamed' }, ctxFor(em))

    expect(tasks[0].title).toBe('Renamed')
  })

  it('404s on a task outside the caller scope', async () => {
    const command = await loadCommand('staff.timesheets.tasks.update')
    const { em } = makeHarness({
      tasks: [taskRow({ id: LONE_TASK_ID, tenantId: OTHER_TENANT_ID })],
    })

    const { status } = await captureError(command.execute({ id: LONE_TASK_ID, title: 'Ghost' }, ctxFor(em)))

    expect(status).toBe(404)
  })
})

describe('staff.timesheets.tasks.delete', () => {
  it('takes the children with the parent and leaves time entries alone', async () => {
    const command = await loadCommand('staff.timesheets.tasks.delete')
    const { em, tasks, entries } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
        taskRow({ id: SECOND_CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 3, reference: 'TT-3' }),
        taskRow({ id: LONE_TASK_ID, sequenceNumber: 4, reference: 'TT-4' }),
      ],
      entries: [
        { id: 'eeeeeeee-0000-4000-8000-000000000001', taskId: PARENT_TASK_ID, deletedAt: null },
        { id: 'eeeeeeee-0000-4000-8000-000000000002', taskId: CHILD_TASK_ID, deletedAt: null },
      ],
    })

    const result = await command.execute({ id: PARENT_TASK_ID }, ctxFor(em))

    expect(result).toEqual({ taskId: PARENT_TASK_ID, childIds: [CHILD_TASK_ID, SECOND_CHILD_TASK_ID] })
    expect(tasks.find((task) => task.id === PARENT_TASK_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(tasks.find((task) => task.id === CHILD_TASK_ID)?.deletedAt).toBeInstanceOf(Date)
    expect(tasks.find((task) => task.id === SECOND_CHILD_TASK_ID)?.deletedAt).toBeInstanceOf(Date)
    // An unrelated task keeps standing, and no entry is touched — a closed report
    // still resolves its line labels.
    expect(tasks.find((task) => task.id === LONE_TASK_ID)?.deletedAt).toBeNull()
    expect(entries.every((entry) => entry.deletedAt === null)).toBe(true)
    expect(entries.map((entry) => entry.taskId)).toEqual([PARENT_TASK_ID, CHILD_TASK_ID])
  })

  it('emits one deletion side effect per removed task', async () => {
    const command = await loadCommand('staff.timesheets.tasks.delete')
    const { em } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
      ],
    })

    await command.execute({ id: PARENT_TASK_ID }, ctxFor(em))

    expect(mockEmitCrudSideEffects).toHaveBeenCalledTimes(2)
    expect(mockEmitCrudSideEffects.mock.calls.map(([call]) => call.identifiers.id)).toEqual([
      PARENT_TASK_ID,
      CHILD_TASK_ID,
    ])
  })

  it('deletes a subtask on its own', async () => {
    const command = await loadCommand('staff.timesheets.tasks.delete')
    const { em, tasks } = makeHarness({
      tasks: [
        taskRow({ id: PARENT_TASK_ID }),
        taskRow({ id: CHILD_TASK_ID, parentTaskId: PARENT_TASK_ID, sequenceNumber: 2, reference: 'TT-2' }),
      ],
    })

    const result = await command.execute({ id: CHILD_TASK_ID }, ctxFor(em))

    expect(result).toEqual({ taskId: CHILD_TASK_ID, childIds: [] })
    expect(tasks.find((task) => task.id === PARENT_TASK_ID)?.deletedAt).toBeNull()
  })

  it('404s on a task from another tenant', async () => {
    const command = await loadCommand('staff.timesheets.tasks.delete')
    const { em, tasks } = makeHarness({
      tasks: [taskRow({ id: PARENT_TASK_ID, tenantId: OTHER_TENANT_ID })],
    })

    const { status } = await captureError(command.execute({ id: PARENT_TASK_ID }, ctxFor(em)))

    expect(status).toBe(404)
    expect(tasks[0].deletedAt).toBeNull()
  })
})
