import Stripe from 'stripe'

export type HealthCheckResult = {
  status: 'healthy' | 'unhealthy'
  message: string
  details?: Record<string, unknown>
  checkedAt: Date
}

export type HealthCheckable = {
  check: (credentials: Record<string, unknown>) => Promise<HealthCheckResult>
}

export const stripeHealthCheck: HealthCheckable = {
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    try {
      const secretKey = typeof credentials.secretKey === 'string' ? credentials.secretKey : ''
      if (!secretKey.trim()) {
        return {
          status: 'unhealthy',
          message: 'Missing Stripe secret key',
          checkedAt: new Date(),
        }
      }

      const stripe = new Stripe(secretKey, { apiVersion: '2026-02-25.clover' })
      const account = await stripe.accounts.retrieve()

      return {
        status: 'healthy',
        message: `Connected to Stripe account ${account.id}`,
        details: {
          accountId: account.id,
          country: account.country,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        },
        checkedAt: new Date(),
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Stripe health check failed',
        checkedAt: new Date(),
      }
    }
  },
}
