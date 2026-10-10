import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { GlCashAccount, GlPaymentMethod } from '../data/entities'
import {
  createCashAccountSchema,
  createPaymentMethodSchema,
  updateCashAccountSchema,
  updatePaymentMethodSchema,
} from '../data/validators'
import {
  assertCashAccountAccount,
  assertPaymentMethodAccount,
  clearOtherCashAccountDefaults,
  clearOtherPaymentMethodDefaults,
  type FinanceScope,
} from '../lib/financeService'
import { makeEvents, makeIndexer } from './ledger'
import { registerCrudCommands } from './crud'

export const FINANCIAL_PAYMENT_METHOD_ENTITY_ID = 'financial:gl_payment_method' as const
export const FINANCIAL_CASH_ACCOUNT_ENTITY_ID = 'financial:gl_cash_account' as const

export const financialPaymentMethodEvents = makeEvents<GlPaymentMethod>('payment_method')
export const financialPaymentMethodIndexer = makeIndexer<GlPaymentMethod>(FINANCIAL_PAYMENT_METHOD_ENTITY_ID)
export const financialCashAccountEvents = makeEvents<GlCashAccount>('cash_account')
export const financialCashAccountIndexer = makeIndexer<GlCashAccount>(FINANCIAL_CASH_ACCOUNT_ENTITY_ID)

function resolveScope(ctx: CommandRuntimeContext): FinanceScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw badRequest('[internal] Tenant and organization context are required.')
  }
  return { tenantId, organizationId }
}

function forkEntityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

type MoneyRules = {
  assertAccount: (em: EntityManager, scope: FinanceScope, accountId: string) => Promise<unknown>
  clearOtherDefaults: (em: EntityManager, scope: FinanceScope, keepId: string | null) => Promise<void>
  label: string
}

/**
 * The two rules a method or a cash account owes before it is written: the GL
 * account it points at has to be able to hold money, and `isDefault` has to keep
 * describing one row. They are phases of one atomic flush so the cleared flags
 * are persisted rather than left pending on a throwaway fork.
 */
async function applyMoneyRules(
  em: EntityManager,
  scope: FinanceScope,
  input: Record<string, unknown>,
  keepId: string | null,
  rules: MoneyRules,
): Promise<void> {
  const accountId = typeof input.accountId === 'string' ? input.accountId : null
  const becomesDefault = input.isDefault === true
  if (!accountId && !becomesDefault) return
  await withAtomicFlush(
    em,
    [
      async () => {
        if (accountId) await rules.assertAccount(em, scope, accountId)
      },
      async () => {
        if (becomesDefault) await rules.clearOtherDefaults(em, scope, keepId)
      },
    ],
    { transaction: true, label: rules.label },
  )
}

const paymentMethodRules: Omit<MoneyRules, 'label'> = {
  assertAccount: assertPaymentMethodAccount,
  clearOtherDefaults: clearOtherPaymentMethodDefaults,
}

const cashAccountRules: Omit<MoneyRules, 'label'> = {
  assertAccount: assertCashAccountAccount,
  clearOtherDefaults: clearOtherCashAccountDefaults,
}

export async function beforePaymentMethodCreate(
  input: Record<string, unknown>,
  scope: FinanceScope,
  ctx: CommandRuntimeContext,
): Promise<void> {
  await applyMoneyRules(forkEntityManager(ctx), scope, input, null, {
    ...paymentMethodRules,
    label: 'financial.payment_methods.create',
  })
}

export async function beforePaymentMethodUpdate(
  input: Record<string, unknown>,
  current: GlPaymentMethod,
  scope: FinanceScope,
  ctx: CommandRuntimeContext,
): Promise<void> {
  await applyMoneyRules(forkEntityManager(ctx), scope, input, current.id, {
    ...paymentMethodRules,
    label: 'financial.payment_methods.update',
  })
}

export async function beforeCashAccountCreate(
  input: Record<string, unknown>,
  scope: FinanceScope,
  ctx: CommandRuntimeContext,
): Promise<void> {
  await applyMoneyRules(forkEntityManager(ctx), scope, input, null, {
    ...cashAccountRules,
    label: 'financial.cash_accounts.create',
  })
}

export async function beforeCashAccountUpdate(
  input: Record<string, unknown>,
  current: GlCashAccount,
  scope: FinanceScope,
  ctx: CommandRuntimeContext,
): Promise<void> {
  await applyMoneyRules(forkEntityManager(ctx), scope, input, current.id, {
    ...cashAccountRules,
    label: 'financial.cash_accounts.update',
  })
}

registerCrudCommands({
  entity: GlPaymentMethod,
  entityId: FINANCIAL_PAYMENT_METHOD_ENTITY_ID,
  resource: 'payment_methods',
  createSchema: createPaymentMethodSchema,
  updateSchema: updatePaymentMethodSchema,
  toCreateData: (input) => input,
  toUpdateData: (input) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')),
  beforeCreate: beforePaymentMethodCreate,
  beforeUpdate: beforePaymentMethodUpdate,
  events: financialPaymentMethodEvents,
  indexer: financialPaymentMethodIndexer,
})

registerCrudCommands({
  entity: GlCashAccount,
  entityId: FINANCIAL_CASH_ACCOUNT_ENTITY_ID,
  resource: 'cash_accounts',
  createSchema: createCashAccountSchema,
  updateSchema: updateCashAccountSchema,
  toCreateData: (input) => input,
  toUpdateData: (input) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')),
  beforeCreate: beforeCashAccountCreate,
  beforeUpdate: beforeCashAccountUpdate,
  events: financialCashAccountEvents,
  indexer: financialCashAccountIndexer,
})
