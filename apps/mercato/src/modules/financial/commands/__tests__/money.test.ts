import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import type { GlCashAccount, GlPaymentMethod } from '../../data/entities'

const mockAssertPaymentMethodAccount = jest.fn(async () => undefined)
const mockAssertCashAccountAccount = jest.fn(async () => undefined)
const mockClearOtherPaymentMethodDefaults = jest.fn(async () => undefined)
const mockClearOtherCashAccountDefaults = jest.fn(async () => undefined)

jest.mock('../../lib/financeService', () => ({
  assertPaymentMethodAccount: (...args: unknown[]) => mockAssertPaymentMethodAccount(...(args as [])),
  assertCashAccountAccount: (...args: unknown[]) => mockAssertCashAccountAccount(...(args as [])),
  clearOtherPaymentMethodDefaults: (...args: unknown[]) => mockClearOtherPaymentMethodDefaults(...(args as [])),
  clearOtherCashAccountDefaults: (...args: unknown[]) => mockClearOtherCashAccountDefaults(...(args as [])),
}))

import {
  FINANCIAL_CASH_ACCOUNT_ENTITY_ID,
  FINANCIAL_PAYMENT_METHOD_ENTITY_ID,
  beforeCashAccountCreate,
  beforeCashAccountUpdate,
  beforePaymentMethodCreate,
  beforePaymentMethodUpdate,
  financialCashAccountEvents,
  financialCashAccountIndexer,
  financialPaymentMethodEvents,
  financialPaymentMethodIndexer,
} from '../money'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'
const RECORD_ID = '44444444-4444-4444-8444-444444444444'

const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

type FakeEntityManager = {
  fork: () => FakeEntityManager
  findOne: jest.Mock
  flush: jest.Mock
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
}

type FakeHarness = {
  em: FakeEntityManager
  ctx: CommandRuntimeContext
  createOrmEntity: jest.Mock
  updateOrmEntity: jest.Mock
}

function createHarness(current: Record<string, unknown> | null = null): FakeHarness {
  const em: FakeEntityManager = {
    fork: () => em,
    findOne: jest.fn(async () => current),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }
  const createOrmEntity = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: RECORD_ID }))
  const updateOrmEntity = jest.fn(async ({ apply }: { apply: (record: Record<string, unknown>) => void }) => {
    const record = { id: RECORD_ID, ...(current ?? {}) }
    apply(record)
    return record
  })
  const dataEngine = {
    createOrmEntity,
    updateOrmEntity,
    deleteOrmEntity: jest.fn(async () => ({ id: RECORD_ID })),
    markOrmEntityChange: jest.fn(),
  }
  const ctx = {
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return dataEngine
        throw new Error(`[internal] Unexpected container resolve: ${name}`)
      },
    },
  } as unknown as CommandRuntimeContext
  return { em, ctx, createOrmEntity, updateOrmEntity }
}

function commandHandler(id: string): CommandHandler<Record<string, unknown>, unknown> {
  const handler = commandRegistry.get<Record<string, unknown>, unknown>(id)
  if (!handler) throw new Error(`[internal] Missing command handler: ${id}`)
  return handler
}

describe('financial payment method rules', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('validates the linked account and clears other defaults when a created row is the default', async () => {
    const { em, ctx } = createHarness()

    await beforePaymentMethodCreate({ accountId: ACCOUNT_ID, isDefault: true }, scope, ctx)

    expect(mockAssertPaymentMethodAccount).toHaveBeenCalledWith(em, scope, ACCOUNT_ID)
    expect(mockClearOtherPaymentMethodDefaults).toHaveBeenCalledWith(em, scope, null)
    expect(mockAssertCashAccountAccount).not.toHaveBeenCalled()
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('validates the account on create without touching defaults when isDefault is not true', async () => {
    const { em, ctx } = createHarness()

    await beforePaymentMethodCreate({ accountId: ACCOUNT_ID, isDefault: false }, scope, ctx)

    expect(mockAssertPaymentMethodAccount).toHaveBeenCalledWith(em, scope, ACCOUNT_ID)
    expect(mockClearOtherPaymentMethodDefaults).not.toHaveBeenCalled()
  })

  it('skips both rules when the input carries neither an account nor a default flag', async () => {
    const { em, ctx } = createHarness()

    await beforePaymentMethodCreate({ name: 'Cash on delivery' }, scope, ctx)

    expect(mockAssertPaymentMethodAccount).not.toHaveBeenCalled()
    expect(mockClearOtherPaymentMethodDefaults).not.toHaveBeenCalled()
    expect(em.begin).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('validates a new account on update and excludes the edited row from default clearing', async () => {
    const { em, ctx } = createHarness()
    const current = { id: RECORD_ID } as unknown as GlPaymentMethod

    await beforePaymentMethodUpdate({ accountId: ACCOUNT_ID, isDefault: true }, current, scope, ctx)

    expect(mockAssertPaymentMethodAccount).toHaveBeenCalledWith(em, scope, ACCOUNT_ID)
    expect(mockClearOtherPaymentMethodDefaults).toHaveBeenCalledWith(em, scope, RECORD_ID)
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('leaves the account and the default flag untouched on a partial update', async () => {
    const { em, ctx } = createHarness()
    const current = { id: RECORD_ID } as unknown as GlPaymentMethod

    await beforePaymentMethodUpdate({ name: 'Renamed' }, current, scope, ctx)

    expect(mockAssertPaymentMethodAccount).not.toHaveBeenCalled()
    expect(mockClearOtherPaymentMethodDefaults).not.toHaveBeenCalled()
    expect(em.begin).not.toHaveBeenCalled()
  })

  it('clears other defaults on update when isDefault flips to true without an account change', async () => {
    const { em, ctx } = createHarness()
    const current = { id: RECORD_ID } as unknown as GlPaymentMethod

    await beforePaymentMethodUpdate({ isDefault: true }, current, scope, ctx)

    expect(mockAssertPaymentMethodAccount).not.toHaveBeenCalled()
    expect(mockClearOtherPaymentMethodDefaults).toHaveBeenCalledWith(em, scope, RECORD_ID)
  })
})

describe('financial cash account rules', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('applies the cash-account rules on create and keeps them apart from the payment-method ones', async () => {
    const { em, ctx } = createHarness()

    await beforeCashAccountCreate({ accountId: ACCOUNT_ID, isDefault: true }, scope, ctx)

    expect(mockAssertCashAccountAccount).toHaveBeenCalledWith(em, scope, ACCOUNT_ID)
    expect(mockClearOtherCashAccountDefaults).toHaveBeenCalledWith(em, scope, null)
    expect(mockAssertPaymentMethodAccount).not.toHaveBeenCalled()
    expect(mockClearOtherPaymentMethodDefaults).not.toHaveBeenCalled()
  })

  it('excludes the edited row from default clearing on update', async () => {
    const { em, ctx } = createHarness()
    const current = { id: RECORD_ID } as unknown as GlCashAccount

    await beforeCashAccountUpdate({ accountId: ACCOUNT_ID, isDefault: true }, current, scope, ctx)

    expect(mockAssertCashAccountAccount).toHaveBeenCalledWith(em, scope, ACCOUNT_ID)
    expect(mockClearOtherCashAccountDefaults).toHaveBeenCalledWith(em, scope, RECORD_ID)
  })
})

describe('financial money command surface', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares stable entity ids and side-effect wiring', () => {
    expect(FINANCIAL_PAYMENT_METHOD_ENTITY_ID).toBe('financial:gl_payment_method')
    expect(FINANCIAL_CASH_ACCOUNT_ENTITY_ID).toBe('financial:gl_cash_account')
    expect(financialPaymentMethodEvents.module).toBe('financial')
    expect(financialPaymentMethodEvents.entity).toBe('payment_method')
    expect(financialPaymentMethodIndexer.entityType).toBe(FINANCIAL_PAYMENT_METHOD_ENTITY_ID)
    expect(financialCashAccountEvents.entity).toBe('cash_account')
    expect(financialCashAccountIndexer.entityType).toBe(FINANCIAL_CASH_ACCOUNT_ENTITY_ID)
  })

  it('registers the six CRUD commands the routes dispatch', () => {
    const ids = [
      'financial.payment_methods.create',
      'financial.payment_methods.update',
      'financial.payment_methods.delete',
      'financial.cash_accounts.create',
      'financial.cash_accounts.update',
      'financial.cash_accounts.delete',
    ]
    for (const id of ids) {
      expect(commandRegistry.get(id)).not.toBeNull()
    }
  })

  it('runs the account and default rules inside the payment-method create command', async () => {
    const { ctx, createOrmEntity } = createHarness()

    await commandHandler('financial.payment_methods.create').execute(
      { code: 'CASH', name: 'Cash', accountId: ACCOUNT_ID, isDefault: true },
      ctx,
    )

    expect(mockAssertPaymentMethodAccount).toHaveBeenCalledWith(expect.anything(), scope, ACCOUNT_ID)
    expect(mockClearOtherPaymentMethodDefaults).toHaveBeenCalledWith(expect.anything(), scope, null)
    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('runs the rules inside the update command with the stored row id', async () => {
    const { ctx, updateOrmEntity } = createHarness({ id: RECORD_ID, code: 'CASH', name: 'Cash' })

    await commandHandler('financial.payment_methods.update').execute({ id: RECORD_ID, isDefault: true }, ctx)

    expect(mockClearOtherPaymentMethodDefaults).toHaveBeenCalledWith(expect.anything(), scope, RECORD_ID)
    expect(updateOrmEntity).toHaveBeenCalledTimes(1)
  })

  it('runs the rules inside the cash-account create command', async () => {
    const { ctx, createOrmEntity } = createHarness()

    await commandHandler('financial.cash_accounts.create').execute(
      { code: 'BANK', name: 'Main bank', accountId: ACCOUNT_ID, currencyCode: 'SAR', isDefault: true },
      ctx,
    )

    expect(mockAssertCashAccountAccount).toHaveBeenCalledWith(expect.anything(), scope, ACCOUNT_ID)
    expect(mockClearOtherCashAccountDefaults).toHaveBeenCalledWith(expect.anything(), scope, null)
    expect(createOrmEntity).toHaveBeenCalledTimes(1)
  })
})
