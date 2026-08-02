export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const ACTOR_ORG = '11111111-1111-4111-8111-111111111111'
const ACTOR_TENANT = '22222222-2222-4222-8222-222222222222'
const FOREIGN_ORG = '33333333-3333-4333-8333-333333333333'
const FOREIGN_TENANT = '44444444-4444-4444-8444-444444444444'
const RECORD_ID = '55555555-5555-4555-8555-555555555555'

type RegisteredCommand = {
  execute: (input: Record<string, unknown>, ctx: ReturnType<typeof buildCtx>['ctx']) => Promise<unknown>
  prepare?: (input: Record<string, unknown>, ctx: ReturnType<typeof buildCtx>['ctx']) => Promise<unknown>
}

function loadCommand(moduleName: 'currencies' | 'exchange-rates', id: string): RegisteredCommand {
  let command: unknown
  jest.isolateModules(() => {
    require(`../${moduleName}`)
    command = registerCommand.mock.calls.find(([candidate]) => candidate.id === id)?.[0]
  })
  if (!command) throw new Error(`command ${id} not registered`)
  return command as RegisteredCommand
}

function matchesScope(where: Record<string, unknown>, record: Record<string, unknown>): boolean {
  if (where.tenantId !== undefined && where.tenantId !== record.tenantId) return false

  const organizationFilter = where.organizationId
  if (typeof organizationFilter === 'string' && organizationFilter !== record.organizationId) return false
  if (
    organizationFilter &&
    typeof organizationFilter === 'object' &&
    '$in' in organizationFilter &&
    Array.isArray((organizationFilter as { $in: unknown[] }).$in) &&
    !(organizationFilter as { $in: unknown[] }).$in.includes(record.organizationId)
  ) {
    return false
  }

  return true
}

function buildEm(record: Record<string, unknown> | null = null) {
  const em: Record<string, jest.Mock> = {
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      if (!record || where.id !== record.id) return null
      return matchesScope(where, record) ? record : null
    }),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: RECORD_ID,
      ...payload,
    })),
    persist: jest.fn(),
    nativeUpdate: jest.fn().mockResolvedValue(1),
    count: jest.fn().mockResolvedValue(0),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
  em.fork = jest.fn().mockReturnValue(em)
  return em
}

function buildExchangeCreateEm() {
  const em = buildEm()
  em.findOne
    .mockResolvedValueOnce({ id: 'from-currency' })
    .mockResolvedValueOnce({ id: 'to-currency' })
    .mockResolvedValueOnce(null)
  return em
}

function buildCtx(em: Record<string, jest.Mock>) {
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    emitEvent: jest.fn(),
  }
  return {
    ctx: {
      container: {
        resolve: jest.fn((token: string) => {
          if (token === 'em') return em
          if (token === 'dataEngine') return dataEngine
          return undefined
        }),
      },
      auth: {
        sub: 'user-1',
        tenantId: ACTOR_TENANT,
        orgId: ACTOR_ORG,
        isSuperAdmin: false,
      },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    },
    dataEngine,
  }
}

const foreignCurrency = {
  id: RECORD_ID,
  organizationId: FOREIGN_ORG,
  tenantId: FOREIGN_TENANT,
  code: 'USD',
  name: 'US Dollar',
  symbol: '$',
  decimalPlaces: 2,
  thousandsSeparator: ',',
  decimalSeparator: '.',
  isBase: false,
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const foreignExchangeRate = {
  id: RECORD_ID,
  organizationId: FOREIGN_ORG,
  tenantId: FOREIGN_TENANT,
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  rate: '0.90000000',
  date: new Date('2026-01-01T00:00:00.000Z'),
  source: 'manual',
  type: null,
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('currency command tenant and organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects creating a currency in a foreign tenant before persistence', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.create')
    const em = buildEm()
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        {
          organizationId: ACTOR_ORG,
          tenantId: FOREIGN_TENANT,
          code: 'USD',
          name: 'US Dollar',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects creating a currency in a foreign organization before persistence', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.create')
    const em = buildEm()
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        {
          organizationId: FOREIGN_ORG,
          tenantId: ACTOR_TENANT,
          code: 'USD',
          name: 'US Dollar',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.create).not.toHaveBeenCalled()
  })

  it('does not find a foreign-tenant currency for update', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.update')
    const em = buildEm({ ...foreignCurrency, organizationId: ACTOR_ORG })
    const { ctx } = buildCtx(em)

    await expect(command.execute({ id: RECORD_ID, name: 'Changed' }, ctx)).rejects.toMatchObject({
      status: 404,
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not find a foreign-organization currency for update', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.update')
    const em = buildEm({ ...foreignCurrency, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)

    await expect(command.execute({ id: RECORD_ID, name: 'Changed' }, ctx)).rejects.toMatchObject({
      status: 404,
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not find a foreign-tenant currency for delete', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.delete')
    const em = buildEm({ ...foreignCurrency, organizationId: ACTOR_ORG })
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        { id: RECORD_ID, organizationId: ACTOR_ORG, tenantId: ACTOR_TENANT },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not find a foreign-organization currency for delete', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.delete')
    const em = buildEm({ ...foreignCurrency, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        { id: RECORD_ID, organizationId: ACTOR_ORG, tenantId: ACTOR_TENANT },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not capture a foreign-tenant currency snapshot during update preparation', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.update')
    const em = buildEm({ ...foreignCurrency, organizationId: ACTOR_ORG })
    const { ctx } = buildCtx(em)

    await expect(command.prepare?.({ id: RECORD_ID }, ctx)).resolves.toEqual({ before: null })
  })

  it('does not capture a foreign-organization currency snapshot during delete preparation', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.delete')
    const em = buildEm({ ...foreignCurrency, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)

    await expect(command.prepare?.({ id: RECORD_ID }, ctx)).resolves.toEqual({ before: null })
  })

  it('rejects creating an exchange rate in a foreign tenant before persistence', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.create')
    const em = buildExchangeCreateEm()
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        {
          organizationId: ACTOR_ORG,
          tenantId: FOREIGN_TENANT,
          fromCurrencyCode: 'USD',
          toCurrencyCode: 'EUR',
          rate: '0.90000000',
          date: '2026-01-01T00:00:00.000Z',
          source: 'manual',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects creating an exchange rate in a foreign organization before persistence', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.create')
    const em = buildExchangeCreateEm()
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        {
          organizationId: FOREIGN_ORG,
          tenantId: ACTOR_TENANT,
          fromCurrencyCode: 'USD',
          toCurrencyCode: 'EUR',
          rate: '0.90000000',
          date: '2026-01-01T00:00:00.000Z',
          source: 'manual',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.create).not.toHaveBeenCalled()
  })

  it('does not find a foreign-tenant exchange rate for update', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.update')
    const em = buildEm({ ...foreignExchangeRate, organizationId: ACTOR_ORG })
    const { ctx } = buildCtx(em)

    await expect(command.execute({ id: RECORD_ID, rate: '0.95000000' }, ctx)).rejects.toMatchObject({
      status: 404,
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not find a foreign-organization exchange rate for update', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.update')
    const em = buildEm({ ...foreignExchangeRate, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)

    await expect(command.execute({ id: RECORD_ID, rate: '0.95000000' }, ctx)).rejects.toMatchObject({
      status: 404,
    })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not find a foreign-tenant exchange rate for delete', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.delete')
    const em = buildEm({ ...foreignExchangeRate, organizationId: ACTOR_ORG })
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        { id: RECORD_ID, organizationId: ACTOR_ORG, tenantId: ACTOR_TENANT },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not find a foreign-organization exchange rate for delete', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.delete')
    const em = buildEm({ ...foreignExchangeRate, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)

    await expect(
      command.execute(
        { id: RECORD_ID, organizationId: ACTOR_ORG, tenantId: ACTOR_TENANT },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not capture a foreign-tenant exchange-rate snapshot during update preparation', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.update')
    const em = buildEm({ ...foreignExchangeRate, organizationId: ACTOR_ORG })
    const { ctx } = buildCtx(em)

    await expect(command.prepare?.({ id: RECORD_ID }, ctx)).resolves.toEqual({ before: null })
  })

  it('does not capture a foreign-organization exchange-rate snapshot during delete preparation', async () => {
    const command = loadCommand('exchange-rates', 'currencies.exchange_rates.delete')
    const em = buildEm({ ...foreignExchangeRate, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)

    await expect(command.prepare?.({ id: RECORD_ID }, ctx)).resolves.toEqual({ before: null })
  })

  it('preserves cross-scope currency creation for a superadmin without a selected tenant', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.create')
    const em = buildEm()
    const { ctx } = buildCtx(em)
    Object.assign(ctx.auth, {
      tenantId: null,
      orgId: null,
      isSuperAdmin: true,
    })

    await expect(
      command.execute(
        {
          organizationId: FOREIGN_ORG,
          tenantId: FOREIGN_TENANT,
          code: 'USD',
          name: 'US Dollar',
        },
        ctx,
      ),
    ).resolves.toEqual({ currencyId: RECORD_ID })
  })

  it('preserves unscoped currency creation for a system command context', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.create')
    const em = buildEm()
    const { ctx } = buildCtx(em)
    ;(ctx as typeof ctx & { auth: null }).auth = null

    await expect(
      command.execute(
        {
          organizationId: FOREIGN_ORG,
          tenantId: FOREIGN_TENANT,
          code: 'USD',
          name: 'US Dollar',
        },
        ctx,
      ),
    ).resolves.toEqual({ currencyId: RECORD_ID })
  })

  it('preserves updates in another organization from an allowed multi-organization scope', async () => {
    const command = loadCommand('currencies', 'currencies.currencies.update')
    const em = buildEm({ ...foreignCurrency, tenantId: ACTOR_TENANT })
    const { ctx } = buildCtx(em)
    ctx.organizationIds = [ACTOR_ORG, FOREIGN_ORG]
    ctx.organizationScope = {
      tenantId: ACTOR_TENANT,
      selectedId: null,
      allowedIds: [ACTOR_ORG, FOREIGN_ORG],
      filterIds: [ACTOR_ORG, FOREIGN_ORG],
    }

    await expect(command.execute({ id: RECORD_ID, name: 'Changed' }, ctx)).resolves.toEqual({
      currencyId: RECORD_ID,
    })
  })
})
