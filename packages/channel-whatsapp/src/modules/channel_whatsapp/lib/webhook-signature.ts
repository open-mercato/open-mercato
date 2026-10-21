import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PREFIX = 'sha256='

export function computeMetaSignature(rawBody: string | Buffer, appSecret: string): string {
  const payload = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody
  return `${SIGNATURE_PREFIX}${createHmac('sha256', appSecret).update(payload).digest('hex')}`
}

export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | string[] | undefined,
  appSecret: string,
): boolean {
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false
  const received = header.slice(SIGNATURE_PREFIX.length).trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(received)) return false
  const expected = computeMetaSignature(rawBody, appSecret).slice(SIGNATURE_PREFIX.length)
  const left = Buffer.from(received, 'hex')
  const right = Buffer.from(expected, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | string[] | undefined {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
}
