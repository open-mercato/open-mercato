import { statusResponseXml, type TransactionFields } from '../../__tests__/support/autopay-xml'
import { AUTOPAY_FIXTURE_SERVICE_ID, AUTOPAY_FIXTURE_SHARED_KEY } from './fixtures'

/** Autopay reports amounts with two decimals, e.g. `12.50`. */
export function formatAutopayAmount(amount: number): string {
  return amount.toFixed(2)
}

function transactionFields(orderId: string, amount: number, paymentStatus: 'SUCCESS' | 'PENDING'): TransactionFields {
  return {
    orderID: orderId,
    remoteID: `remote-${orderId.slice(0, 8)}`,
    amount: formatAutopayAmount(amount),
    currency: 'PLN',
    gatewayID: '',
    paymentDate: '20261117120000',
    paymentStatus,
    paymentStatusDetails: paymentStatus === 'SUCCESS' ? 'AUTHORIZED' : '',
  }
}

/** A `transactionStatus` body with one settled transaction, signed with the fixture key. */
export function settledStatusXml(orderId: string, amount: number): string {
  return statusResponseXml([transactionFields(orderId, amount, 'SUCCESS')], {
    serviceId: AUTOPAY_FIXTURE_SERVICE_ID,
    sharedKey: AUTOPAY_FIXTURE_SHARED_KEY,
  })
}

/** A `transactionStatus` body with one still-pending transaction, signed with the fixture key. */
export function pendingStatusXml(orderId: string, amount: number): string {
  return statusResponseXml([transactionFields(orderId, amount, 'PENDING')], {
    serviceId: AUTOPAY_FIXTURE_SERVICE_ID,
    sharedKey: AUTOPAY_FIXTURE_SHARED_KEY,
  })
}

/**
 * A settled transaction signed with a key the tenant does not hold. The client
 * must reject it at hash verification, so the payment stays pending.
 */
export function foreignKeyStatusXml(orderId: string, amount: number): string {
  return statusResponseXml([transactionFields(orderId, amount, 'SUCCESS')], {
    serviceId: AUTOPAY_FIXTURE_SERVICE_ID,
    sharedKey: 'not-the-tenant-shared-key',
  })
}
