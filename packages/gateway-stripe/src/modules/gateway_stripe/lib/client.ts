import Stripe from 'stripe'

type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>

export function resolveStripeClient(
  credentials: Record<string, unknown>,
  apiVersion: string,
): Stripe {
  const secretKey = credentials.secretKey as string
  if (!secretKey) {
    throw new Error('Stripe secret key is required')
  }

  return new Stripe(secretKey, {
    apiVersion: apiVersion as StripeConfig['apiVersion'],
    maxNetworkRetries: 2,
    timeout: 10_000,
  })
}
