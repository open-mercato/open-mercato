import { queryTransactionStatus, resolveApiHost, type AutopayCredentials } from './autopay-client'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

export const autopayHealthCheck = {
  /**
   * Probes `transactionStatus` with a synthetic, never-real OrderID. Autopay
   * is documented to answer "no transaction found" for an unknown OrderID
   * rather than erroring, so this never creates or affects a real
   * transaction — it only proves the credentials/host/hash are valid.
   */
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    try {
      const serviceId = credentials.serviceId
      const sharedKey = credentials.sharedKey
      const gatewayUrl = credentials.gatewayUrl
      if (typeof serviceId !== 'string' || !serviceId) throw new Error('serviceId is not configured')
      if (typeof sharedKey !== 'string' || !sharedKey) throw new Error('sharedKey is not configured')
      if (typeof gatewayUrl !== 'string' || !gatewayUrl) throw new Error('gatewayUrl is not configured')

      const host = resolveApiHost(gatewayUrl)
      const probeCredentials: AutopayCredentials = {
        serviceId,
        sharedKey,
        gatewayUrl,
        hashAlgorithm: credentials.hashAlgorithm === 'sha512' ? 'sha512' : 'sha256',
      }
      const probeOrderId = `health-probe-${Date.now().toString(36)}`
      const { transactions } = await queryTransactionStatus(probeCredentials, { orderId: probeOrderId })

      return {
        status: 'healthy',
        message: `Connected to Autopay (${host})`,
        details: { host, probedTransactions: transactions.length },
        checkedAt: new Date(),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return {
        status: 'unhealthy',
        message: `Autopay connection failed: ${message}`,
        details: { error: message },
        checkedAt: new Date(),
      }
    }
  },
}
