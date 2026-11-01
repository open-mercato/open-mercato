jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string, params?: Record<string, unknown>) => {
      const base = fallback ?? _key
      if (!params) return base
      return Object.entries(params).reduce((acc, [name, value]) => acc.split(`{${name}}`).join(String(value)), base)
    },
  }),
}))

import { adjustCreditCommand } from '../adjustCredit'
import type { CustomerCreditAccount } from '../../data/entities'
import type { AdjustCreditInput, AdjustCreditResult, CustomerCreditService } from '../../services/customerCreditService'

// Step 1.12 (D-R5-2/G20). Mocks the service entirely — the lock/idempotency logic is
// `customerCreditService.test.ts`'s job; this file proves the command's own
// responsibilities: resolving the account inside the caller's organization scope,
// building the undo payload, and replaying it with a negated amount on undo.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '77777777-7777-4777-8777-777777777777'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '55555555-5555-4555-8555-555555555555'

function makeAccount(overrides: Partial<CustomerCreditAccount> = {}): CustomerCreditAccount {
  return {
    id: ACCOUNT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
    creditLimit: '500.00',
    isOnHold: false,
    holdReason: null,
    updatedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerCreditAccount
}

function makeEm(account: CustomerCreditAccount | null) {
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    if (!account) return null
    if (where.id !== account.id) return null
    if (where.tenantId !== account.tenantId) return null
    if (where.organizationId && typeof where.organizationId === 'object' && '$in' in (where.organizationId as object)) {
      const ids = (where.organizationId as { $in: string[] }).$in
      if (!ids.includes(account.organizationId)) return null
    }
    return account
  })
  return { findOne }
}

function makeEntryView(overrides: Partial<ReturnType<typeof defaultEntry>> = {}) {
  return { ...defaultEntry(), ...overrides }
}

function defaultEntry() {
  return {
    entryId: 'entry-1',
    creditAccountId: ACCOUNT_ID,
    entryType: 'adjust' as const,
    amount: '30.00',
    balanceAfter: '30.00',
    idempotencyKey: 'adjust:whatever',
    relatedEntryId: null as string | null,
    linkedOrderId: null as string | null,
  }
}

function makeCreditService(adjustCreditMock: jest.Mock): CustomerCreditService {
  return {
    checkCredit: jest.fn(),
    reserveCredit: jest.fn(),
    releaseCredit: jest.fn(),
    settleCredit: jest.fn(),
    adjustCredit: adjustCreditMock,
  }
}

function makeCtx(options: {
  em: ReturnType<typeof makeEm>
  creditService: CustomerCreditService
  tenantId?: string | null
  organizationIds?: string[] | null
  sub?: string
}) {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => options.em }
        if (name === 'customerCreditService') return options.creditService
        throw new Error(`unexpected resolve: ${name}`)
      }),
    },
    auth:
      options.tenantId === null
        ? null
        : { tenantId: options.tenantId ?? TENANT_ID, sub: options.sub ?? USER_ID, orgId: ORG_ID, isApiKey: false },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: options.organizationIds ?? null,
    request: undefined,
  }
}

describe('customer_groups.credit.adjust command', () => {
  describe('execute', () => {
    it('resolves the account inside the caller scope and posts the adjustment', async () => {
      const account = makeAccount()
      const em = makeEm(account)
      const entry = makeEntryView({ amount: '40.00', balanceAfter: '40.00' })
      const adjustCreditMock = jest.fn(async () => ({ entry }) satisfies AdjustCreditResult)
      const creditService = makeCreditService(adjustCreditMock)
      const ctx = makeCtx({ em, creditService, organizationIds: [ORG_ID] })

      const result = await adjustCreditCommand.execute(
        { creditAccountId: ACCOUNT_ID, amount: '40.00', note: 'Manual correction' },
        ctx as never,
      )

      expect(result.entry).toEqual(entry)
      expect(result.tenantId).toBe(TENANT_ID)
      expect(result.organizationId).toBe(ORG_ID)
      expect(result.customerId).toBe(CUSTOMER_ID)
      expect(result.currencyCode).toBe('USD')

      expect(adjustCreditMock).toHaveBeenCalledTimes(1)
      const callInput = adjustCreditMock.mock.calls[0][0] as AdjustCreditInput
      expect(callInput.scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(callInput.buyer).toEqual({ customerId: CUSTOMER_ID })
      expect(callInput.currencyCode).toBe('USD')
      expect(callInput.amount).toBe('40.00')
      expect(callInput.note).toBe('Manual correction')
      expect(callInput.createdByUserId).toBe(USER_ID)
      expect(callInput.idempotencyKey.startsWith('adjust:')).toBe(true)
      expect(callInput.relatedEntryId).toBeUndefined()
    })

    it('refuses zero as a validation error before ever reaching the service', async () => {
      const em = makeEm(makeAccount())
      const creditService = makeCreditService(jest.fn())
      const ctx = makeCtx({ em, creditService })

      await expect(
        adjustCreditCommand.execute({ creditAccountId: ACCOUNT_ID, amount: '0.00', note: 'nope' }, ctx as never),
      ).rejects.toThrow()
    })

    it('answers not-found when the account exists but outside the caller organization scope', async () => {
      const account = makeAccount({ organizationId: OTHER_ORG_ID })
      const em = makeEm(account)
      const creditService = makeCreditService(jest.fn())
      const ctx = makeCtx({ em, creditService, organizationIds: [ORG_ID] })

      await expect(
        adjustCreditCommand.execute({ creditAccountId: ACCOUNT_ID, amount: '10.00', note: 'x' }, ctx as never),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('answers not-found when the account belongs to a different tenant', async () => {
      const account = makeAccount({ tenantId: OTHER_TENANT_ID })
      const em = makeEm(account)
      const creditService = makeCreditService(jest.fn())
      const ctx = makeCtx({ em, creditService, organizationIds: null })

      await expect(
        adjustCreditCommand.execute({ creditAccountId: ACCOUNT_ID, amount: '10.00', note: 'x' }, ctx as never),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('requires a tenant context', async () => {
      const em = makeEm(makeAccount())
      const creditService = makeCreditService(jest.fn())
      const ctx = makeCtx({ em, creditService, tenantId: null })

      await expect(
        adjustCreditCommand.execute({ creditAccountId: ACCOUNT_ID, amount: '10.00', note: 'x' }, ctx as never),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('buildLog / undo (G20)', () => {
    it('buildLog carries everything undo needs to replay the reversal', async () => {
      const entry = makeEntryView({ entryId: 'entry-42', amount: '30.00' })
      const result = { entry, tenantId: TENANT_ID, organizationId: ORG_ID, customerId: CUSTOMER_ID, currencyCode: 'USD' }

      const logMeta = await adjustCreditCommand.buildLog!({
        input: { creditAccountId: ACCOUNT_ID, amount: '30.00', note: 'x' },
        result,
        ctx: {} as never,
        snapshots: {},
      })

      expect(logMeta?.resourceId).toBe(ACCOUNT_ID)
      expect(logMeta?.tenantId).toBe(TENANT_ID)
      expect(logMeta?.organizationId).toBe(ORG_ID)
      expect(logMeta?.payload).toEqual({
        undo: {
          creditAccountId: ACCOUNT_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          customerId: CUSTOMER_ID,
          currencyCode: 'USD',
          entryId: 'entry-42',
          amount: '30.00',
        },
      })
    })

    it('undo posts the inverse amount, linked to the original entry, never a delete', async () => {
      const adjustCreditMock = jest.fn(async () => ({ entry: makeEntryView({ amount: '-30.00' }) }) satisfies AdjustCreditResult)
      const creditService = makeCreditService(adjustCreditMock)
      const ctx = makeCtx({ em: makeEm(makeAccount()), creditService })

      await adjustCreditCommand.undo!({
        input: { creditAccountId: ACCOUNT_ID, amount: '30.00', note: 'original' },
        ctx: ctx as never,
        logEntry: {
          commandPayload: {
            undo: {
              creditAccountId: ACCOUNT_ID,
              tenantId: TENANT_ID,
              organizationId: ORG_ID,
              customerId: CUSTOMER_ID,
              currencyCode: 'USD',
              entryId: 'entry-42',
              amount: '30.00',
            },
          },
        },
      })

      expect(adjustCreditMock).toHaveBeenCalledTimes(1)
      const callInput = adjustCreditMock.mock.calls[0][0] as AdjustCreditInput
      expect(callInput.scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(callInput.buyer).toEqual({ customerId: CUSTOMER_ID })
      expect(callInput.currencyCode).toBe('USD')
      expect(callInput.amount).toBe('-30.00')
      expect(callInput.relatedEntryId).toBe('entry-42')
      expect(callInput.idempotencyKey).toBe('undo:entry-42')
    })

    it('negates an already-negative original amount back to positive', async () => {
      const adjustCreditMock = jest.fn(async () => ({ entry: makeEntryView({ amount: '25.00' }) }) satisfies AdjustCreditResult)
      const creditService = makeCreditService(adjustCreditMock)
      const ctx = makeCtx({ em: makeEm(makeAccount()), creditService })

      await adjustCreditCommand.undo!({
        input: { creditAccountId: ACCOUNT_ID, amount: '-25.00', note: 'original' },
        ctx: ctx as never,
        logEntry: {
          commandPayload: {
            undo: {
              creditAccountId: ACCOUNT_ID,
              tenantId: TENANT_ID,
              organizationId: ORG_ID,
              customerId: CUSTOMER_ID,
              currencyCode: 'USD',
              entryId: 'entry-7',
              amount: '-25.00',
            },
          },
        },
      })

      const callInput = adjustCreditMock.mock.calls[0][0] as AdjustCreditInput
      expect(callInput.amount).toBe('25.00')
      expect(callInput.idempotencyKey).toBe('undo:entry-7')
    })
  })
})
