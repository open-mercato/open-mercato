import type Stripe from 'stripe'

type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>
type StripeConstructor = typeof Stripe

let stripeSdkPromise: Promise<StripeConstructor> | null = null

export async function loadStripeSdk(): Promise<StripeConstructor> {
  const pending = stripeSdkPromise ?? import('stripe').then((module) => module.default)
  stripeSdkPromise = pending

  try {
    return await pending
  } catch (error) {
    if (stripeSdkPromise === pending) {
      stripeSdkPromise = null
    }
    throw error
  }
}

export async function resolveStripeClient(
  credentials: Record<string, unknown>,
  apiVersion: string,
): Promise<Stripe> {
  const secretKey = credentials.secretKey as string
  if (!secretKey) {
    throw new Error('Stripe secret key is required')
  }

  const Stripe = await loadStripeSdk()
  return new Stripe(secretKey, {
    apiVersion: apiVersion as StripeConfig['apiVersion'],
    maxNetworkRetries: 2,
    timeout: 10_000,
  })
}
