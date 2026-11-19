/** @jest-environment node */
// D-9 keeps a project's customer as an FK id plus a denormalized snapshot, and
// the portfolio grid renders the customer column from the snapshot alone. Until
// these tests, the snapshot came only from the request body, so a caller that
// sent `customerId` without one — the CRUD route, an import, an integration —
// produced a project that HAS a customer in the database and advertises none in
// the UI. The write path now derives it, without an ORM relation to customers.
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
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_CUSTOMER_ID = '77777777-7777-4777-8777-777777777777'
const UNKNOWN_CUSTOMER_ID = '88888888-8888-4888-8888-888888888888'

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
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

function createCtx(em: unknown) {
  return {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
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

const CUSTOMERS: Record<string, Record<string, unknown>> = {
  [CUSTOMER_ID]: {
    id: CUSTOMER_ID,
    kind: 'company',
    displayName: 'Alpha Customer',
    primaryEmail: 'billing@alpha.example',
  },
  [OTHER_CUSTOMER_ID]: {
    id: OTHER_CUSTOMER_ID,
    kind: 'person',
    displayName: 'Beata Nowak',
    primaryEmail: null,
  },
}

type CustomerLookup = { where: Record<string, unknown>; scope: Record<string, unknown> }

function stubLookups(project: Record<string, unknown> | null): CustomerLookup[] {
  const customerLookups: CustomerLookup[] = []
  mockFindOneWithDecryption.mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>, _options: unknown, scope: Record<string, unknown>) => {
      const entityName = typeof entity === 'function' ? entity.name : String(entity)
      if (entityName !== 'CustomerEntity') return project
      customerLookups.push({ where, scope })
      const id = typeof where.id === 'string' ? where.id : ''
      return CUSTOMERS[id] ?? null
    },
  )
  return customerLookups
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Alpha rollout',
    code: 'ALPHA',
    customerId: CUSTOMER_ID,
    ...overrides,
  }
}

function makeStoredProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Alpha rollout',
    customerId: CUSTOMER_ID,
    customerSnapshot: { name: 'Alpha Customer', kind: 'company' },
    code: 'ALPHA',
    description: null,
    projectType: null,
    color: null,
    status: 'active',
    ownerUserId: null,
    costCenter: null,
    startDate: null,
    hourlyRate: null,
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

describe('staff.timesheets.time_projects customer snapshot denormalization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitCrudSideEffects.mockResolvedValue(undefined)
  })

  it('create derives the snapshot when the caller sends only a customer id', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.create')
    const lookups = stubLookups(null)
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls)

    await command.execute(createInput(), createCtx(em))

    expect(createCalls[0].data).toMatchObject({
      customerId: CUSTOMER_ID,
      customerSnapshot: { name: 'Alpha Customer', kind: 'company', email: 'billing@alpha.example' },
    })
    // Reading the customer stays inside the caller's tenant and organization.
    expect(lookups).toHaveLength(1)
    expect(lookups[0].where).toMatchObject({
      id: CUSTOMER_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
    expect(lookups[0].scope).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('create keeps a supplied snapshot verbatim and skips the lookup', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.create')
    const lookups = stubLookups(null)
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls)

    await command.execute(
      createInput({ customerSnapshot: { name: 'Alpha Customer AS', taxId: 'NO-998877' } }),
      createCtx(em),
    )

    expect(createCalls[0].data.customerSnapshot).toEqual({ name: 'Alpha Customer AS', taxId: 'NO-998877' })
    expect(lookups).toHaveLength(0)
  })

  it('create still writes the project when the customer cannot be read', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.create')
    stubLookups(null)
    const createCalls: CreateCall[] = []
    const em = makeEm(createCalls)

    await command.execute(createInput({ customerId: UNKNOWN_CUSTOMER_ID }), createCtx(em))

    expect(createCalls[0].data).toMatchObject({
      customerId: UNKNOWN_CUSTOMER_ID,
      customerSnapshot: null,
    })
  })

  it('update refreshes the snapshot when the project is re-pointed at another customer', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject()
    stubLookups(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, customerId: OTHER_CUSTOMER_ID }, createCtx(em))

    expect(project.customerId).toBe(OTHER_CUSTOMER_ID)
    expect(project.customerSnapshot).toEqual({ name: 'Beata Nowak', kind: 'person' })
    expect(em.flush).toHaveBeenCalled()
  })

  it('update fills a missing snapshot in from the customer id it already carries', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject({ customerSnapshot: null })
    stubLookups(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, customerId: CUSTOMER_ID, customerSnapshot: null }, createCtx(em))

    expect(project.customerSnapshot).toEqual({
      name: 'Alpha Customer',
      kind: 'company',
      email: 'billing@alpha.example',
    })
  })

  it('update keeps a supplied snapshot verbatim', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject()
    const lookups = stubLookups(project)
    const em = makeEm()

    await command.execute(
      {
        id: PROJECT_ID,
        customerId: OTHER_CUSTOMER_ID,
        customerSnapshot: { name: 'Beata Nowak — sole trader', taxId: 'PL-123' },
      },
      createCtx(em),
    )

    expect(project.customerSnapshot).toEqual({ name: 'Beata Nowak — sole trader', taxId: 'PL-123' })
    expect(lookups).toHaveLength(0)
  })

  it('update clears the snapshot together with the customer', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject()
    stubLookups(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, customerId: null }, createCtx(em))

    expect(project.customerId).toBeNull()
    expect(project.customerSnapshot).toBeNull()
  })

  it('update keeps the stored snapshot when the unchanged customer can no longer be read', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject({ customerId: UNKNOWN_CUSTOMER_ID })
    stubLookups(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, customerId: UNKNOWN_CUSTOMER_ID }, createCtx(em))

    expect(project.customerSnapshot).toEqual({ name: 'Alpha Customer', kind: 'company' })
  })

  it('update that does not mention the customer costs no lookup and leaves the snapshot alone', async () => {
    const command = await loadCommand('staff.timesheets.time_projects.update')
    const project = makeStoredProject()
    const lookups = stubLookups(project)
    const em = makeEm()

    await command.execute({ id: PROJECT_ID, name: 'Alpha rollout — phase 2' }, createCtx(em))

    expect(project.name).toBe('Alpha rollout — phase 2')
    expect(project.customerSnapshot).toEqual({ name: 'Alpha Customer', kind: 'company' })
    expect(lookups).toHaveLength(0)
  })
})
