import type { StripeGatewaySettings } from '../data.validators'

type SecretScope = {
  organizationId: string
  tenantId: string
}

type ResolvedStripeCredentials = {
  publishableKey?: string
  secretKey: string
  webhookSecret?: string
}

async function resolveFromIntegrationCredentials(
  settings: StripeGatewaySettings,
  scope: SecretScope,
): Promise<ResolvedStripeCredentials | null> {
  const getGlobal = globalThis as unknown as { __omCreateRequestContainer?: () => Promise<{ resolve: (name: string) => unknown }> }
  if (!getGlobal.__omCreateRequestContainer) return null

  try {
    const container = await getGlobal.__omCreateRequestContainer()
    const integrationCredentials = container.resolve('integrationCredentials') as {
      resolve: (integrationId: string, value: SecretScope) => Promise<Record<string, unknown> | null>
    }

    const creds = await integrationCredentials.resolve('gateway_stripe', scope)
    if (!creds || typeof creds.secretKey !== 'string' || !creds.secretKey.trim()) return null

    return {
      publishableKey: typeof creds.publishableKey === 'string' ? creds.publishableKey : settings.publishableKey,
      secretKey: creds.secretKey,
      webhookSecret: typeof creds.webhookSecret === 'string' ? creds.webhookSecret : settings.webhookSecret,
    }
  } catch {
    return null
  }
}

export async function resolveStripeCredentials(
  settings: StripeGatewaySettings,
  scope: SecretScope,
): Promise<ResolvedStripeCredentials> {
  const fromIntegration = await resolveFromIntegrationCredentials(settings, scope)
  if (fromIntegration) return fromIntegration

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
