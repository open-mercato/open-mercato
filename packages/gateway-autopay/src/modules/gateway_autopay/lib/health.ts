import { queryTransactionStatus, resolveApiHost, type AutopayCredentials } from './autopay-client'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

export const autopayHealthCheck = {
  /**
   * Probes `transactionStatus` with a synthetic, never-real OrderID. This
   * only ever creates or affects a real transaction if that literal OrderID
   * happens to collide with one — practically impossible given the
   * timestamp-based suffix.
   *
   * `queryTransactionStatus` never throws for "no transaction found" (with
   * or without an accompanying `<reason>`) — it returns an empty
   * `transactions` array instead, so a successful round trip with any
   * number of transactions (zero included) means the credentials, host, and
   * hash all validated correctly, which is all this check claims. It still
   * throws (and this reports `unhealthy`) for a genuine failure: wrong
   * host, network error, or a response that fails hash verification.
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
