import { describe, expect, it, jest } from '@jest/globals'
import type Stripe from 'stripe'
import { createStripePaymentSession, resolveStripePaymentIntentSessionId } from '../lib/session'

const baseInput = {
  paymentId: 'pay_123',
  tenantId: 'tenant_123',
  organizationId: 'org_123',
  amount: 123,
  currencyCode: 'USD',
  description: 'Invoice 123',
  successUrl: 'http://localhost:3000/pay/token-123?checkout=success',
  cancelUrl: 'http://localhost:3000/pay/token-123?checkout=cancelled',
  credentials: {
    publishableKey: 'pk_test_123',
  },
} as const

describe('gateway_stripe session helpers', () => {
  it('creates a hosted Stripe Checkout session for redirect profile payment links', async () => {
    const createCheckoutSession = jest.fn().mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      payment_status: 'unpaid',
      payment_intent: 'pi_test_123',
    })
    const stripe = {
      checkout: {
        sessions: {
          create: createCheckoutSession,
        },
      },
    } as unknown as Stripe

    const result = await createStripePaymentSession(stripe, {
      ...baseInput,
      providerInput: {
        checkoutProfile: 'payment_element_redirect',
      },
    })

    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      success_url: baseInput.successUrl,
      cancel_url: baseInput.cancelUrl,
      expand: ['payment_intent'],
    }))
    expect(result).toMatchObject({
      sessionId: 'pi_test_123',
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
      status: 'pending',
      providerData: {
        checkoutSessionId: 'cs_test_123',
        paymentIntentId: 'pi_test_123',
        publishableKey: 'pk_test_123',
      },
    })
  })

  it('resolves a payment intent from a Stripe Checkout session id', async () => {
    const retrieveCheckoutSession = jest.fn().mockResolvedValue({
      id: 'cs_test_123',
      payment_intent: { id: 'pi_test_123' },
    })
    const stripe = {
      checkout: {
        sessions: {
          retrieve: retrieveCheckoutSession,
        },
      },
    } as unknown as Stripe

    await expect(resolveStripePaymentIntentSessionId(stripe, 'cs_test_123')).resolves.toBe('pi_test_123')
    expect(retrieveCheckoutSession).toHaveBeenCalledWith('cs_test_123', {
      expand: ['payment_intent'],
    })
  })
})
