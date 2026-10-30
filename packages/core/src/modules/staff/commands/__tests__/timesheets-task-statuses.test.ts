/** @jest-environment node */
// T3.1 (D-1): the Kanban columns are per-project configuration, and the board
// invariants are enforced here rather than trusted from the request — a project
// always keeps at least one column, exactly one default and at least one done
// column, and a column holding tasks is never dropped.
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

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const NEW_ID = '55555555-5555-4555-8555-555555555555'

const BACKLOG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROGRESS_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const REVIEW_ID = 'aaaaaaaa-0000-4000-8000-000000000003'
const DONE_ID = 'aaaaaaaa-0000-4000-8000-000000000004'

type StatusRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  name: string
  slug: string
  color: string | null
  position: number
  isDefault: boolean
  isDone: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function row(overrides: Partial<StatusRow> & Pick<StatusRow, 'id' | 'slug' | 'position'>): StatusRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: PROJECT_ID,
    name: overrides.slug,
    color: null,
    isDefault: false,
    isDone: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function fourColumnBoard(): StatusRow[] {
  return [
    row({ id: BACKLOG_ID, slug: 'backlog', position: 1000, isDefault: true }),
    row({ id: PROGRESS_ID, slug: 'in-progress', position: 2000 }),
    row({ id: REVIEW_ID, slug: 'in-review', position: 3000 }),
    row({ id: DONE_ID, slug: 'done', position: 4000, isDone: true }),
  ]
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-task-statuses')
  return commandRegistry.get(id) as RegisteredCommand
}

type Harness = {
  em: Record<string, jest.Mock>
  createdRows: Record<string, unknown>[]
}

function makeHarness(options: {
  board?: StatusRow[]
  projectExists?: boolean
  taskCount?: number
}): Harness {
  const board = options.board ?? []
  const createdRows: Record<string, unknown>[] = []
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      if (cls.name !== 'StaffTimeTaskStatus') return []
      const ids = (where.id as { $in?: string[] } | undefined)?.$in
      if (ids) return board.filter((entry) => ids.includes(entry.id))
      return board.filter((entry) => entry.deletedAt === null)
    }),
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      if (cls.name === 'StaffTimeProject') return options.projectExists === false ? null : { id: PROJECT_ID }
      return board.find((entry) => entry.id === where.id && entry.deletedAt === null) ?? null
    }),
    count: jest.fn(async () => options.taskCount ?? 0),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => {
      const created = { id: NEW_ID, ...data }
      createdRows.push(created)
      return created
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return { em, createdRows }
}

function ctxFor(em: unknown) {
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID, roles: [], isSuperAdmin: false },
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

type ErrorBody = { code?: string; taskCount?: number; fieldErrors?: Record<string, string>; unknownIds?: string[] }

async function captureError(promise: Promise<unknown>): Promise<{ status: number; body: ErrorBody }> {
  try {
    await promise
  } catch (err) {
    const typed = err as { status?: number; body?: ErrorBody }
    return { status: typed.status ?? 0, body: typed.body ?? {} }
  }
  throw new Error('[internal] expected the command to reject')
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEmitCrudSideEffects.mockResolvedValue(undefined)
})

describe('staff.timesheets.task_statuses.create', () => {
  const baseInput = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: PROJECT_ID,
    name: 'Zablokowane',
  }

  it('appends the column one gap past the right-most one and derives its slug', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.create')
    const { em, createdRows } = makeHarness({ board: fourColumnBoard() })

    const result = await command.execute(baseInput, ctxFor(em))

    expect(result).toEqual({ taskStatusId: NEW_ID })
    expect(createdRows).toHaveLength(1)
    expect(createdRows[0]).toMatchObject({
      slug: 'zablokowane',
      position: 5000,
      isDefault: false,
      isDone: false,
      timeProjectId: PROJECT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('forces the first column of an empty board to be both default and done', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.create')
    const { em, createdRows } = makeHarness({ board: [] })

    await command.execute({ ...baseInput, isDefault: false, isDone: false }, ctxFor(em))

    expect(createdRows[0]).toMatchObject({ position: 1000, isDefault: true, isDone: true })
  })

  it('moves the default off the previous column when the new one claims it', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.create')
    const board = fourColumnBoard()
    const { em, createdRows } = makeHarness({ board })

    await command.execute({ ...baseInput, isDefault: true }, ctxFor(em))

    expect(createdRows[0]).toMatchObject({ isDefault: true })
    expect(board.filter((entry) => entry.isDefault)).toHaveLength(0)
  })

  it('refuses a slug that already exists on the project as a field error', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.create')
    const { em } = makeHarness({ board: fourColumnBoard() })

    const { status, body } = await captureError(
      command.execute({ ...baseInput, name: 'Done', slug: 'done' }, ctxFor(em)),
    )

    expect(status).toBe(409)
    expect(body.code).toBe('task_status_slug_duplicate')
    expect(body.fieldErrors?.slug).toBeTruthy()
  })

  it('suffixes a derived slug rather than colliding with an existing column', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.create')
    const { em, createdRows } = makeHarness({ board: fourColumnBoard() })

    await command.execute({ ...baseInput, name: 'Done' }, ctxFor(em))

    expect(createdRows[0]).toMatchObject({ slug: 'done-2' })
  })

  it('rejects a project the caller cannot reach', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.create')
    const { em } = makeHarness({ board: [], projectExists: false })

    const { status, body } = await captureError(command.execute(baseInput, ctxFor(em)))

    expect(status).toBe(422)
    expect(body.fieldErrors?.timeProjectId).toBeTruthy()
  })
})

describe('staff.timesheets.task_statuses.update', () => {
  it('re-orders the board by writing only the dragged column', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    await command.execute({ id: DONE_ID, position: 1500 }, ctxFor(em))

    expect(board.map((entry) => [entry.slug, entry.position])).toEqual([
      ['backlog', 1000],
      ['in-progress', 2000],
      ['in-review', 3000],
      ['done', 1500],
    ])
  })

  it('compacts the board when the drop leaves no integer between neighbours', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const board = [
      row({ id: BACKLOG_ID, slug: 'backlog', position: 1000, isDefault: true }),
      row({ id: PROGRESS_ID, slug: 'in-progress', position: 1001 }),
      row({ id: DONE_ID, slug: 'done', position: 1002, isDone: true }),
    ]
    const { em } = makeHarness({ board })

    await command.execute({ id: DONE_ID, position: 1000 }, ctxFor(em))

    expect(board.map((entry) => [entry.slug, entry.position])).toEqual([
      ['backlog', 2000],
      ['in-progress', 3000],
      ['done', 1000],
    ])
  })

  it('hands the default to the column that claims it', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    await command.execute({ id: PROGRESS_ID, isDefault: true }, ctxFor(em))

    expect(board.filter((entry) => entry.isDefault).map((entry) => entry.slug)).toEqual(['in-progress'])
  })

  it('refuses to leave the project without a default column', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const { em } = makeHarness({ board: fourColumnBoard() })

    const { status, body } = await captureError(command.execute({ id: BACKLOG_ID, isDefault: false }, ctxFor(em)))

    expect(status).toBe(409)
    expect(body.code).toBe('task_status_default_required')
  })

  it('refuses to clear the last done column', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const { em } = makeHarness({ board: fourColumnBoard() })

    const { status, body } = await captureError(command.execute({ id: DONE_ID, isDone: false }, ctxFor(em)))

    expect(status).toBe(409)
    expect(body.code).toBe('task_status_done_required')
  })

  it('allows clearing a done column while another one remains terminal', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const board = fourColumnBoard()
    board[2].isDone = true
    const { em } = makeHarness({ board })

    await command.execute({ id: REVIEW_ID, isDone: false }, ctxFor(em))

    expect(board.filter((entry) => entry.isDone).map((entry) => entry.slug)).toEqual(['done'])
  })

  it('renames and recolours without touching the ordering', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    await command.execute({ id: REVIEW_ID, name: 'Do przeglądu', color: 'orange' }, ctxFor(em))

    expect(board[2]).toMatchObject({ name: 'Do przeglądu', color: 'orange', slug: 'in-review', position: 3000 })
  })

  it('404s on a column outside the caller scope', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.update')
    const { em } = makeHarness({ board: [] })

    const { status } = await captureError(command.execute({ id: DONE_ID, name: 'Ghost' }, ctxFor(em)))

    expect(status).toBe(404)
  })
})

describe('staff.timesheets.task_statuses.delete', () => {
  it('refuses to remove the last remaining column', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.delete')
    const board = [row({ id: BACKLOG_ID, slug: 'backlog', position: 1000, isDefault: true, isDone: true })]
    const { em } = makeHarness({ board })

    const { status, body } = await captureError(command.execute({ id: BACKLOG_ID }, ctxFor(em)))

    expect(status).toBe(409)
    expect(body.code).toBe('task_status_last_column')
    expect(board[0].deletedAt).toBeNull()
  })

  it('refuses a column that still holds tasks and names the count', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.delete')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board, taskCount: 7 })

    const { status, body } = await captureError(command.execute({ id: PROGRESS_ID }, ctxFor(em)))

    expect(status).toBe(409)
    expect(body.code).toBe('task_status_has_tasks')
    expect(body.taskCount).toBe(7)
    expect(board[1].deletedAt).toBeNull()
  })

  it('soft-deletes an empty column', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.delete')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    const result = await command.execute({ id: REVIEW_ID }, ctxFor(em))

    expect(result).toEqual({ taskStatusId: REVIEW_ID })
    expect(board[2].deletedAt).toBeInstanceOf(Date)
  })

  it('promotes a survivor when the default column is removed', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.delete')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    await command.execute({ id: BACKLOG_ID }, ctxFor(em))

    const survivors = board.filter((entry) => entry.id !== BACKLOG_ID)
    expect(survivors.filter((entry) => entry.isDefault).map((entry) => entry.slug)).toEqual(['in-progress'])
  })

  it('promotes a survivor when the only done column is removed', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.delete')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    await command.execute({ id: DONE_ID }, ctxFor(em))

    const survivors = board.filter((entry) => entry.id !== DONE_ID)
    expect(survivors.filter((entry) => entry.isDone).map((entry) => entry.slug)).toEqual(['in-review'])
  })
})

describe('staff.timesheets.task_statuses.reorder', () => {
  it('writes only the columns whose stored position changes', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.reorder')
    const board = fourColumnBoard()
    const { em } = makeHarness({ board })

    const result = (await command.execute(
      {
        timeProjectId: PROJECT_ID,
        statuses: [
          { id: BACKLOG_ID, position: 1000 },
          { id: PROGRESS_ID, position: 2500 },
        ],
      },
      ctxFor(em),
    )) as { updatedIds: string[]; compacted: boolean }

    expect(result.updatedIds).toEqual([PROGRESS_ID])
    expect(result.compacted).toBe(false)
    expect(board[1].position).toBe(2500)
  })

  it('rejects ids that do not belong to the project', async () => {
    const command = await loadCommand('staff.timesheets.task_statuses.reorder')
    const { em } = makeHarness({ board: fourColumnBoard() })

    const { status, body } = await captureError(
      command.execute(
        {
          timeProjectId: PROJECT_ID,
          statuses: [{ id: '99999999-9999-4999-8999-999999999999', position: 1500 }],
        },
        ctxFor(em),
      ),
    )

    expect(status).toBe(422)
    expect(body.code).toBe('task_status_unknown_ids')
    expect(body.unknownIds).toEqual(['99999999-9999-4999-8999-999999999999'])
  })
})
