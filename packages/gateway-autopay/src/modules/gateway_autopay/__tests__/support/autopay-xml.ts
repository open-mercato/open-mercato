import { computeAutopayHash } from '../../lib/hash'

const DEFAULT_SERVICE_ID = '2'
const DEFAULT_SHARED_KEY = '2test2'

export interface Signing {
  serviceId?: string
  sharedKey?: string
}

export interface TransactionFields {
  orderID: string
  remoteID: string
  amount: string
  currency: string
  gatewayID?: string
  paymentDate: string
  paymentStatus: string
  paymentStatusDetails?: string
}

export function transactionXml(fields: TransactionFields): string {
  return (
    '<transaction>' +
    `<orderID>${fields.orderID}</orderID>` +
    `<remoteID>${fields.remoteID}</remoteID>` +
    `<amount>${fields.amount}</amount>` +
    `<currency>${fields.currency}</currency>` +
    `<gatewayID>${fields.gatewayID ?? ''}</gatewayID>` +
    `<paymentDate>${fields.paymentDate}</paymentDate>` +
    `<paymentStatus>${fields.paymentStatus}</paymentStatus>` +
    `<paymentStatusDetails>${fields.paymentStatusDetails ?? ''}</paymentStatusDetails>` +
    '</transaction>'
  )
}

export function statusResponseXml(transactions: TransactionFields[], signing: Signing = {}): string {
  const serviceId = signing.serviceId ?? DEFAULT_SERVICE_ID
  const chainFields = [serviceId, ...transactions.flatMap((transaction) => [
    transaction.orderID,
    transaction.remoteID,
    transaction.amount,
    transaction.currency,
    transaction.gatewayID ?? '',
    transaction.paymentDate,
    transaction.paymentStatus,
    transaction.paymentStatusDetails ?? '',
  ])]
  const hash = computeAutopayHash(chainFields, signing.sharedKey ?? DEFAULT_SHARED_KEY)
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<transactionList><serviceID>${serviceId}</serviceID><transactions>` +
    transactions.map(transactionXml).join('') +
    `</transactions><hash>${hash}</hash></transactionList>`
  )
}

export function cancelResponseXml(
  opts: { confirmation: string; reason?: string; messageId?: string } & Signing,
): string {
  const serviceId = opts.serviceId ?? DEFAULT_SERVICE_ID
  const messageId = opts.messageId ?? 'm1'
  const hash = computeAutopayHash(
    [serviceId, messageId, opts.confirmation, opts.reason],
    opts.sharedKey ?? DEFAULT_SHARED_KEY,
  )
  return (
    '<?xml version="1.0"?><transaction>' +
    `<serviceID>${serviceId}</serviceID><messageID>${messageId}</messageID>` +
    `<confirmation>${opts.confirmation}</confirmation>` +
    (opts.reason ? `<reason>${opts.reason}</reason>` : '') +
    `<hash>${hash}</hash></transaction>`
  )
}

export function refundResponseXml(opts: { messageId: string } & Signing): string {
  const serviceId = opts.serviceId ?? DEFAULT_SERVICE_ID
  const hash = computeAutopayHash([serviceId, opts.messageId], opts.sharedKey ?? DEFAULT_SHARED_KEY)
  return `<?xml version="1.0"?><transactionRefund><serviceID>${serviceId}</serviceID><messageID>${opts.messageId}</messageID><hash>${hash}</hash></transactionRefund>`
}
