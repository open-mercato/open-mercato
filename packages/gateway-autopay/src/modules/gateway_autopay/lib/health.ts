import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { queryTransactionStatus, resolveApiHost, type AutopayCredentials } from './autopay-client'
import { reportAutopayError } from './error-reporting'

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  details: Record<string, unknown>
  checkedAt: Date
}

type MissingCredentialField = 'serviceId' | 'sharedKey' | 'gatewayUrl'

const MISSING_CREDENTIAL_MESSAGES: Record<MissingCredentialField, { key: string; fallback: string }> = {
  serviceId: {
    key: 'gateway_autopay.health.serviceIdMissing',
    fallback: 'Autopay Service ID is not configured.',
  },
  sharedKey: {
    key: 'gateway_autopay.health.sharedKeyMissing',
    fallback: 'Autopay Shared Key is not configured.',
  },
  gatewayUrl: {
    key: 'gateway_autopay.health.gatewayUrlMissing',
    fallback: 'Autopay Payment Initiation URL is not configured.',
  },
}

class MissingCredentialError extends Error {
  constructor(readonly field: MissingCredentialField) {
    super(`[internal] ${field} is not configured`)
  }
}

function readRequiredCredential(credentials: Record<string, unknown>, field: MissingCredentialField): string {
  const value = credentials[field]
  if (typeof value !== 'string' || !value) throw new MissingCredentialError(field)
  return value
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
   *
   * The displayed `message` is always localized static text; the raw
   * diagnostic stays in `details.error` for operators.
   */
  async check(credentials: Record<string, unknown>): Promise<HealthCheckResult> {
    const { t } = await resolveTranslations()
    try {
      const serviceId = readRequiredCredential(credentials, 'serviceId')
      const sharedKey = readRequiredCredential(credentials, 'sharedKey')
      const gatewayUrl = readRequiredCredential(credentials, 'gatewayUrl')

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
        message: t('gateway_autopay.health.connected', 'Connected to Autopay ({host})', { host }),
        details: { host, probedTransactions: transactions.length },
        checkedAt: new Date(),
      }
    } catch (err: unknown) {
      const diagnostic = err instanceof Error ? err.message : 'Unknown error'
      if (err instanceof MissingCredentialError) {
        const { key, fallback } = MISSING_CREDENTIAL_MESSAGES[err.field]
        return {
          status: 'unhealthy',
          message: t(key, fallback),
          details: { error: diagnostic, missingCredential: err.field },
          checkedAt: new Date(),
        }
      }
      reportAutopayError(err, 'gateway_autopay.health_check_failed')
      return {
        status: 'unhealthy',
        message: t(
          'gateway_autopay.health.connectionFailed',
          'Autopay connection failed. Check the Service ID, shared key and payment initiation URL, then try again.',
        ),
        details: { error: diagnostic },
        checkedAt: new Date(),
      }
    }
  },
}
