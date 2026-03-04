import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
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
  scope: SecretScope,
): Promise<ResolvedStripeCredentials> {
  try {
    const container = await createRequestContainer()
    const integrationCredentials = container.resolve('integrationCredentials') as {
      resolve: (
        integrationId: string,
        scope: { tenantId: string; organizationId?: string | null },
      ) => Promise<Record<string, unknown> | null>
    }

    const creds = await integrationCredentials.resolve('gateway_stripe', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    if (creds && typeof creds.secretKey === 'string' && creds.secretKey.trim()) {
      return {
        publishableKey:
          (typeof creds.publishableKey === 'string' ? creds.publishableKey : undefined)
          ?? settings.publishableKey
          ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
        secretKey: creds.secretKey,
        webhookSecret:
          (typeof creds.webhookSecret === 'string' ? creds.webhookSecret : undefined)
          ?? settings.webhookSecret
          ?? process.env.STRIPE_WEBHOOK_SECRET,
      }
    }
  } catch {
    // Fallback to provider settings and environment variables.
  }

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
