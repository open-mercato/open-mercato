import { timingSafeEqual } from 'node:crypto'
import { computeAutopayHash } from './hash'

export interface ReturnQuery {
  serviceId: string
  orderId: string
  hash: string
}

export function readReturnQuery(params: URLSearchParams): ReturnQuery | null {
  const serviceId = params.get('ServiceID')
  const orderId = params.get('OrderID')
  const hash = params.get('Hash')
  if (!serviceId || !orderId || !hash) return null
  return { serviceId, orderId, hash }
}

/**
 * Autopay signs the return redirect over `ServiceID|OrderID|sharedKey`. The
 * signature only proves the redirect came from Autopay for this order — the
 * payment outcome is never read from it, only from `transactionStatus`.
 */
export function isValidReturnSignature(
  credentials: Record<string, unknown>,
  query: ReturnQuery,
): boolean {
  const { serviceId, sharedKey } = credentials
  if (typeof serviceId !== 'string' || typeof sharedKey !== 'string' || !serviceId || !sharedKey) return false
  if (serviceId !== query.serviceId) return false
  const algorithm = credentials.hashAlgorithm === 'sha512' ? 'sha512' : 'sha256'
  const expected = Buffer.from(computeAutopayHash([serviceId, query.orderId], sharedKey, algorithm), 'utf8')
  const presented = Buffer.from(query.hash.toLowerCase(), 'utf8')
  return expected.length === presented.length && timingSafeEqual(expected, presented)
}
