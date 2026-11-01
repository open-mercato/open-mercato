import { listCheckoutPaymentMethods } from '../paymentMethods'

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: 'stripe',
    label: 'Stripe',
    isConfigured: true,
    requiresConfiguration: true,
    configurationStatus: 'configured',
    sessionConfig: { supportedCurrencies: '*' },
    ...overrides,
  }
}

function makeContainer(descriptorService: unknown, registrations: Record<string, unknown> = {}) {
  return {
    resolve: (name: string) => {
      if (name === 'paymentGatewayDescriptorService') {
        if (!descriptorService) throw new Error('paymentGatewayDescriptorService is not registered')
        return descriptorService
      }
      if (name in registrations) return registrations[name]
      throw new Error(`Unexpected DI token: ${name}`)
    },
  }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const BUYER = { customerId: 'customer-1', customerIds: ['customer-1'] }

describe('listCheckoutPaymentMethods (§5.5, B.3 gateway half only)', () => {
  it('returns an empty list — never throws — when payment_gateways is absent (C10/D-R5-18)', async () => {
    const container = makeContainer(null)

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null })

    expect(result).toEqual([])
  })

  it('lists every configured descriptor supporting the session currency for a non-link session', async () => {
    const listResolved = jest.fn().mockResolvedValue([
      descriptor({ providerKey: 'stripe', sessionConfig: { supportedCurrencies: ['USD', 'EUR'] } }),
      descriptor({ providerKey: 'paypal', sessionConfig: { supportedCurrencies: ['GBP'] } }),
      descriptor({ providerKey: 'unconfigured', isConfigured: false }),
    ])
    const container = makeContainer({ listResolved })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null })

    expect(result).toEqual([{ providerKey: 'stripe', label: 'Stripe', kind: 'gateway' }])
    expect(listResolved).toHaveBeenCalledWith(SCOPE)
  })

  it('restricts to the link\'s own single configured provider for a link session', async () => {
    const listResolved = jest.fn().mockResolvedValue([
      descriptor({ providerKey: 'stripe', label: 'Stripe' }),
      descriptor({ providerKey: 'paypal', label: 'PayPal' }),
    ])
    const container = makeContainer({ listResolved })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: 'paypal' })

    expect(result).toEqual([{ providerKey: 'paypal', label: 'PayPal', kind: 'gateway' }])
  })

  it('treats a currency not in the descriptor\'s supported list as unavailable', async () => {
    const listResolved = jest.fn().mockResolvedValue([
      descriptor({ providerKey: 'stripe', sessionConfig: { supportedCurrencies: ['EUR'] } }),
    ])
    const container = makeContainer({ listResolved })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null })

    expect(result).toEqual([])
  })
})

// Release 5, Step 5.1 (§5.5's B.5 half, D-R5-5/D-R5-20). `on_account` and `request_quote`
// gate independently of one another — covered by separate tests rather than one combined
// "B.5 methods" test, per the Step's own test list.
describe('listCheckoutPaymentMethods (§5.5, B.5 half: on_account/request_quote)', () => {
  it('never offers on_account or request_quote to a guest cart (no buyer identity, OQ1)', async () => {
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: true, allowQuoteRequests: true }))
    const container = makeContainer(null, { customerGroupsService: { resolveTerms } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: null })

    expect(result).toEqual([])
    expect(resolveTerms).not.toHaveBeenCalled()
  })

  it('offers request_quote when allowQuoteRequests resolves true, independent of on_account', async () => {
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: false, allowQuoteRequests: true }))
    const container = makeContainer(null, { customerGroupsService: { resolveTerms } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

    expect(result).toEqual([{ kind: 'request_quote' }])
    expect(resolveTerms).toHaveBeenCalledWith({
      customerId: BUYER.customerId,
      customerIds: BUYER.customerIds,
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })
  })

  it('omits request_quote when allowQuoteRequests resolves false (tenant default)', async () => {
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: false, allowQuoteRequests: false }))
    const container = makeContainer(null, { customerGroupsService: { resolveTerms } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

    expect(result).toEqual([])
  })

  it('offers on_account when allowPurchaseOnAccount is true and checkCredit finds an eligible account, independent of request_quote', async () => {
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: true, allowQuoteRequests: false }))
    const checkCredit = jest.fn(async () => ({ allowed: true, reason: 'ok' }))
    const container = makeContainer(null, { customerGroupsService: { resolveTerms }, customerCreditService: { checkCredit } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

    expect(result).toEqual([{ kind: 'on_account' }])
    // `customerIds` (the buyer's full identity), never the bare `customerId`, must reach
    // `checkCredit` — only `customerIds` drives `resolveBuyerCustomerId`'s company-first
    // resolution (`customerCreditService.ts`), and a credit account is held by the
    // COMPANY, not the person. See the dedicated regression test below for the case this
    // fixture's `customerIds === [customerId]` shape cannot distinguish on its own.
    expect(checkCredit).toHaveBeenCalledWith({ scope: SCOPE, buyer: { customerIds: BUYER.customerIds }, currencyCode: 'USD', amount: '0' })
  })

  // Regression: `BUYER` above has `customerIds === [customerId]`, so it cannot tell
  // apart "passed the bare customerId" from "passed customerIds" — both resolve to the
  // same single id. A buyer whose full identity includes a DIFFERENT (company) id makes
  // the distinction concrete: `submit.ts`'s own `reserveCredit` call always passes
  // `customerIds`, and this listing must agree, or `on_account` can be missing here
  // while submit still accepts it (the bug this test guards against).
  it('passes the full customerIds identity to checkCredit, not just the person-only customerId', async () => {
    const buyer = { customerId: 'person-1', customerIds: ['person-1', 'company-1'] }
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: true, allowQuoteRequests: false }))
    const checkCredit = jest.fn(async () => ({ allowed: true, reason: 'ok' }))
    const container = makeContainer(null, { customerGroupsService: { resolveTerms }, customerCreditService: { checkCredit } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer })

    expect(result).toEqual([{ kind: 'on_account' }])
    expect(checkCredit).toHaveBeenCalledWith({
      scope: SCOPE,
      buyer: { customerIds: ['person-1', 'company-1'] },
      currencyCode: 'USD',
      amount: '0',
    })
  })

  it.each(['no_account', 'on_hold', 'not_permitted'] as const)(
    'omits on_account when checkCredit refuses with reason=%s',
    async (reason) => {
      const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: true, allowQuoteRequests: false }))
      const checkCredit = jest.fn(async () => ({ allowed: false, reason }))
      const container = makeContainer(null, { customerGroupsService: { resolveTerms }, customerCreditService: { checkCredit } })

      const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

      expect(result).toEqual([])
    },
  )

  it('omits on_account when the term itself disallows purchase on account, without ever calling checkCredit', async () => {
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: false, allowQuoteRequests: false }))
    const checkCredit = jest.fn()
    const container = makeContainer(null, { customerGroupsService: { resolveTerms }, customerCreditService: { checkCredit } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

    expect(result).toEqual([])
    expect(checkCredit).not.toHaveBeenCalled()
  })

  it('offers both on_account and request_quote together when both terms allow it', async () => {
    const resolveTerms = jest.fn(async () => ({ allowPurchaseOnAccount: true, allowQuoteRequests: true }))
    const checkCredit = jest.fn(async () => ({ allowed: true, reason: 'ok' }))
    const container = makeContainer(null, { customerGroupsService: { resolveTerms }, customerCreditService: { checkCredit } })

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

    expect(result).toEqual([{ kind: 'on_account' }, { kind: 'request_quote' }])
  })

  it('returns no B.5 methods — never throws — when customer_groups is absent (C10/D-R5-18)', async () => {
    const container = makeContainer(null, {})

    const result = await listCheckoutPaymentMethods(container, SCOPE, { currencyCode: 'USD', linkGatewayProviderKey: null, buyer: BUYER })

    expect(result).toEqual([])
  })
})
