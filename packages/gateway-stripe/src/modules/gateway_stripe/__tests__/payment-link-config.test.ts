import { describe, expect, it } from '@jest/globals'
import { resolveStripePaymentLinkConfig } from '../lib/payment-link-config'

describe('gateway_stripe payment link config', () => {
  it('defaults to card-only checkout when no profile is provided', () => {
    expect(resolveStripePaymentLinkConfig(undefined)).toMatchObject({
      profile: 'card',
      paymentMethodMode: 'card',
      allowRedirects: 'never',
      showLinkAuthentication: false,
      showBillingAddress: false,
    })
  })

  it('maps inline payment element profile to automatic methods without redirects', () => {
    expect(resolveStripePaymentLinkConfig({ checkoutProfile: 'payment_element' })).toMatchObject({
      profile: 'payment_element',
      paymentMethodMode: 'automatic',
      allowRedirects: 'never',
      showLinkAuthentication: true,
      showBillingAddress: true,
    })
  })

  it('maps redirect-capable payment element profile to automatic methods with redirects', () => {
    expect(resolveStripePaymentLinkConfig({ checkoutProfile: 'payment_element_redirect' })).toMatchObject({
      profile: 'payment_element_redirect',
      paymentMethodMode: 'automatic',
      allowRedirects: 'always',
      showLinkAuthentication: true,
      showBillingAddress: true,
    })
  })
})
