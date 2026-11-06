/** @jest-environment node */
import type { AwilixContainer } from 'awilix'

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: { find: Function }, cls: unknown, where: unknown) => em.find(cls, where)),
  findOneWithDecryption: jest.fn(async (em: { findOne: Function }, cls: unknown, where: unknown) => em.findOne(cls, where)),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (em: { flush: () => Promise<void> }, phases: (() => unknown)[]) => {
    for (const phase of phases) await phase()
    await em.flush()
  },
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
const CHILD_ID = 'bbbbbbbb-0000-4000-8000-000000000002'

type Row = Record<string, unknown> & { id: string; deletedAt: Date | null }

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const operator = expected as { $in?: unknown[]; $ne?: unknown }
      if (operator.$in) return operator.$in.includes(actual)
      if ('$ne' in operator) return actual !== (operator.$ne ?? null)
    }
    if (expected === null) return actual === null
    return actual === expected
  })
}

function taskRow(id: string, parentTaskId: string | null): Row {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeProjectId: 'project-1',
    parentTaskId,
    taskStatusId: 'status-1',
    sequenceNumber: 1,
    reference: 'TT-1',
    title: 'Task',
    description: null,
    assigneeStaffMemberId: null,
    position: 1000,
    createdByUserId: USER_ID,
    closedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  }
}

function ticketRow(id: string, taskId: string, deletedAt: Date | null = null): Row {
  return { id, taskId, tenantId: TENANT_ID, organizationId: ORG_ID, updatedAt: new Date(0), deletedAt }
}

function makeWorld(tickets: Row[]) {
  const tasks = [taskRow(PARENT_ID, null), taskRow(CHILD_ID, PARENT_ID)]
  const projects: Row[] = [{ id: 'project-1', tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }]
  const lockModes: unknown[] = []
  const tables: Record<string, Row[]> = { StaffTimeTask: tasks, StaffSupportTicket: tickets, StaffTimeProject: projects }
  const tableFor = (cls: { name: string }): Row[] => tables[cls.name] ?? []
  const em: Record<string, unknown> = {
    flush: jest.fn(async () => undefined),
    find: jest.fn(async (cls: { name: string }, where: Record<string, unknown>) => tableFor(cls).filter((row) => matches(row, where))),
    findOne: jest.fn(async (cls: { name: string }, where: Record<string, unknown>, options?: { lockMode?: unknown }) => {
      if (cls.name === 'StaffTimeProject') lockModes.push(options?.lockMode)
      return tableFor(cls).find((row) => matches(row, where)) ?? null
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
  return { tasks, projects, lockModes, ctx }
}

type DeleteCommand = {
  prepare: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  execute: (input: unknown, ctx: unknown) => Promise<{ taskId: string; childIds: string[]; supportTicketIds: string[] }>
  buildLog: (args: { snapshots: unknown; result: unknown }) => Promise<{ payload: unknown }>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

async function loadDeleteCommand(): Promise<DeleteCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-tasks')
  return commandRegistry.get('staff.timesheets.tasks.delete') as unknown as DeleteCommand
}

describe('task delete cascade of support tickets', () => {
  it('soft-deletes the tickets of the task and its children and records their ids', async () => {
    const tickets = [ticketRow('ticket-parent', PARENT_ID), ticketRow('ticket-child', CHILD_ID)]
    const { ctx } = makeWorld(tickets)
    const command = await loadDeleteCommand()

    const result = await command.execute({ id: PARENT_ID }, ctx)

    expect(result.childIds).toEqual([CHILD_ID])
    expect(result.supportTicketIds.sort()).toEqual(['ticket-child', 'ticket-parent'])
    expect(tickets.every((ticket) => ticket.deletedAt instanceof Date)).toBe(true)
  })

  it('undo restores only the tickets this delete cascaded', async () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z')
    const tickets = [ticketRow('ticket-parent', PARENT_ID), ticketRow('ticket-old', PARENT_ID, earlier)]
    const { tasks, ctx } = makeWorld(tickets)
    const command = await loadDeleteCommand()

    const snapshots = { before: await command.prepare({ id: PARENT_ID }, ctx) }
    const result = await command.execute({ id: PARENT_ID }, ctx)
    expect(result.supportTicketIds).toEqual(['ticket-parent'])
    const log = await command.buildLog({ snapshots: snapshots.before, result })
    expect(log.payload).toEqual({ undo: expect.objectContaining({ cascadedSupportTicketIds: ['ticket-parent'] }) })

    await command.undo({ logEntry: { commandPayload: log.payload }, ctx })

    expect(tasks.every((task) => task.deletedAt === null)).toBe(true)
    expect(tickets.find((ticket) => ticket.id === 'ticket-parent')?.deletedAt).toBeNull()
    expect(tickets.find((ticket) => ticket.id === 'ticket-old')?.deletedAt).toBe(earlier)
  })

  it('undo of a log without recorded ticket ids restores no ticket', async () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z')
    const tickets = [ticketRow('ticket-old', PARENT_ID, earlier)]
    const { ctx } = makeWorld(tickets)
    const command = await loadDeleteCommand()

    const snapshots = await command.prepare({ id: PARENT_ID }, ctx)
    await command.execute({ id: PARENT_ID }, ctx)
    const before = (snapshots.before as { snapshot: unknown }).snapshot
    await command.undo({ logEntry: { commandPayload: { undo: { before } } }, ctx })

    expect(tickets[0].deletedAt).toBe(earlier)
  })

  it('undo restores under a shared project lock and refuses once the project was deleted', async () => {
    const { LockMode } = jest.requireActual('@mikro-orm/core') as typeof import('@mikro-orm/core')
    const tickets = [ticketRow('ticket-parent', PARENT_ID)]
    const { tasks, projects, lockModes, ctx } = makeWorld(tickets)
    const command = await loadDeleteCommand()

    const snapshots = { before: await command.prepare({ id: PARENT_ID }, ctx) }
    const result = await command.execute({ id: PARENT_ID }, ctx)
    const log = await command.buildLog({ snapshots: snapshots.before, result })
    projects[0].deletedAt = new Date()

    const error = (await command
      .undo({ logEntry: { commandPayload: log.payload }, ctx })
      .then(() => null, (err: unknown) => err)) as { status?: number } | null

    expect(error?.status).toBe(422)
    expect(lockModes).toEqual([LockMode.PESSIMISTIC_READ])
    expect(tasks.every((task) => task.deletedAt instanceof Date)).toBe(true)
    expect(tickets[0].deletedAt).toBeInstanceOf(Date)
  })
})
