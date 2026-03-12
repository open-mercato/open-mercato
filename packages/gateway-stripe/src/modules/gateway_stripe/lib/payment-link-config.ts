export const STRIPE_PAYMENT_LINK_PROFILES = [
  'card',
  'card_customer',
  'payment_element',
  'payment_element_redirect',
] as const

export type StripePaymentLinkProfile = (typeof STRIPE_PAYMENT_LINK_PROFILES)[number]

export type StripePaymentLinkConfig = {
  profile: StripePaymentLinkProfile
  paymentMethodMode: 'card' | 'automatic'
  allowRedirects: 'never' | 'always'
  showLinkAuthentication: boolean
  showBillingAddress: boolean
  billingNameDisplay: 'full' | 'split'
  paymentElementLayout: 'tabs' | 'accordion'
  billingDetailsCollection: 'auto' | 'separate'
}

const DEFAULT_PROFILE: StripePaymentLinkProfile = 'card'

function isStripePaymentLinkProfile(value: unknown): value is StripePaymentLinkProfile {
  return typeof value === 'string' && STRIPE_PAYMENT_LINK_PROFILES.includes(value as StripePaymentLinkProfile)
}

export function resolveStripePaymentLinkConfig(
  input: Record<string, unknown> | null | undefined,
): StripePaymentLinkConfig {
  const profile = isStripePaymentLinkProfile(input?.checkoutProfile)
    ? input.checkoutProfile
    : DEFAULT_PROFILE

  switch (profile) {
    case 'card_customer':
      return {
        profile,
        paymentMethodMode: 'card',
        allowRedirects: 'never',
        showLinkAuthentication: true,
        showBillingAddress: true,
        billingNameDisplay: 'split',
        paymentElementLayout: 'tabs',
        billingDetailsCollection: 'separate',
      }
    case 'payment_element':
      return {
        profile,
        paymentMethodMode: 'automatic',
        allowRedirects: 'never',
        showLinkAuthentication: true,
        showBillingAddress: true,
        billingNameDisplay: 'split',
        paymentElementLayout: 'accordion',
        billingDetailsCollection: 'separate',
      }
    case 'payment_element_redirect':
      return {
        profile,
        paymentMethodMode: 'automatic',
        allowRedirects: 'always',
        showLinkAuthentication: true,
        showBillingAddress: true,
        billingNameDisplay: 'split',
        paymentElementLayout: 'accordion',
        billingDetailsCollection: 'separate',
      }
    case 'card':
    default:
      return {
        profile: 'card',
        paymentMethodMode: 'card',
        allowRedirects: 'never',
        showLinkAuthentication: false,
        showBillingAddress: false,
        billingNameDisplay: 'full',
        paymentElementLayout: 'tabs',
        billingDetailsCollection: 'auto',
      }
  }
}
