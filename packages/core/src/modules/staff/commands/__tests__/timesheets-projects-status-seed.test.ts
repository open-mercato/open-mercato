/** @jest-environment node */
// T3.1 (D-1): a project is only usable if it has a board, and no screen creates
// the first column. These tests pin that project create seeds the default
// template inside the same transaction as the project row — so a rollback takes
// both and a project can never exist with an empty board.
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
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'

type CreateCall = { clsName: string; data: Record<string, unknown> }

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadCreateCommand(): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-projects')
  return commandRegistry.get('staff.timesheets.time_projects.create') as RegisteredCommand
}

function makeEm(createCalls: CreateCall[], calls: string[], flushImpl?: () => Promise<void>) {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    create: jest.fn((cls: { name: string }, data: Record<string, unknown>) => {
      createCalls.push({ clsName: cls.name, data })
      calls.push(`create:${cls.name}`)
      return { id: PROJECT_ID, ...data }
    }),
    persist: jest.fn(() => {
      calls.push('persist')
    }),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    flush: jest.fn(async () => {
      calls.push('flush')
      if (flushImpl) await flushImpl()
    }),
    begin: jest.fn(async () => {
      calls.push('begin')
    }),
    commit: jest.fn(async () => {
      calls.push('commit')
    }),
    rollback: jest.fn(async () => {
      calls.push('rollback')
    }),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown) {
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

const createInput = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  name: 'Nordvik service portal',
  code: 'NORDVIK',
  customerId: CUSTOMER_ID,
}

describe('staff.timesheets.time_projects.create seeds the Kanban board', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitCrudSideEffects.mockResolvedValue(undefined)
  })

  it('creates the four default columns for the new project', async () => {
    const command = await loadCreateCommand()
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls, [])

    await command.execute(createInput, createCtx(em))

    const statuses = createCalls.filter((call) => call.clsName === 'StaffTimeTaskStatus')
    expect(statuses.map((call) => call.data.slug)).toEqual(['backlog', 'in-progress', 'in-review', 'done'])
    expect(statuses.map((call) => call.data.name)).toEqual(['Backlog', 'In progress', 'In review', 'Done'])
    expect(statuses.map((call) => call.data.position)).toEqual([1000, 2000, 3000, 4000])
    for (const call of statuses) {
      expect(call.data.timeProjectId).toBe(PROJECT_ID)
      expect(call.data.tenantId).toBe(TENANT_ID)
      expect(call.data.organizationId).toBe(ORG_ID)
    }
  })

  it('marks exactly one landing column and one terminal column', async () => {
    const command = await loadCreateCommand()
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls, [])

    await command.execute(createInput, createCtx(em))

    const statuses = createCalls.filter((call) => call.clsName === 'StaffTimeTaskStatus')
    expect(statuses.filter((call) => call.data.isDefault === true)).toHaveLength(1)
    expect(statuses.find((call) => call.data.isDefault === true)?.data.slug).toBe('backlog')
    expect(statuses.filter((call) => call.data.isDone === true)).toHaveLength(1)
    expect(statuses.find((call) => call.data.isDone === true)?.data.slug).toBe('done')
  })

  it('colours the columns with DS token keys rather than raw hex', async () => {
    const command = await loadCreateCommand()
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls, [])

    await command.execute(createInput, createCtx(em))

    const statuses = createCalls.filter((call) => call.clsName === 'StaffTimeTaskStatus')
    expect(statuses.map((call) => call.data.color)).toEqual(['indigo', 'blue', 'orange', 'emerald'])
  })

  it('seeds inside the transaction that inserts the project', async () => {
    const command = await loadCreateCommand()
    const createCalls: CreateCall[] = []
    const calls: string[] = []
    const em = makeEm(createCalls, calls)

    await command.execute(createInput, createCtx(em))

    expect(calls[calls.length - 1]).toBe('commit')
    const beganAt = calls.indexOf('begin')
    const firstStatusCreate = calls.indexOf('create:StaffTimeTaskStatus')
    const commitAt = calls.indexOf('commit')
    // The project row is inserted first (its id is what the columns point at) and
    // the columns follow — both between the same begin and commit.
    expect(beganAt).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('persist')).toBeGreaterThan(beganAt)
    expect(firstStatusCreate).toBeGreaterThan(calls.indexOf('flush'))
    expect(firstStatusCreate).toBeLessThan(commitAt)
    expect(calls).not.toContain('rollback')
  })

  it('rolls the project back when the board cannot be written', async () => {
    const command = await loadCreateCommand()
    const createCalls: CreateCall[] = []
    const calls: string[] = []
    let flushCount = 0
    const em = makeEm(createCalls, calls, async () => {
      flushCount += 1
      // The second flush is the one carrying the seeded columns.
      if (flushCount === 2) throw new Error('[internal] board insert failed')
    })

    await expect(command.execute(createInput, createCtx(em))).rejects.toThrow('board insert failed')
    expect(calls).toContain('rollback')
    expect(calls).not.toContain('commit')
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })
})
