import { createHash, randomUUID } from 'node:crypto'
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

/**
 * Autopay's `MessageID` is documented as a 32-character alphanumeric
 * deduplication handle — a retried request that repeats the same MessageID
 * is treated as a re-confirmation, not a new operation. Deriving it
 * deterministically from the platform's own `idempotencyKey` (rather than
 * generating a fresh random one every call) is what makes `cancel`/`refund`
 * retries safe: the same logical operation always produces the same
 * MessageID. SHA-256 output is hex (already alphanumeric) and is truncated
 * to 32 chars to fit the documented length.
 */
export function deriveMessageId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 32)
}

function resolveMessageId(input: { messageId?: string; idempotencyKey?: string }): string {
  if (input.messageId) return input.messageId
  if (input.idempotencyKey) return deriveMessageId(input.idempotencyKey)
  return generateMessageId()
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
 * state that GET is rejected — but no consumer in this repo currently wires
 * up `formPost` (checkout only does `window.location.href = redirectUrl`),
 * so today this provider's entire session-creation flow depends on the GET
 * transport this comment itself flags as unverified. GET also puts
 * `CustomerEmail` and `Hash` in the URL (browser history, referrer headers,
 * intermediate logs) — a real downgrade from the documented POST. Both the
 * transport choice and this privacy exposure need to be settled with one
 * live sandbox session before this provider is enabled for any tenant; see
 * the spec's Risks section.
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
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...extraHeaders,
        },
        body: new URLSearchParams(fields).toString(),
        signal: controller.signal,
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AutopayApiError(`Autopay request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms`, {
          code: 'TIMEOUT',
        })
      }
      throw err
    }
    // Best-effort only: a chunked response carries no Content-Length, so this
    // never replaces the post-buffer length check below — it just short-circuits
    // the common case of a server that is honest about a huge body up front.
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
  /**
   * Present when Autopay attached a `<reason>` alongside zero transactions.
   * Confirmed for the documented >50-transactions-per-OrderID limit; an
   * ordinary "no transaction found for this OrderID" response is not
   * separately confirmed in the reviewed documentation and may or may not
   * carry a reason of its own. Either way this is not thrown as an error —
   * `interpretAutopayTransactionStatus` already maps zero transactions to
   * `unknown`, so callers that care can inspect `reason` for diagnostics
   * without the caller needing a working sandbox order to test the branch.
   */
  reason?: string
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

  const reason = extractTag(xml, 'reason') ?? undefined
  const transactions = parseTransactionRecords(xml)

  // Verified for both zero and nonzero transaction counts — an empty list is
  // exactly the response shape the health probe deliberately requests (a
  // synthetic, never-real OrderID), so skipping verification there would let
  // a malformed or unsigned "no results" response masquerade as a genuine
  // one instead of failing closed.
  const responseHash = extractTag(xml, 'hash')
  const serviceIdFromResponse = extractTag(xml, 'serviceID') ?? credentials.serviceId
  const expectedFields = [serviceIdFromResponse, ...transactions.flatMap(transactionRecordFields)]
  const expectedHash = hash(credentials, expectedFields)
  if (!responseHash || responseHash !== expectedHash) {
    throw new AutopayApiError('[internal] Autopay status response failed hash verification')
  }

  return { transactions, reason }
}

export interface CancelTransactionResult {
  confirmation: 'CONFIRMED' | 'NOTCONFIRMED' | 'UNKNOWN'
  reason?: string
  messageId: string
}

/** `transactionCancel` — docs § "Anulowanie nieopłaconej transakcji". Only
 * cancels a transaction still in PENDING. `messageId` is deterministically
 * derived from `idempotencyKey` when provided, so a retried cancel reuses
 * the same MessageID instead of registering as a new operation. */
export async function cancelTransaction(
  credentials: AutopayCredentials,
  input: { orderId?: string; remoteId?: string; messageId?: string; idempotencyKey?: string },
): Promise<CancelTransactionResult> {
  if (!input.orderId && !input.remoteId) {
    throw new AutopayApiError('[internal] cancelTransaction requires either orderId or remoteId')
  }
  const messageId = resolveMessageId(input)
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
  const responseServiceId = extractTag(xml, 'serviceID') ?? undefined
  const responseMessageId = extractTag(xml, 'messageID') ?? undefined
  const responseHash = extractTag(xml, 'hash')

  // Docs § response field table: 1 serviceID (required only when
  // confirmation=CONFIRMED), 2 messageID (same), 3 confirmation, 4 reason.
  const expectedHash = hash(credentials, [responseServiceId, responseMessageId, confirmation, reason])
  if (!responseHash || responseHash !== expectedHash) {
    throw new AutopayApiError('[internal] Autopay cancel acknowledgment failed hash verification')
  }
  if (responseMessageId && responseMessageId !== messageId) {
    throw new AutopayApiError(
      '[internal] Autopay cancel acknowledgment echoed a different MessageID than the one sent',
    )
  }

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
 * "refunded" outcome — see the `refund()` adapter method. `messageId` is
 * deterministically derived from `idempotencyKey` when provided, so a
 * retried refund (e.g. after this client's own request timeout) reuses the
 * same MessageID instead of Autopay processing it as a second, independent
 * refund.
 */
export async function refundTransaction(
  credentials: AutopayCredentials,
  input: { remoteId: string; amount?: string; currencyCode?: string; messageId?: string; idempotencyKey?: string },
): Promise<RefundTransactionResult> {
  const messageId = resolveMessageId(input)
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
  if (responseMessageId !== messageId) {
    throw new AutopayApiError(
      '[internal] Autopay refund acknowledgment echoed a different MessageID than the one sent',
    )
  }

  return { messageId: responseMessageId, acknowledged: true }
}
