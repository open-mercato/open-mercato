jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('../../../../lib/customerScope', () => ({
  findCustomerInScope: jest.fn(),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { CREDIT_ACCOUNT_EXISTS_CODE, customerCreditAccountCrud } from '../crud'
import { customerCreditAccountCreateRequestSchema, type CustomerCreditAccountCreateRequest } from '../../../../data/validators'
import { findCustomerInScope } from '../../../../lib/customerScope'

type CreditAccountCrudOptions = CrudFactoryOptions<CustomerCreditAccountCreateRequest, Record<string, unknown>, Record<string, unknown>>

const opts = (customerCreditAccountCrud as unknown as { opts: CreditAccountCrudOptions }).opts
const findCustomerInScopeMock = findCustomerInScope as jest.MockedFunction<typeof findCustomerInScope>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const SELECTED_ORG_ID = '55555555-5555-4555-8555-555555555555'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '66666666-6666-4666-8666-666666666666'

function createCtx(options: { existingCount?: number; selectedOrganizationId?: string | null } = {}) {
  const count = jest.fn(async () => options.existingCount ?? 0)
  const em = { fork: () => em, count }
  const ctx = {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { tenantId: TENANT_ID, sub: USER_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: options.selectedOrganizationId ?? null,
    organizationIds: null,
    request: undefined,
  } as unknown as CrudCtx
  return { ctx, count }
}

function parse(body: Record<string, unknown>) {
  return customerCreditAccountCreateRequestSchema.safeParse(body)
}

describe('customer credit account create (G13/D-R5-5)', () => {
  beforeEach(() => {
    findCustomerInScopeMock.mockReset()
  })

  describe('request schema', () => {
    it('accepts the minimal body and normalizes the currency code', () => {
      const result = parse({ customerId: CUSTOMER_ID, currencyCode: ' usd ', creditLimit: '1500.5' })
      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1500.5 })
    })

    it('requires creditLimit (the group default only pre-fills the form)', () => {
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD' }).success).toBe(false)
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: '' }).success).toBe(false)
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: null }).success).toBe(false)
    })

    it('rejects negative limits, more than 2 decimal places and malformed currencies', () => {
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: -1 }).success).toBe(false)
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: '1.234' }).success).toBe(false)
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'US', creditLimit: 1 }).success).toBe(false)
    })

    it('is strict: scope and audit fields cannot be smuggled through the body', () => {
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1, tenantId: TENANT_ID }).success).toBe(false)
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1, organizationId: ORG_ID }).success).toBe(false)
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1, updatedByUserId: USER_ID }).success).toBe(false)
    })

    it('requires a hold reason when the account is created on hold', () => {
      expect(parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1, isOnHold: true }).success).toBe(false)
      expect(
        parse({ customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1, isOnHold: true, holdReason: 'KYC pending' }).success,
      ).toBe(true)
    })
  })

  describe('create.mapToEntity', () => {
    it('writes the limit as a 2-dp decimal string and the acting user from the session', () => {
      const { ctx } = createCtx()
      const data = opts.create!.mapToEntity(
        { customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 1500.5, holdReason: 'ignored while not on hold' },
        ctx,
      )
      expect(data).toEqual({
        customerId: CUSTOMER_ID,
        currencyCode: 'USD',
        creditLimit: '1500.50',
        isOnHold: false,
        holdReason: null,
        updatedByUserId: USER_ID,
      })
    })
  })

  describe('hooks.beforeCreate', () => {
    const input: CustomerCreditAccountCreateRequest = { customerId: CUSTOMER_ID, currencyCode: 'USD', creditLimit: 100 }

    it('checks the customer against the target organization only', async () => {
      findCustomerInScopeMock.mockResolvedValue({ organizationId: SELECTED_ORG_ID })
      const { ctx, count } = createCtx({ selectedOrganizationId: SELECTED_ORG_ID })
      await opts.hooks!.beforeCreate!(input, ctx)
      expect(findCustomerInScopeMock).toHaveBeenCalledWith(expect.anything(), CUSTOMER_ID, {
        tenantId: TENANT_ID,
        organizationIds: [SELECTED_ORG_ID],
      })
      expect(count).toHaveBeenCalledWith(expect.anything(), {
        tenantId: TENANT_ID,
        organizationId: SELECTED_ORG_ID,
        customerId: CUSTOMER_ID,
        currencyCode: 'USD',
        deletedAt: null,
      })
    })

    it('answers 400 when the customer is not in the target organization', async () => {
      findCustomerInScopeMock.mockResolvedValue(null)
      const { ctx, count } = createCtx()
      await expect(opts.hooks!.beforeCreate!(input, ctx)).rejects.toMatchObject({ status: 400 })
      expect(count).not.toHaveBeenCalled()
    })

    it('answers 409 credit_account_exists for a live account in the same currency', async () => {
      findCustomerInScopeMock.mockResolvedValue({ organizationId: ORG_ID })
      const { ctx } = createCtx({ existingCount: 1 })
      await expect(opts.hooks!.beforeCreate!(input, ctx)).rejects.toMatchObject({
        status: 409,
        body: { code: CREDIT_ACCOUNT_EXISTS_CODE },
      })
    })
  })
})
