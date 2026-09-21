/** @jest-environment node */
// T2.9: the project form collects a rate, a currency, a billable default and a
// budget, and `staff_time_projects` has the columns — these tests pin that the
// write path actually carries them, that D-3 keeps `currency_code` out of the
// plain update, and that the audit trail sees the new fields.
import type { AwilixContainer } from 'awilix'

const mockFindOneWithDecryption = jest.fn()
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
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: Record<string, unknown>) => Promise<unknown>
}

async function loadCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../timesheets-projects')
  return commandRegistry.get(id) as RegisteredCommand
}

type CreateCall = { cls: unknown; data: Record<string, unknown> }

function makeEm(createCalls: CreateCall[] = []) {
  const em: Record<string, jest.Mock> = {
    fork: jest.fn(),
    create: jest.fn((cls: unknown, data: Record<string, unknown>) => {
      createCalls.push({ cls, data })
      return { id: PROJECT_ID, ...data }
    }),
    persist: jest.fn(),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown, tenantId: string = TENANT_ID) {
  return {
    auth: { sub: 'user-1', tenantId, orgId: ORG_ID },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
  }
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Nordvik service portal',
    code: 'NORDVIK',
    customerId: CUSTOMER_ID,
    customerSnapshot: { name: 'Nordvik AS', taxId: 'NO-998877' },
    hourlyRate: '180.5',
    currencyCode: 'pln',
    billableByDefault: false,
    budgetKind: 'amount',
    budgetValue: '25000',
    budgetWarnAtPercent: 90,
    ...overrides,
  }
}

function makeStoredProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Nordvik service portal',
    customerId: CUSTOMER_ID,
    customerSnapshot: { name: 'Nordvik AS' },
    code: 'NORDVIK',
    description: null,
    projectType: null,
    color: null,
    status: 'active',
    ownerUserId: null,
    costCenter: null,
    startDate: null,
    hourlyRate: '180.0000',
    currencyCode: 'PLN',
    billableByDefault: true,
    budgetKind: 'none',
    budgetValue: null,
    budgetWarnAtPercent: 80,
    deletedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('staff.timesheets.time_projects create/update billing fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitCrudSideEffects.mockResolvedValue(undefined)
  })

  it('create persists every billing field the project form posts', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.create')
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls)

    const result = await command.execute(createInput(), createCtx(em))

    expect(result).toEqual({ timeProjectId: PROJECT_ID })
    // The project row plus the four seeded Kanban columns (D-1) are created in the
    // same transaction, so the project itself is the first of five creates.
    expect(createCalls).toHaveLength(5)
    expect(createCalls[0].data).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: CUSTOMER_ID,
      customerSnapshot: { name: 'Nordvik AS', taxId: 'NO-998877' },
      hourlyRate: '180.5',
      currencyCode: 'PLN',
      billableByDefault: false,
      budgetKind: 'amount',
      budgetValue: '25000',
      budgetWarnAtPercent: 90,
    })
  })

  it('create falls back to the column defaults when the optional fields are absent', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.create')
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls)

    await command.execute(
      {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        name: 'Internal',
        code: 'INT',
        customerId: CUSTOMER_ID,
      },
      createCtx(em),
    )

    expect(createCalls[0].data).toMatchObject({
      hourlyRate: null,
      currencyCode: null,
      billableByDefault: true,
      budgetKind: 'none',
      budgetValue: null,
      budgetWarnAtPercent: 80,
    })
  })

  it('create refuses a project without a customer (US-B1)', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.create')
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls)

    await expect(
      command.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, name: 'No customer', code: 'NC' }, createCtx(em)),
    ).rejects.toBeInstanceOf(Error)
    expect(createCalls).toHaveLength(0)
  })

  it('update writes the billing fields onto the project', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject()
    mockFindOneWithDecryption.mockResolvedValue(project)
    const em = makeEm()

    await command.execute(
      {
        id: PROJECT_ID,
        hourlyRate: '210,75',
        billableByDefault: false,
        budgetKind: 'hours',
        budgetValue: '120',
        budgetWarnAtPercent: 60,
        customerSnapshot: { name: 'Nordvik AS', taxId: 'NO-998877' },
      },
      createCtx(em),
    )

    expect(project).toMatchObject({
      hourlyRate: '210.75',
      billableByDefault: false,
      budgetKind: 'hours',
      budgetValue: '120',
      budgetWarnAtPercent: 60,
      customerSnapshot: { name: 'Nordvik AS', taxId: 'NO-998877' },
    })
    expect(em.flush).toHaveBeenCalled()
  })

  it('D-3: update ignores a smuggled currencyCode and leaves the column untouched', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject({ currencyCode: 'PLN' })
    mockFindOneWithDecryption.mockResolvedValue(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, name: 'Renamed', currencyCode: 'EUR' }, createCtx(em))

    expect(project.name).toBe('Renamed')
    // Only `change_currency` may relabel a project, behind the acknowledgement
    // and the locked-entry refusal.
    expect(project.currencyCode).toBe('PLN')
  })

  it('update clears a nulled rate and budget value', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject({ hourlyRate: '180.0000', budgetKind: 'amount', budgetValue: '25000.0000' })
    mockFindOneWithDecryption.mockResolvedValue(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, hourlyRate: null, budgetKind: 'none', budgetValue: null }, createCtx(em))

    expect(project.hourlyRate).toBeNull()
    expect(project.budgetKind).toBe('none')
    expect(project.budgetValue).toBeNull()
  })

  it('update leaves untouched fields alone', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject({ hourlyRate: '180.0000', billableByDefault: false, budgetWarnAtPercent: 65 })
    mockFindOneWithDecryption.mockResolvedValue(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, name: 'Renamed only' }, createCtx(em))

    expect(project).toMatchObject({
      hourlyRate: '180.0000',
      billableByDefault: false,
      budgetWarnAtPercent: 65,
    })
  })

  it('update stays inside the caller tenant', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    // The tenant-scoped where clause filters the foreign project out entirely.
    mockFindOneWithDecryption.mockResolvedValue(null)
    const em = makeEm()

    await expect(
      command.execute({ id: PROJECT_ID, hourlyRate: '999' }, createCtx(em, OTHER_TENANT_ID)),
    ).rejects.toMatchObject({ status: 404 })

    const lookupWhere = mockFindOneWithDecryption.mock.calls[0][2] as Record<string, unknown>
    expect(lookupWhere).toMatchObject({
      id: PROJECT_ID,
      tenantId: OTHER_TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('the audit diff reports the new billing fields', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const before = {
      id: PROJECT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      name: 'Nordvik service portal',
      customerId: CUSTOMER_ID,
      customerSnapshot: { name: 'Nordvik AS' },
      code: 'NORDVIK',
      description: null,
      projectType: null,
      color: null,
      status: 'active',
      ownerUserId: null,
      costCenter: null,
      startDate: null,
      hourlyRate: '180.0000',
      currencyCode: 'PLN',
      billableByDefault: true,
      budgetKind: 'none',
      budgetValue: null,
      budgetWarnAtPercent: 80,
      deletedAt: null,
    }
    mockFindOneWithDecryption.mockResolvedValue(
      makeStoredProject({
        hourlyRate: '210.7500',
        billableByDefault: false,
        budgetKind: 'hours',
        budgetValue: '120.0000',
        budgetWarnAtPercent: 60,
        customerSnapshot: { name: 'Nordvik Group AS' },
      }),
    )
    const em = makeEm()

    const log = (await command.buildLog?.({ snapshots: { before }, ctx: createCtx(em) })) as {
      changes: Record<string, { from: unknown; to: unknown }>
      snapshotAfter: Record<string, unknown>
    }

    expect(log.changes).toMatchObject({
      hourlyRate: { from: '180.0000', to: '210.7500' },
      billableByDefault: { from: true, to: false },
      budgetKind: { from: 'none', to: 'hours' },
      budgetValue: { from: null, to: '120.0000' },
      budgetWarnAtPercent: { from: 80, to: 60 },
      customerSnapshot: { from: { name: 'Nordvik AS' }, to: { name: 'Nordvik Group AS' } },
    })
    expect(log.snapshotAfter).toMatchObject({ hourlyRate: '210.7500', budgetKind: 'hours' })
  })

  it('an unchanged customer snapshot is not reported as a change', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const before = {
      id: PROJECT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      name: 'Nordvik service portal',
      customerId: CUSTOMER_ID,
      // A distinct object with identical content — the two snapshots are always
      // loaded through separate forks.
      customerSnapshot: { name: 'Nordvik AS' },
      code: 'NORDVIK',
      description: null,
      projectType: null,
      color: null,
      status: 'active',
      ownerUserId: null,
      costCenter: null,
      startDate: null,
      hourlyRate: '180.0000',
      currencyCode: 'PLN',
      billableByDefault: true,
      budgetKind: 'none',
      budgetValue: null,
      budgetWarnAtPercent: 80,
      deletedAt: null,
    }
    mockFindOneWithDecryption.mockResolvedValue(makeStoredProject({ name: 'Renamed' }))
    const em = makeEm()

    const log = (await command.buildLog?.({ snapshots: { before }, ctx: createCtx(em) })) as {
      changes: Record<string, unknown>
    }

    expect(log.changes).toEqual({ name: { from: 'Nordvik service portal', to: 'Renamed' } })
  })
})
