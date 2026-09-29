/** @jest-environment node */
// T3.4: tags are org-wide vocabulary, so the interesting behaviour is not the
// CRUD but the edges — a slug collision has to reach the form as a field error
// rather than a 500, deleting a tag cascades to its assignments and says how
// many it took with it, assigning a tag twice is a no-op success rather than a
// unique violation, and every path stays inside the caller's tenant.
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
const OTHER_TENANT_ID = '11111111-1111-4111-8111-1111111111ff'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const TASK_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_TASK_ID = '66666666-6666-4666-8666-6666666666ff'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const LOCKED_ENTRY_ID = '77777777-7777-4777-8777-7777777777ff'
const REPORT_ID = '88888888-8888-4888-8888-888888888888'
const NEW_ID = '55555555-5555-4555-8555-555555555555'

const BACKEND_TAG_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PRIORITY_TAG_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const FOREIGN_TAG_ID = 'aaaaaaaa-0000-4000-8000-0000000000ff'

type TagRow = {
  id: string
  tenantId: string
  organizationId: string
  slug: string
  label: string
  color: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type JunctionRow = {
  id: string
  tenantId: string
  organizationId: string
  tagId: string
  taskId?: string
  timeEntryId?: string
  createdAt: Date
}

type TaskRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  deletedAt: Date | null
}

type EntryRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string | null
  staffMemberId: string
  lockedReportId: string | null
  deletedAt: Date | null
}

function tag(overrides: Partial<TagRow> & Pick<TagRow, 'id' | 'slug'>): TagRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    label: overrides.slug,
    color: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

const UNIQUE_VIOLATION = Object.assign(new Error('duplicate key value violates unique constraint'), {
  code: '23505',
})

type WhereValue = unknown

function matchesValue(actual: unknown, expected: WhereValue): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    const operators = expected as Record<string, unknown>
    if ('$in' in operators) return (operators.$in as unknown[]).includes(actual)
    if ('$ne' in operators) return actual !== operators.$ne
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => matchesValue(row[key], expected))
}

type Tables = {
  tags: TagRow[]
  taskTags: JunctionRow[]
  entryTags: JunctionRow[]
  tasks: TaskRow[]
  entries: EntryRow[]
}

type Harness = {
  em: Record<string, jest.Mock>
  tables: Tables
  createdRows: Record<string, unknown>[]
}

function tableFor(tables: Tables, className: string): Record<string, unknown>[] {
  switch (className) {
    case 'StaffTimeTag':
      return tables.tags as unknown as Record<string, unknown>[]
    case 'StaffTimeTaskTag':
      return tables.taskTags as unknown as Record<string, unknown>[]
    case 'StaffTimeEntryTag':
      return tables.entryTags as unknown as Record<string, unknown>[]
    case 'StaffTimeTask':
      return tables.tasks as unknown as Record<string, unknown>[]
    case 'StaffTimeEntry':
      return tables.entries as unknown as Record<string, unknown>[]
    default:
      return []
  }
}

function makeHarness(
  overrides: Partial<Tables> = {},
  options: { flushError?: unknown; onFlushError?: (tables: Tables) => void } = {},
): Harness {
  const tables: Tables = {
    tags: overrides.tags ?? [],
    taskTags: overrides.taskTags ?? [],
    entryTags: overrides.entryTags ?? [],
    tasks: overrides.tasks ?? [
      { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null },
      {
        id: OTHER_TASK_ID,
        tenantId: OTHER_TENANT_ID,
        organizationId: ORG_ID,
        timeProjectId: PROJECT_ID,
        deletedAt: null,
      },
    ],
    entries: overrides.entries ?? [
      {
        id: ENTRY_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        timeProjectId: PROJECT_ID,
        staffMemberId: 'member-1',
        lockedReportId: null,
        deletedAt: null,
      },
      {
        id: LOCKED_ENTRY_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        timeProjectId: PROJECT_ID,
        staffMemberId: 'member-1',
        lockedReportId: REPORT_ID,
        deletedAt: null,
      },
    ],
  }

  const createdRows: Record<string, unknown>[] = []
  const pending: Array<{ className: string; row: Record<string, unknown> }> = []
  let flushErrorsLeft = options.flushError ? 1 : 0

  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) =>
      tableFor(tables, cls.name).filter((row) => matches(row, where)),
    ),
    findOne: jest.fn(
      async (cls: { name: string }, where: Record<string, unknown>) =>
        tableFor(tables, cls.name).find((row) => matches(row, where)) ?? null,
    ),
    count: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) =>
      tableFor(tables, cls.name).filter((row) => matches(row, where)).length,
    ),
    create: jest.fn((cls: { name: string }, data: Record<string, unknown>) => {
      const created = { id: NEW_ID, ...data }
      createdRows.push({ __entity: cls.name, ...created })
      pending.push({ className: cls.name, row: created })
      return created
    }),
    persist: jest.fn(),
    nativeDelete: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => {
      const table = tableFor(tables, cls.name)
      const doomed = table.filter((row) => matches(row, where))
      for (const row of doomed) table.splice(table.indexOf(row), 1)
      return doomed.length
    }),
    flush: jest.fn(async () => {
      if (flushErrorsLeft > 0) {
        flushErrorsLeft -= 1
        pending.length = 0
        options.onFlushError?.(tables)
        throw options.flushError
      }
      while (pending.length > 0) {
        const next = pending.shift()
        if (!next) break
        tableFor(tables, next.className).push(next.row)
      }
    }),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return { em, tables, createdRows }
}

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  prepare?: (input: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: unknown) => Promise<unknown>
  undo?: (args: unknown) => Promise<unknown>
}

async function loadCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-tags')
  return commandRegistry.get(id) as RegisteredCommand
}

function ctxFor(em: unknown, tenantId: string = TENANT_ID) {
  return {
    auth: { sub: 'user-1', tenantId, orgId: ORG_ID, roles: [], isSuperAdmin: false },
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

type ErrorBody = {
  code?: string
  error?: string
  fieldErrors?: Record<string, string>
  unknownIds?: string[]
  lockedReportId?: string
}

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

describe('staff.timesheets.tags.create', () => {
  const baseInput = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    slug: 'backend',
    label: 'backend',
  }

  it('creates the tag inside the caller scope', async () => {
    const command = await loadCommand('staff.timesheets.tags.create')
    const { em, createdRows } = makeHarness()

    const result = await command.execute({ ...baseInput, color: 'blue' }, ctxFor(em))

    expect(result).toEqual({ tagId: NEW_ID })
    expect(createdRows).toHaveLength(1)
    expect(createdRows[0]).toMatchObject({
      __entity: 'StaffTimeTag',
      slug: 'backend',
      label: 'backend',
      color: 'blue',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
  })

  it('answers a slug already used in the organization with a field error, not a 500', async () => {
    const command = await loadCommand('staff.timesheets.tags.create')
    const { em } = makeHarness({ tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] })

    const { status, body } = await captureError(command.execute(baseInput, ctxFor(em)))

    expect(status).toBe(409)
    expect(body.code).toBe('time_tag_slug_duplicate')
    expect(body.fieldErrors).toEqual({ slug: 'A tag with this slug already exists.' })
  })

  it('translates the unique index violation into the same field error', async () => {
    const command = await loadCommand('staff.timesheets.tags.create')
    const { em } = makeHarness({}, { flushError: UNIQUE_VIOLATION })

    const { status, body } = await captureError(command.execute(baseInput, ctxFor(em)))

    expect(status).toBe(409)
    expect(body.fieldErrors?.slug).toBeDefined()
  })

  it('lets a tag from another tenant keep the slug', async () => {
    const command = await loadCommand('staff.timesheets.tags.create')
    const { em, createdRows } = makeHarness({
      tags: [tag({ id: FOREIGN_TAG_ID, slug: 'backend', tenantId: OTHER_TENANT_ID })],
    })

    await command.execute(baseInput, ctxFor(em))

    expect(createdRows).toHaveLength(1)
  })
})

describe('staff.timesheets.tags.update', () => {
  it('renames and recolours the tag', async () => {
    const command = await loadCommand('staff.timesheets.tags.update')
    const { em, tables } = makeHarness({ tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] })

    const result = await command.execute(
      { id: BACKEND_TAG_ID, label: 'Backend', color: 'purple' },
      ctxFor(em),
    )

    expect(result).toEqual({ tagId: BACKEND_TAG_ID })
    expect(tables.tags[0]).toMatchObject({ label: 'Backend', color: 'purple', slug: 'backend' })
  })

  it('answers a slug taken by a sibling tag with a field error', async () => {
    const command = await loadCommand('staff.timesheets.tags.update')
    const { em } = makeHarness({
      tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' }), tag({ id: PRIORITY_TAG_ID, slug: 'priority' })],
    })

    const { status, body } = await captureError(
      command.execute({ id: PRIORITY_TAG_ID, slug: 'backend' }, ctxFor(em)),
    )

    expect(status).toBe(409)
    expect(body.fieldErrors).toEqual({ slug: 'A tag with this slug already exists.' })
  })

  it('refuses a tag owned by another tenant with the generic 404', async () => {
    const command = await loadCommand('staff.timesheets.tags.update')
    const { em } = makeHarness({ tags: [tag({ id: FOREIGN_TAG_ID, slug: 'backend', tenantId: OTHER_TENANT_ID })] })

    const { status, body } = await captureError(
      command.execute({ id: FOREIGN_TAG_ID, label: 'stolen' }, ctxFor(em)),
    )

    expect(status).toBe(404)
    expect(body.error).toBe('Tag not found or not accessible.')
  })
})

describe('staff.timesheets.tags.delete', () => {
  function harnessWithAssignments() {
    return makeHarness({
      tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })],
      taskTags: [
        {
          id: 'j1',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          tagId: BACKEND_TAG_ID,
          taskId: TASK_ID,
          createdAt: new Date(),
        },
      ],
      entryTags: [
        {
          id: 'j2',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          tagId: BACKEND_TAG_ID,
          timeEntryId: ENTRY_ID,
          createdAt: new Date(),
        },
        {
          id: 'j3',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          tagId: BACKEND_TAG_ID,
          timeEntryId: LOCKED_ENTRY_ID,
          createdAt: new Date(),
        },
      ],
    })
  }

  it('cascades to every assignment and reports how many it removed', async () => {
    const command = await loadCommand('staff.timesheets.tags.delete')
    const { em, tables } = harnessWithAssignments()

    const result = await command.execute({ id: BACKEND_TAG_ID }, ctxFor(em))

    expect(result).toEqual({ tagId: BACKEND_TAG_ID, removedTaskAssignments: 1, removedEntryAssignments: 2 })
    expect(tables.taskTags).toHaveLength(0)
    expect(tables.entryTags).toHaveLength(0)
    expect(tables.tags[0].deletedAt).toBeInstanceOf(Date)
  })

  it('captures the removed assignments so undo can put them back', async () => {
    const command = await loadCommand('staff.timesheets.tags.delete')
    const { em } = harnessWithAssignments()

    const snapshots = (await command.prepare?.({ id: BACKEND_TAG_ID }, ctxFor(em))) as {
      before?: { taskAssignments?: unknown[]; entryAssignments?: unknown[] }
    }

    expect(snapshots.before?.taskAssignments).toHaveLength(1)
    expect(snapshots.before?.entryAssignments).toHaveLength(2)
  })

  it('restores the tag and its assignments on undo', async () => {
    const command = await loadCommand('staff.timesheets.tags.delete')
    const { em, tables } = harnessWithAssignments()
    const snapshots = (await command.prepare?.({ id: BACKEND_TAG_ID }, ctxFor(em))) as Record<string, unknown>
    const result = await command.execute({ id: BACKEND_TAG_ID }, ctxFor(em))
    const logEntry = await command.buildLog?.({ result, snapshots, ctx: ctxFor(em), input: { id: BACKEND_TAG_ID } })

    await command.undo?.({ logEntry, ctx: ctxFor(em) })

    expect(tables.tags[0].deletedAt).toBeNull()
    expect(tables.taskTags).toHaveLength(1)
    expect(tables.entryTags).toHaveLength(2)
  })

  it('refuses a tag owned by another tenant', async () => {
    const command = await loadCommand('staff.timesheets.tags.delete')
    const { em, tables } = makeHarness({
      tags: [tag({ id: FOREIGN_TAG_ID, slug: 'backend', tenantId: OTHER_TENANT_ID })],
    })

    const { status } = await captureError(command.execute({ id: FOREIGN_TAG_ID }, ctxFor(em)))

    expect(status).toBe(404)
    expect(tables.tags[0].deletedAt).toBeNull()
  })
})

describe('staff.timesheets.tags.assign_task', () => {
  const baseInput = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    taskId: TASK_ID,
    tagIds: [BACKEND_TAG_ID],
  }

  function harness() {
    return makeHarness({
      tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' }), tag({ id: PRIORITY_TAG_ID, slug: 'priority' })],
    })
  }

  it('assigns the requested tags', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_task')
    const { em, tables } = harness()

    const result = await command.execute(baseInput, ctxFor(em))

    expect(result).toMatchObject({
      targetId: TASK_ID,
      assignedTagIds: [BACKEND_TAG_ID],
      alreadyAssignedTagIds: [],
    })
    expect(tables.taskTags).toHaveLength(1)
  })

  it('is idempotent — assigning an already assigned tag is a no-op success', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_task')
    const { em, tables } = harness()

    await command.execute(baseInput, ctxFor(em))
    const second = await command.execute(baseInput, ctxFor(em))

    expect(second).toMatchObject({
      assignedTagIds: [],
      alreadyAssignedTagIds: [BACKEND_TAG_ID],
      tagIds: [BACKEND_TAG_ID],
    })
    expect(tables.taskTags).toHaveLength(1)
  })

  it('turns a lost race against a concurrent assign into the same no-op success', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_task')
    const { em, tables } = makeHarness(
      { tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] },
      {
        flushError: UNIQUE_VIOLATION,
        // The racer committed the row the moment this insert hit the index.
        onFlushError: (state) => {
          state.taskTags.push({
            id: 'winner',
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            tagId: BACKEND_TAG_ID,
            taskId: TASK_ID,
            createdAt: new Date(),
          })
        },
      },
    )

    const result = await command.execute(baseInput, ctxFor(em))

    expect(result).toMatchObject({
      assignedTagIds: [],
      alreadyAssignedTagIds: [BACKEND_TAG_ID],
      tagIds: [BACKEND_TAG_ID],
    })
    expect(tables.taskTags).toHaveLength(1)
  })

  it('rejects tag ids that do not exist in the organization', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_task')
    const { em, tables } = harness()

    const { status, body } = await captureError(
      command.execute({ ...baseInput, tagIds: [BACKEND_TAG_ID, FOREIGN_TAG_ID] }, ctxFor(em)),
    )

    expect(status).toBe(422)
    expect(body.code).toBe('time_tag_unknown_ids')
    expect(body.unknownIds).toEqual([FOREIGN_TAG_ID])
    expect(body.fieldErrors?.tagIds).toBeDefined()
    expect(tables.taskTags).toHaveLength(0)
  })

  it('refuses a task from another tenant without confirming that it exists', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_task')
    const { em, tables } = harness()

    const { status, body } = await captureError(
      command.execute({ ...baseInput, taskId: OTHER_TASK_ID }, ctxFor(em)),
    )

    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Task not found or not accessible.' })
    expect(tables.taskTags).toHaveLength(0)
  })

  it('removes only the rows it added when undone', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_task')
    const { em, tables } = harness()
    tables.taskTags.push({
      id: 'existing',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      tagId: PRIORITY_TAG_ID,
      taskId: TASK_ID,
      createdAt: new Date(),
    })

    const snapshots = (await command.prepare?.(baseInput, ctxFor(em))) as Record<string, unknown>
    const result = await command.execute(baseInput, ctxFor(em))
    const logEntry = await command.buildLog?.({ result, snapshots, ctx: ctxFor(em), input: baseInput })
    await command.undo?.({ logEntry, ctx: ctxFor(em) })

    expect(tables.taskTags).toHaveLength(1)
    expect(tables.taskTags[0].tagId).toBe(PRIORITY_TAG_ID)
  })
})

describe('staff.timesheets.tags.unassign_task', () => {
  it('removes the assignment', async () => {
    const command = await loadCommand('staff.timesheets.tags.unassign_task')
    const { em, tables } = makeHarness({
      tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })],
      taskTags: [
        {
          id: 'j1',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          tagId: BACKEND_TAG_ID,
          taskId: TASK_ID,
          createdAt: new Date(),
        },
      ],
    })

    const result = await command.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, taskId: TASK_ID, tagIds: [BACKEND_TAG_ID] },
      ctxFor(em),
    )

    expect(result).toMatchObject({ removedTagIds: [BACKEND_TAG_ID], notAssignedTagIds: [], tagIds: [] })
    expect(tables.taskTags).toHaveLength(0)
  })

  it('treats unassigning a tag that is not assigned as a no-op', async () => {
    const command = await loadCommand('staff.timesheets.tags.unassign_task')
    const { em, tables } = makeHarness({ tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] })

    const result = await command.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, taskId: TASK_ID, tagIds: [BACKEND_TAG_ID] },
      ctxFor(em),
    )

    expect(result).toMatchObject({ removedTagIds: [], notAssignedTagIds: [BACKEND_TAG_ID] })
    expect(tables.taskTags).toHaveLength(0)
  })

  it('puts the removed assignment back on undo', async () => {
    const command = await loadCommand('staff.timesheets.tags.unassign_task')
    const input = { tenantId: TENANT_ID, organizationId: ORG_ID, taskId: TASK_ID, tagIds: [BACKEND_TAG_ID] }
    const { em, tables } = makeHarness({
      tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })],
      taskTags: [
        {
          id: 'j1',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          tagId: BACKEND_TAG_ID,
          taskId: TASK_ID,
          createdAt: new Date(),
        },
      ],
    })

    const snapshots = (await command.prepare?.(input, ctxFor(em))) as Record<string, unknown>
    const result = await command.execute(input, ctxFor(em))
    const logEntry = await command.buildLog?.({ result, snapshots, ctx: ctxFor(em), input })
    await command.undo?.({ logEntry, ctx: ctxFor(em) })

    expect(tables.taskTags).toHaveLength(1)
    expect(tables.taskTags[0].tagId).toBe(BACKEND_TAG_ID)
  })
})

describe('staff.timesheets.tags.assign_entry', () => {
  const baseInput = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeEntryId: ENTRY_ID,
    tagIds: [BACKEND_TAG_ID],
  }

  it('assigns and stays idempotent on a repeat', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_entry')
    const { em, tables } = makeHarness({ tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] })

    await command.execute(baseInput, ctxFor(em))
    const second = await command.execute(baseInput, ctxFor(em))

    expect(second).toMatchObject({ assignedTagIds: [], alreadyAssignedTagIds: [BACKEND_TAG_ID] })
    expect(tables.entryTags).toHaveLength(1)
  })

  it('refuses an entry frozen in a closed report', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_entry')
    const { em, tables } = makeHarness({ tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] })

    const { status, body } = await captureError(
      command.execute({ ...baseInput, timeEntryId: LOCKED_ENTRY_ID }, ctxFor(em)),
    )

    expect(status).toBe(409)
    expect(body.code).toBe('time_entry_locked')
    expect(body.lockedReportId).toBe(REPORT_ID)
    expect(tables.entryTags).toHaveLength(0)
  })

  it('refuses an entry outside the caller tenant with the generic 404', async () => {
    const command = await loadCommand('staff.timesheets.tags.assign_entry')
    const { em, tables } = makeHarness({
      tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend', tenantId: OTHER_TENANT_ID })],
      entries: [
        {
          id: ENTRY_ID,
          tenantId: OTHER_TENANT_ID,
          organizationId: ORG_ID,
          timeProjectId: PROJECT_ID,
          staffMemberId: 'member-9',
          lockedReportId: null,
          deletedAt: null,
        },
      ],
    })

    const { status, body } = await captureError(command.execute(baseInput, ctxFor(em)))

    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Time entry not found or not accessible.' })
    expect(tables.entryTags).toHaveLength(0)
  })
})

describe('staff.timesheets.tags.unassign_entry', () => {
  it('is a no-op for a tag the entry never carried', async () => {
    const command = await loadCommand('staff.timesheets.tags.unassign_entry')
    const { em, tables } = makeHarness({ tags: [tag({ id: BACKEND_TAG_ID, slug: 'backend' })] })

    const result = await command.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, timeEntryId: ENTRY_ID, tagIds: [BACKEND_TAG_ID] },
      ctxFor(em),
    )

    expect(result).toMatchObject({ removedTagIds: [], notAssignedTagIds: [BACKEND_TAG_ID] })
    expect(tables.entryTags).toHaveLength(0)
  })
})
