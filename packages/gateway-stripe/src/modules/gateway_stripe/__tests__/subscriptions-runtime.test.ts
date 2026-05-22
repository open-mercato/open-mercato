const billingPortalConfigurationsList = jest.fn()
const billingPortalConfigurationsUpdate = jest.fn()
const billingPortalConfigurationsCreate = jest.fn()
const billingPortalSessionsCreate = jest.fn()
const checkoutSessionsCreate = jest.fn()

const StripeMock = jest.fn().mockImplementation(() => ({
  checkout: {
    sessions: {
      create: checkoutSessionsCreate,
    },
  },
  billingPortal: {
    configurations: {
      list: billingPortalConfigurationsList,
      update: billingPortalConfigurationsUpdate,
      create: billingPortalConfigurationsCreate,
    },
    sessions: {
      create: billingPortalSessionsCreate,
    },
  },
}))

jest.mock('stripe', () => ({
  __esModule: true,
  default: StripeMock,
}))

import { stripeRecurringRuntime } from '../lib/subscriptions-runtime'

describe('stripeRecurringRuntime.createBillingPortalSession', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('updates the managed portal configuration when required MVP restrictions drift', async () => {
    billingPortalConfigurationsList.mockResolvedValue({
      data: [
        {
          id: 'bpc_existing',
          metadata: {
            om_subscription_portal_config: 'subscriptions-mvp-v1',
          },
          features: {
            customer_update: { enabled: true, allowed_updates: ['email'] },
            invoice_history: { enabled: false },
            payment_method_update: { enabled: true },
            subscription_cancel: {
              enabled: true,
              mode: 'at_period_end',
              proration_behavior: 'create_prorations',
            },
            subscription_update: {
              enabled: false,
              default_allowed_updates: ['price'],
              proration_behavior: 'create_prorations',
            },
          },
        },
      ],
    })
    billingPortalConfigurationsUpdate.mockResolvedValue({ id: 'bpc_updated' })
    billingPortalSessionsCreate.mockResolvedValue({ url: 'https://billing.example/session' })

    const result = await stripeRecurringRuntime.createBillingPortalSession({
      scope: { tenantId: 't1', organizationId: 'o1' },
      customerRef: { providerCustomerId: 'cus_1' },
      returnUrl: 'https://app.example/return',
      allowPlanSwitching: false,
      credentials: { secretKey: 'sk_test_123' },
    })

    expect(billingPortalConfigurationsUpdate).toHaveBeenCalledWith(
      'bpc_existing',
      expect.objectContaining({
        features: expect.objectContaining({
          customer_update: { enabled: false, allowed_updates: [] },
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: expect.objectContaining({
            enabled: true,
            mode: 'at_period_end',
            proration_behavior: 'none',
            cancellation_reason: {
              enabled: false,
              options: [
                'customer_service',
                'low_quality',
                'missing_features',
                'other',
                'switched_service',
                'too_complex',
                'too_expensive',
                'unused',
              ],
            },
          }),
          subscription_update: expect.objectContaining({
            enabled: false,
            default_allowed_updates: [],
            proration_behavior: 'none',
          }),
        }),
      }),
    )
    expect(billingPortalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      configuration: 'bpc_updated',
      return_url: 'https://app.example/return',
    })
    expect(result).toEqual({ portalUrl: 'https://billing.example/session' })
  })
})

describe('stripeRecurringRuntime.createCheckoutSession', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('enables Stripe-hosted promotion codes by default for subscription checkout', async () => {
    checkoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    })

    const result = await stripeRecurringRuntime.createCheckoutSession({
      scope: { tenantId: 't1', organizationId: 'o1' },
      customerRef: { providerCustomerId: 'cus_1' },
      priceRef: { providerPriceRef: 'price_1', priceCode: 'starter-monthly-v1' },
      externalAccountId: 'acct_demo_001',
      successUrl: 'https://app.example/success',
      cancelUrl: 'https://app.example/cancel',
      allowPromotionCodes: true,
      trialPeriodDays: 14,
      credentials: { secretKey: 'sk_test_123' },
      metadata: { subjectEntityId: 'subject-1' },
    })

    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_1',
        allow_promotion_codes: true,
      }),
    )
    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
      providerSessionId: 'cs_test_123',
    })
  })

  it('allows callers to suppress Stripe-hosted promotion codes per checkout request', async () => {
    checkoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_456',
      url: 'https://checkout.stripe.com/c/pay/cs_test_456',
    })

    await stripeRecurringRuntime.createCheckoutSession({
      scope: { tenantId: 't1', organizationId: 'o1' },
      customerRef: { providerCustomerId: 'cus_1' },
      priceRef: { providerPriceRef: 'price_1', priceCode: 'starter-monthly-v1' },
      externalAccountId: 'acct_demo_001',
      successUrl: 'https://app.example/success',
      cancelUrl: 'https://app.example/cancel',
      allowPromotionCodes: false,
      credentials: { secretKey: 'sk_test_123' },
    })

    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        allow_promotion_codes: false,
      }),
    )
  })
})
