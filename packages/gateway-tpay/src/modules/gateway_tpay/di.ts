import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
  registerWebhookHandler,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { tpayAdapterV1 } from './lib/adapters/v1'
import { tpayHealthCheck } from './lib/health'
import {
  readTpayPaymentIdHint,
  TPAY_WEBHOOK_MAX_BODY_BYTES,
  verifyTpayNotification,
} from './lib/webhook-handler'
import { formatTpayWebhookResponse } from './lib/webhook-response'

export function register(container: AppContainer) {
  registerGatewayAdapter(tpayAdapterV1, { version: 'v1' })
  registerWebhookHandler('tpay', (input) => verifyTpayNotification(input), {
    readPaymentIdHint: readTpayPaymentIdHint,
    rawBody: 'bytes',
    maxBodyBytes: TPAY_WEBHOOK_MAX_BODY_BYTES,
    formatResponse: formatTpayWebhookResponse,
  })
  registerPaymentGatewayDescriptor({
    providerKey: 'tpay',
    label: 'Tpay',
    sessionConfig: {
      fields: [],
      supportedCurrencies: ['PLN'],
      supportedPaymentTypes: [{ value: 'pay_by_link', label: 'Online transfer / BLIK (Tpay hosted page)' }],
      presentation: 'redirect',
    },
  })

  container.register({
    tpayHealthCheck: asValue(tpayHealthCheck),
  })
}
