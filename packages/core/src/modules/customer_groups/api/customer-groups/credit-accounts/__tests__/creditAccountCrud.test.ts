jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { customerCreditAccountCrud } from '../crud'
import { CustomerCreditAccount } from '../../../../data/entities'

type RawInput = Record<string, unknown>
type CreditAccountCrudOptions = CrudFactoryOptions<RawInput, RawInput, Record<string, unknown>>

const opts = (customerCreditAccountCrud as unknown as { opts: CreditAccountCrudOptions }).opts

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'

function makeAccount(overrides: Partial<CustomerCreditAccount> = {}): CustomerCreditAccount {
  return {
    id: ACCOUNT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
    creditLimit: '1000.00',
    isOnHold: false,
    holdReason: null,
    updatedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerCreditAccount
}

function createCtx(resolvers: Record<string, unknown> = {}): CrudCtx {
  const em = { flush: jest.fn(async () => {}) }
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : resolvers[name]) },
    auth: { tenantId: TENANT_ID, sub: 'user-1', orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as unknown as CrudCtx
}

describe('customer credit account CRUD route', () => {
  describe('update.applyToEntity (hold-reason invariant, merge-aware)', () => {
    it('updates the credit limit without touching the hold state', async () => {
      const account = makeAccount()
      await opts.update!.applyToEntity(account, { id: ACCOUNT_ID, creditLimit: 2500 }, createCtx())
      expect(account.creditLimit).toBe('2500.00')
      expect(account.isOnHold).toBe(false)
      expect(account.holdReason).toBeNull()
    })

    it('rejects turning isOnHold on with no holdReason in the same payload', async () => {
      const account = makeAccount()
      await expect(
        opts.update!.applyToEntity(account, { id: ACCOUNT_ID, isOnHold: true }, createCtx()),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('accepts turning isOnHold on together with a holdReason', async () => {
      const account = makeAccount()
      await opts.update!.applyToEntity(
        account,
        { id: ACCOUNT_ID, isOnHold: true, holdReason: 'Payment overdue' },
        createCtx(),
      )
      expect(account.isOnHold).toBe(true)
      expect(account.holdReason).toBe('Payment overdue')
    })

    // The regression this merge-aware check exists for: a payload that only clears
    // `holdReason` (never touching `isOnHold`) must still be checked against the
    // account's CURRENT `isOnHold`, not pass trivially because the raw payload itself
    // never mentions `isOnHold`.
    it('rejects clearing holdReason while the account is already on hold', async () => {
      const account = makeAccount({ isOnHold: true, holdReason: 'Existing reason' })
      await expect(
        opts.update!.applyToEntity(account, { id: ACCOUNT_ID, holdReason: '' }, createCtx()),
      ).rejects.toMatchObject({ status: 400 })
      expect(account.holdReason).toBe('Existing reason')
    })

    it('allows editing the limit of an already-on-hold account without resending holdReason', async () => {
      const account = makeAccount({ isOnHold: true, holdReason: 'Existing reason' })
      await opts.update!.applyToEntity(account, { id: ACCOUNT_ID, creditLimit: 500 }, createCtx())
      expect(account.creditLimit).toBe('500.00')
      expect(account.isOnHold).toBe(true)
      expect(account.holdReason).toBe('Existing reason')
    })

    it('never writes organizationId/tenantId/customerId/currencyCode from the body', async () => {
      const account = makeAccount()
      await opts.update!.applyToEntity(
        account,
        {
          id: ACCOUNT_ID,
          organizationId: 'other-org',
          tenantId: 'other-tenant',
          customerId: 'other-customer',
          currencyCode: 'EUR',
          creditLimit: 10,
        },
        createCtx(),
      )
      expect(account.organizationId).toBe(ORG_ID)
      expect(account.tenantId).toBe(TENANT_ID)
      expect(account.customerId).toBe(CUSTOMER_ID)
      expect(account.currencyCode).toBe('USD')
    })
  })

  describe('hooks.afterList (display-only exposure/available)', () => {
    // Uses `getAccountExposure` (the row's own known account id), never `checkCredit` —
    // `checkCredit` is purchase-permission-gated (`allowPurchaseOnAccount`) and reports
    // `exposure: null` whenever the group's CURRENT terms disallow on-account purchasing,
    // even for an account with real, nonzero ledger history. A display read for an
    // account that already exists must show its real exposure regardless of today's
    // purchase policy.
    it('merges exposure/available per row via customerCreditService.getAccountExposure', async () => {
      const getAccountExposure = jest.fn(async () => ({ exposure: '250.00', available: '750.00' }))
      const ctx = createCtx({ customerCreditService: { getAccountExposure } })
      const payload = {
        items: [
          { id: ACCOUNT_ID, organization_id: ORG_ID, customer_id: CUSTOMER_ID, currency_code: 'USD' },
        ],
      }
      await opts.hooks!.afterList!(payload, { ...ctx, query: {} })
      expect(getAccountExposure).toHaveBeenCalledWith({
        creditAccountId: ACCOUNT_ID,
        scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      })
      expect(payload.items[0]).toMatchObject({ exposure: '250.00', available: '750.00' })
    })

    it('skips rows missing the fields getAccountExposure needs, without throwing', async () => {
      const getAccountExposure = jest.fn()
      const ctx = createCtx({ customerCreditService: { getAccountExposure } })
      const payload = { items: [{ id: ACCOUNT_ID }] }
      await expect(opts.hooks!.afterList!(payload, { ...ctx, query: {} })).resolves.toBeUndefined()
      expect(getAccountExposure).not.toHaveBeenCalled()
    })

    it('is a no-op for an empty item list', async () => {
      const getAccountExposure = jest.fn()
      const ctx = createCtx({ customerCreditService: { getAccountExposure } })
      const payload = { items: [] as unknown[] }
      await opts.hooks!.afterList!(payload, { ...ctx, query: {} })
      expect(getAccountExposure).not.toHaveBeenCalled()
    })

    // The regression this display-vs-authorization split fixes: a company whose
    // group currently disallows on-account purchasing still has its account's real
    // ledger exposure shown, not `null`/"—".
    it('still reports real exposure when the group currently disallows on-account purchasing', async () => {
      const getAccountExposure = jest.fn(async () => ({ exposure: '150.00', available: null }))
      const ctx = createCtx({ customerCreditService: { getAccountExposure } })
      const payload = {
        items: [
          { id: ACCOUNT_ID, organization_id: ORG_ID, customer_id: CUSTOMER_ID, currency_code: 'USD' },
        ],
      }
      await opts.hooks!.afterList!(payload, { ...ctx, query: {} })
      expect(payload.items[0]).toMatchObject({ exposure: '150.00', available: null })
    })
  })
})
