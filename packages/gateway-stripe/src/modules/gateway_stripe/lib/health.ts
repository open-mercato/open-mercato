import Stripe from 'stripe'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

export const stripeHealthCheck = {
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    try {
      const stripe = new Stripe(credentials.secretKey as string)
      const account = await stripe.accounts.retrieve()

      return {
        status: 'healthy',
        message: `Connected to Stripe account ${account.id}`,
        details: {
          accountId: account.id,
          businessType: account.business_type,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          country: account.country,
        },
        checkedAt: new Date(),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return {
        status: 'unhealthy',
        message: `Stripe connection failed: ${message}`,
        details: { error: message },
        checkedAt: new Date(),
      }
    }
  },
}
