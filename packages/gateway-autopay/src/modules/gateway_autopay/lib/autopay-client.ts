import { randomUUID } from 'node:crypto'
import { computeAutopayHash, type AutopayHashAlgorithm } from './hash'
import type { AutopayTransactionRecord } from './status-map'

export interface AutopayCredentials {
  serviceId: string
  sharedKey: string
  hashAlgorithm?: AutopayHashAlgorithm
  gatewayUrl: string
}

const SANDBOX_HOST = 'https://testpay.autopay.eu'
const PRODUCTION_HOST = 'https://pay.autopay.eu'
const KNOWN_HOSTS = [SANDBOX_HOST, PRODUCTION_HOST]
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1_000_000

export class AutopayApiError extends Error {
  readonly reason?: string
  readonly code?: string

  constructor(message: string, options?: { reason?: string; code?: string }) {
    super(message)
    this.name = 'AutopayApiError'
    this.reason = options?.reason
    this.code = options?.code
  }
}

/**
 * The docs (§ "Adresy środowisk") only document two fixed hosts. `gatewayUrl`
 * itself is partner-specific (issued at onboarding) and only used verbatim
 * for session creation — the status/cancel/refund APIs are documented as
 * fixed paths under the same host, so we derive the host from `gatewayUrl`
 * rather than asking the operator to configure it twice.
 */
export function resolveApiHost(gatewayUrl: string): string {
  const origin = new URL(gatewayUrl).origin
  if (!KNOWN_HOSTS.includes(origin)) {
    throw new AutopayApiError(
      `[internal] Unrecognized Autopay host "${origin}". Expected ${SANDBOX_HOST} (sandbox) or ${PRODUCTION_HOST} (production).`,
    )
  }
  return origin
}

function hash(credentials: AutopayCredentials, fields: Array<string | number | null | undefined>): string {
  return computeAutopayHash(fields, credentials.sharedKey, credentials.hashAlgorithm)
}

/** Autopay's OrderID charset is alnum + "-_", max 32 chars. A UUID with its
 * dashes stripped is exactly 32 hex characters, which is why dashes are
 * stripped first rather than simply truncated. */
export function sanitizeOrderId(paymentId: string): string {
  const stripped = paymentId.replace(/-/g, '')
  const sanitized = stripped.replace(/[^a-zA-Z0-9_-]/g, '')
  return sanitized.slice(0, 32)
}

export function generateMessageId(): string {
  return randomUUID().replace(/-/g, '')
}

export interface BuildSessionRequestInput {
  credentials: AutopayCredentials
  orderId: string
  amount: string
  currencyCode?: string
  description?: string
  gatewayId?: string
  customerEmail: string
}

export interface BuildSessionRequestResult {
  redirectUrl: string
  formPost: { url: string; method: 'POST'; fields: Record<string, string> }
  fields: Record<string, string>
}

/**
 * Builds the signed field set for session initiation. No outbound HTTP call
 * is made — Autopay's own docs (§ "Sposób rozpoczęcia transakcji") describe
 * this as a browser-submitted HTTPS call to the partner-specific gatewayUrl,
 * demonstrated in the docs as a POST. This also returns a GET-style
 * `redirectUrl` as a defensive fallback, since the docs do not explicitly
 * state that GET is rejected — whichever transport the consuming redirect
 * renderer actually uses should be verified once real sandbox access exists.
 */
export function buildSessionRequest(input: BuildSessionRequestInput): BuildSessionRequestResult {
  const { credentials } = input
  const orderedFields: Array<[string, string | undefined]> = [
    ['ServiceID', credentials.serviceId],
    ['OrderID', input.orderId],
    ['Amount', input.amount],
    ['Description', input.description],
    ['GatewayID', input.gatewayId],
    ['Currency', input.currencyCode],
    ['CustomerEmail', input.customerEmail],
  ]

  const signedHash = hash(credentials, orderedFields.map(([, value]) => value))

  const fields: Record<string, string> = {}
  for (const [key, value] of orderedFields) {
    if (value !== undefined && value !== null && value !== '') fields[key] = value
  }
  fields.Hash = signedHash

  const query = new URLSearchParams(fields).toString()
  return {
    redirectUrl: `${credentials.gatewayUrl}?${query}`,
    formPost: { url: credentials.gatewayUrl, method: 'POST', fields },
    fields,
  }
}

function extractTag(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return match ? unescapeXmlEntities(match[1]) : null
}

function unescapeXmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? _
  ))
}

/**
 * The docs give a worked XML example for the >50-transaction error case
 * (top-level `<transaction><reason>...</reason></transaction>`) but no
 * literal example of the successful multi-transaction response body, so this
 * parser is deliberately tolerant: it extracts every repeating
 * `<transaction>...</transaction>` block regardless of what wraps them,
 * rather than assuming an unconfirmed root element name.
 */
function parseTransactionRecords(xml: string): AutopayTransactionRecord[] {
  const blocks = xml.match(/<transaction>[\s\S]*?<\/transaction>/g) ?? []
  return blocks
    .map((block) => ({
      orderID: extractTag(block, 'orderID') ?? '',
      remoteID: extractTag(block, 'remoteID') ?? '',
      amount: extractTag(block, 'amount') ?? '',
      currency: extractTag(block, 'currency') ?? '',
      gatewayID: extractTag(block, 'gatewayID') ?? undefined,
      paymentDate: extractTag(block, 'paymentDate') ?? '',
      paymentStatus: extractTag(block, 'paymentStatus') ?? '',
      paymentStatusDetails: extractTag(block, 'paymentStatusDetails') ?? undefined,
    }))
    .filter((record) => record.orderID !== '')
}

function transactionRecordFields(record: AutopayTransactionRecord): Array<string | undefined> {
  return [
    record.orderID,
    record.remoteID,
    record.amount,
    record.currency,
    record.gatewayID,
    record.paymentDate,
    record.paymentStatus,
    record.paymentStatusDetails,
  ]
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...extraHeaders,
      },
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal,
    })
    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new AutopayApiError('[internal] Autopay response exceeded the maximum allowed size')
    }
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new AutopayApiError('[internal] Autopay response exceeded the maximum allowed size')
    }
    if (!response.ok) {
      throw new AutopayApiError(`Autopay request failed with HTTP ${response.status}`, {
        code: String(response.status),
      })
    }
    return text
  } finally {
    clearTimeout(timeout)
  }
}

export interface TransactionStatusResult {
  transactions: AutopayTransactionRecord[]
}

/** `transactionStatus` — docs § "Odpytanie o status transakcji". */
export async function queryTransactionStatus(
  credentials: AutopayCredentials,
  input: { orderId: string },
): Promise<TransactionStatusResult> {
  const host = resolveApiHost(credentials.gatewayUrl)
  const requestHash = hash(credentials, [credentials.serviceId, input.orderId])

  const xml = await postForm(
    `${host}/webapi/transactionStatus`,
    { ServiceID: credentials.serviceId, OrderID: input.orderId, Hash: requestHash },
    { BmHeader: 'pay-bm' },
  )

  const reason = extractTag(xml, 'reason')
  const transactions = parseTransactionRecords(xml)
  if (transactions.length === 0 && reason) {
    throw new AutopayApiError(`Autopay rejected the status query: ${reason}`, { reason })
  }

  if (transactions.length > 0) {
    const responseHash = extractTag(xml, 'hash')
    const serviceIdFromResponse = extractTag(xml, 'serviceID') ?? credentials.serviceId
    const expectedFields = [serviceIdFromResponse, ...transactions.flatMap(transactionRecordFields)]
    const expectedHash = hash(credentials, expectedFields)
    if (!responseHash || responseHash !== expectedHash) {
      throw new AutopayApiError('[internal] Autopay status response failed hash verification')
    }
  }

  return { transactions }
}

export interface CancelTransactionResult {
  confirmation: 'CONFIRMED' | 'NOTCONFIRMED' | 'UNKNOWN'
  reason?: string
  messageId: string
}

/** `transactionCancel` — docs § "Anulowanie nieopłaconej transakcji". Only
 * cancels a transaction still in PENDING. */
export async function cancelTransaction(
  credentials: AutopayCredentials,
  input: { orderId?: string; remoteId?: string; messageId?: string },
): Promise<CancelTransactionResult> {
  if (!input.orderId && !input.remoteId) {
    throw new AutopayApiError('[internal] cancelTransaction requires either orderId or remoteId')
  }
  const messageId = input.messageId ?? generateMessageId()
  const requestHash = hash(credentials, [credentials.serviceId, messageId, input.remoteId, input.orderId])

  const fields: Record<string, string> = { ServiceID: credentials.serviceId, MessageID: messageId }
  if (input.remoteId) fields.RemoteID = input.remoteId
  if (input.orderId) fields.OrderID = input.orderId
  fields.Hash = requestHash

  const xml = await postForm(`${resolveApiHost(credentials.gatewayUrl)}/webapi/transactionCancel`, fields, {
    BmHeader: 'pay-bm',
  })

  const confirmation = extractTag(xml, 'confirmation')
  const reason = extractTag(xml, 'reason') ?? undefined

  return {
    confirmation: confirmation === 'CONFIRMED' || confirmation === 'NOTCONFIRMED' ? confirmation : 'UNKNOWN',
    reason,
    messageId,
  }
}

export interface RefundTransactionResult {
  messageId: string
  acknowledged: boolean
}

/**
 * `transactionRefund` — docs § "Zwroty transakcji". Requires the Partner
 * Service to have settlement balance enabled. The synchronous response only
 * confirms Autopay accepted the request; it is processed asynchronously
 * (documented as up to ~30 minutes), so this never returns a final
 * "refunded" outcome — see the `refund()` adapter method.
 */
export async function refundTransaction(
  credentials: AutopayCredentials,
  input: { remoteId: string; amount?: string; currencyCode?: string; messageId?: string },
): Promise<RefundTransactionResult> {
  const messageId = input.messageId ?? generateMessageId()
  const requestHash = hash(credentials, [
    credentials.serviceId,
    messageId,
    input.remoteId,
    input.amount,
    input.currencyCode,
  ])

  const fields: Record<string, string> = {
    ServiceID: credentials.serviceId,
    MessageID: messageId,
    RemoteID: input.remoteId,
  }
  if (input.amount) fields.Amount = input.amount
  if (input.currencyCode) fields.Currency = input.currencyCode
  fields.Hash = requestHash

  const xml = await postForm(`${resolveApiHost(credentials.gatewayUrl)}/settlementapi/transactionRefund`, fields)

  const reason = extractTag(xml, 'reason')
  const responseServiceId = extractTag(xml, 'serviceID')
  const responseMessageId = extractTag(xml, 'messageID')
  const responseHash = extractTag(xml, 'hash')

  if (!responseServiceId || !responseMessageId || !responseHash) {
    throw new AutopayApiError(
      reason ? `Autopay rejected the refund request: ${reason}` : 'Autopay refund acknowledgment was malformed',
      { reason: reason ?? undefined },
    )
  }

  const expectedHash = hash(credentials, [responseServiceId, responseMessageId])
  if (responseHash !== expectedHash) {
    throw new AutopayApiError('[internal] Autopay refund acknowledgment failed hash verification')
  }

  return { messageId: responseMessageId, acknowledged: true }
}
