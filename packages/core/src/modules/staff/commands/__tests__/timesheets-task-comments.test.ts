/** @jest-environment node */
// T3.4b. A comment thread is only a record if the two things rendered beside the
// body are facts, so these tests pin the two rules that make them facts: the
// author is stamped from the authenticated caller and never read from input, and
// only that author (or a `staff.timesheets.manage_all` holder) may rewrite or
// remove what they wrote. Delete is soft, so the row — and the undo payload that
// points at it — survives.
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
const FOREIGN_TASK_ID = '66666666-6666-4666-8666-6666666666ff'
const NEW_ID = '55555555-5555-4555-8555-555555555555'

const AUTHOR_USER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_USER_ID = '99999999-9999-4999-8999-9999999999ff'
const SPOOFED_USER_ID = '99999999-9999-4999-8999-999999999aaa'

const COMMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001'

const CREATE_ID = 'staff.timesheets.task_comments.create'
const UPDATE_ID = 'staff.timesheets.task_comments.update'
const DELETE_ID = 'staff.timesheets.task_comments.delete'

type CommentRow = {
  id: string
  tenantId: string
  organizationId: string
  taskId: string
  body: string
  authorUserId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type TaskRow = {
  id: string
  tenantId: string
  organizationId: string
  timeProjectId: string
  deletedAt: Date | null
}

function comment(overrides: Partial<CommentRow> & Pick<CommentRow, 'id'>): CommentRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    taskId: TASK_ID,
    body: 'Klient prosi o rabaty od ceny netto.',
    authorUserId: AUTHOR_USER_ID,
    createdAt: new Date('2026-07-17T14:22:00.000Z'),
    updatedAt: new Date('2026-07-17T14:22:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function matchesValue(actual: unknown, expected: unknown): boolean {
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

type Tables = { comments: CommentRow[]; tasks: TaskRow[] }

function tableFor(tables: Tables, className: string): Record<string, unknown>[] {
  if (className === 'StaffTimeTaskComment') return tables.comments as unknown as Record<string, unknown>[]
  if (className === 'StaffTimeTask') return tables.tasks as unknown as Record<string, unknown>[]
  return []
}

function makeHarness(overrides: Partial<Tables> = {}) {
  const tables: Tables = {
    comments: overrides.comments ?? [],
    tasks: overrides.tasks ?? [
      { id: TASK_ID, tenantId: TENANT_ID, organizationId: ORG_ID, timeProjectId: PROJECT_ID, deletedAt: null },
      {
        id: FOREIGN_TASK_ID,
        tenantId: OTHER_TENANT_ID,
        organizationId: ORG_ID,
        timeProjectId: PROJECT_ID,
        deletedAt: null,
      },
    ],
  }

  const createdRows: Record<string, unknown>[] = []
  const pending: Array<{ className: string; row: Record<string, unknown> }> = []

  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) =>
      tableFor(tables, cls.name).filter((row) => matches(row, where)),
    ),
    findOne: jest.fn(
      async (cls: { name: string }, where: Record<string, unknown>) =>
        tableFor(tables, cls.name).find((row) => matches(row, where)) ?? null,
    ),
    create: jest.fn((cls: { name: string }, data: Record<string, unknown>) => {
      const created = { id: NEW_ID, ...data }
      createdRows.push({ __entity: cls.name, ...created })
      pending.push({ className: cls.name, row: created })
      return created
    }),
    persist: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    flush: jest.fn(async () => {
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
  captureAfter?: (input: unknown, result: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: unknown) => Promise<unknown>
  undo?: (args: unknown) => Promise<unknown>
}

async function loadCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-task-comments')
  return commandRegistry.get(id) as RegisteredCommand
}

function ctxFor(
  em: unknown,
  options: { userId?: string; tenantId?: string; grantedFeatures?: string[] } = {},
) {
  return {
    auth: {
      sub: options.userId ?? AUTHOR_USER_ID,
      tenantId: options.tenantId ?? TENANT_ID,
      orgId: ORG_ID,
      roles: [],
      isSuperAdmin: false,
    },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        if (name === 'rbacService') {
          return { getGrantedFeatures: jest.fn(async () => options.grantedFeatures ?? []) }
        }
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer,
  }
}

type ErrorBody = { code?: string; error?: string }

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

describe(CREATE_ID, () => {
  const baseInput = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    taskId: TASK_ID,
    body: 'Poprawione, testy przechodzą.',
  }

  it('stamps the authenticated caller as the author', async () => {
    const command = await loadCommand(CREATE_ID)
    const { em, createdRows } = makeHarness()

    const result = (await command.execute(baseInput, ctxFor(em))) as { authorUserId: string | null }

    expect(result.authorUserId).toBe(AUTHOR_USER_ID)
    expect(createdRows[0]).toMatchObject({
      __entity: 'StaffTimeTaskComment',
      taskId: TASK_ID,
      authorUserId: AUTHOR_USER_ID,
      body: 'Poprawione, testy przechodzą.',
    })
  })

  it('ignores a client-supplied authorUserId', async () => {
    const command = await loadCommand(CREATE_ID)
    const { em, createdRows } = makeHarness()

    const result = (await command.execute(
      { ...baseInput, authorUserId: SPOOFED_USER_ID },
      ctxFor(em),
    )) as { authorUserId: string | null }

    expect(result.authorUserId).toBe(AUTHOR_USER_ID)
    expect(createdRows[0]).toMatchObject({ authorUserId: AUTHOR_USER_ID })
    expect(createdRows[0]).not.toMatchObject({ authorUserId: SPOOFED_USER_ID })
  })

  it('refuses a task belonging to another tenant', async () => {
    const command = await loadCommand(CREATE_ID)
    const { em, tables } = makeHarness()

    const failure = await captureError(
      command.execute({ ...baseInput, taskId: FOREIGN_TASK_ID }, ctxFor(em)),
    )

    expect(failure.status).toBe(404)
    expect(tables.comments).toHaveLength(0)
  })
})

describe(UPDATE_ID, () => {
  it('lets the author rewrite their own comment', async () => {
    const command = await loadCommand(UPDATE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })

    await command.execute({ id: COMMENT_ID, body: 'Zaktualizowana treść.' }, ctxFor(em))

    expect(tables.comments[0].body).toBe('Zaktualizowana treść.')
  })

  it('refuses a non-author without staff.timesheets.manage_all', async () => {
    const command = await loadCommand(UPDATE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })

    const failure = await captureError(
      command.execute({ id: COMMENT_ID, body: 'Cudza treść.' }, ctxFor(em, { userId: OTHER_USER_ID })),
    )

    expect(failure.status).toBe(403)
    expect(failure.body.code).toBe('task_comment_not_author')
    expect(tables.comments[0].body).toBe('Klient prosi o rabaty od ceny netto.')
  })

  it('lets a staff.timesheets.manage_all holder edit someone else\'s comment', async () => {
    const command = await loadCommand(UPDATE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })

    await command.execute(
      { id: COMMENT_ID, body: 'Poprawione przez managera.' },
      ctxFor(em, { userId: OTHER_USER_ID, grantedFeatures: ['staff.timesheets.manage_all'] }),
    )

    expect(tables.comments[0].body).toBe('Poprawione przez managera.')
  })

  it('honours a wildcard grant the same way as the concrete feature', async () => {
    const command = await loadCommand(UPDATE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })

    await command.execute(
      { id: COMMENT_ID, body: 'Wildcard.' },
      ctxFor(em, { userId: OTHER_USER_ID, grantedFeatures: ['staff.timesheets.*'] }),
    )

    expect(tables.comments[0].body).toBe('Wildcard.')
  })

  it('restores the previous body on undo', async () => {
    const command = await loadCommand(UPDATE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })
    const ctx = ctxFor(em)

    const snapshots = (await command.prepare?.({ id: COMMENT_ID, body: 'Nowa treść.' }, ctx)) as {
      before?: unknown
    }
    await command.execute({ id: COMMENT_ID, body: 'Nowa treść.' }, ctx)
    expect(tables.comments[0].body).toBe('Nowa treść.')

    const logEntry = (await command.buildLog?.({
      input: { id: COMMENT_ID, body: 'Nowa treść.' },
      result: { commentId: COMMENT_ID, taskId: TASK_ID },
      snapshots,
      ctx,
    })) as { payload?: Record<string, unknown> } | null

    await command.undo?.({ logEntry, ctx })

    expect(tables.comments[0].body).toBe('Klient prosi o rabaty od ceny netto.')
  })
})

describe(DELETE_ID, () => {
  it('soft-deletes so the row survives for the audit trail', async () => {
    const command = await loadCommand(DELETE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })

    await command.execute({ id: COMMENT_ID }, ctxFor(em))

    expect(tables.comments).toHaveLength(1)
    expect(tables.comments[0].deletedAt).toBeInstanceOf(Date)
    expect(tables.comments[0].body).toBe('Klient prosi o rabaty od ceny netto.')
  })

  it('refuses a non-author without staff.timesheets.manage_all', async () => {
    const command = await loadCommand(DELETE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })

    const failure = await captureError(
      command.execute({ id: COMMENT_ID }, ctxFor(em, { userId: OTHER_USER_ID })),
    )

    expect(failure.status).toBe(403)
    expect(tables.comments[0].deletedAt).toBeNull()
  })

  it('does not reach another tenant\'s comment', async () => {
    const command = await loadCommand(DELETE_ID)
    const { em } = makeHarness({
      comments: [comment({ id: COMMENT_ID, tenantId: OTHER_TENANT_ID })],
    })

    const failure = await captureError(command.execute({ id: COMMENT_ID }, ctxFor(em)))

    expect(failure.status).toBe(404)
  })

  it('brings the comment back on undo', async () => {
    const command = await loadCommand(DELETE_ID)
    const { em, tables } = makeHarness({ comments: [comment({ id: COMMENT_ID })] })
    const ctx = ctxFor(em)

    const snapshots = (await command.prepare?.({ id: COMMENT_ID }, ctx)) as { before?: unknown }
    await command.execute({ id: COMMENT_ID }, ctx)

    const logEntry = (await command.buildLog?.({
      input: { id: COMMENT_ID },
      result: { commentId: COMMENT_ID, taskId: TASK_ID },
      snapshots,
      ctx,
    })) as { payload?: Record<string, unknown> } | null

    await command.undo?.({ logEntry, ctx })

    expect(tables.comments[0].deletedAt).toBeNull()
    expect(tables.comments[0].body).toBe('Klient prosi o rabaty od ceny netto.')
  })
})
