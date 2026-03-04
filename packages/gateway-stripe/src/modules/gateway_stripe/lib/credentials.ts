import type { StripeGatewaySettings } from '../data/validators'

type SecretScope = {
  organizationId: string
  tenantId: string
}

type ResolvedStripeCredentials = {
  publishableKey?: string
  secretKey: string
  webhookSecret?: string
}

export async function resolveStripeCredentials(
  settings: StripeGatewaySettings,
  _scope: SecretScope,
): Promise<ResolvedStripeCredentials> {
  const secretKey = settings.secretKey || process.env.STRIPE_SECRET_KEY || ''
  if (!secretKey.trim()) {
    throw new Error('Stripe secret key is missing. Configure STRIPE_SECRET_KEY or gateway credentials.')
  }

  return {
    publishableKey: settings.publishableKey || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    secretKey,
    webhookSecret: settings.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
  }
}
