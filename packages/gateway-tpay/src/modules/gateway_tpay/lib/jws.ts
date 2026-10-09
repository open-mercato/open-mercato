import { X509Certificate, verify as verifySignature } from 'node:crypto'
import { WebhookVerificationUnavailableError } from '@open-mercato/shared/modules/payment_gateways/types'
import { TPAY_JWS_TRUST, type TpayJwsTrustConfig } from './certificates'
import type { TpayEnvironment } from './tpay-client'

export const TPAY_CERTIFICATE_FETCH_TIMEOUT_MS = 5_000
export const TPAY_CERTIFICATE_MAX_BYTES = 64 * 1024
export const TPAY_CERTIFICATE_CACHE_TTL_MS = 60 * 60 * 1000
export const TPAY_CERTIFICATE_NEGATIVE_CACHE_MS = 30 * 1000
export const TPAY_CERTIFICATE_REFRESH_MIN_INTERVAL_MS = 30 * 1000
const TPAY_JWS_MAX_HEADER_LENGTH = 16 * 1024
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const PEM_CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

export type TpayJwsErrorReason =
  | 'malformed'
  | 'unsupportedAlgorithm'
  | 'unsupportedCritical'
  | 'untrustedCertificateUrl'
  | 'invalidCertificate'
  | 'certificateNotValidNow'
  | 'unexpectedCommonName'
  | 'untrustedChain'
  | 'signatureMismatch'

export class TpayJwsError extends Error {
  readonly reason: TpayJwsErrorReason

  constructor(reason: TpayJwsErrorReason) {
    super(`[internal] tpay jws rejected: ${reason}`)
    this.name = 'TpayJwsError'
    this.reason = reason
  }
}

export type TpayCertificateFetcher = (url: string) => Promise<string>

export type TpayJwsVerifyInput = {
  header: string
  rawBody: Buffer
  environment: TpayEnvironment
  fetchCertificate?: TpayCertificateFetcher
}

export type TpayJwsInternalOptions = {
  now?: () => Date
  trust?: Readonly<Record<TpayEnvironment, TpayJwsTrustConfig>>
}

type CachedLeaf = {
  leaf: X509Certificate
  fetchedAt: number
  expiresAt: number
}

type ParsedJws = {
  signingInputPrefix: string
  signature: Buffer
}

const leafCache = new Map<string, CachedLeaf>()
const negativeCache = new Map<string, number>()
const inFlight = new Map<string, Promise<X509Certificate>>()

export function resetTpayJwsCache(): void {
  leafCache.clear()
  negativeCache.clear()
  inFlight.clear()
}

function decodeBase64Url(segment: string): Buffer {
  if (!BASE64URL_PATTERN.test(segment)) throw new TpayJwsError('malformed')
  return Buffer.from(segment, 'base64url')
}

function parseProtectedHeader(segment: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(segment)))
  } catch (error) {
    if (error instanceof TpayJwsError) throw error
    throw new TpayJwsError('malformed')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TpayJwsError('malformed')
  return parsed as Record<string, unknown>
}

function parseJws(header: string, trust: TpayJwsTrustConfig): ParsedJws {
  const value = header.trim()
  if (!value || value.length > TPAY_JWS_MAX_HEADER_LENGTH) throw new TpayJwsError('malformed')
  const segments = value.split('.')
  if (segments.length !== 3) throw new TpayJwsError('malformed')
  const [protectedSegment, payloadSegment, signatureSegment] = segments
  if (payloadSegment !== '' || !protectedSegment || !signatureSegment) throw new TpayJwsError('malformed')
  const protectedHeader = parseProtectedHeader(protectedSegment)
  if (protectedHeader.alg !== 'RS256') throw new TpayJwsError('unsupportedAlgorithm')
  if (protectedHeader.crit !== undefined) throw new TpayJwsError('unsupportedCritical')
  if (protectedHeader.x5u !== trust.x5u) throw new TpayJwsError('untrustedCertificateUrl')
  return { signingInputPrefix: `${protectedSegment}.`, signature: decodeBase64Url(signatureSegment) }
}

function splitPemCertificates(pem: string): X509Certificate[] {
  const blocks = pem.match(PEM_CERTIFICATE_PATTERN) ?? []
  try {
    return blocks.map((block) => new X509Certificate(block))
  } catch {
    throw new TpayJwsError('invalidCertificate')
  }
}

function commonNameOf(certificate: X509Certificate): string | null {
  const names = certificate.subject
    .split('\n')
    .filter((line) => line.startsWith('CN='))
    .map((line) => line.slice(3))
  return names.length === 1 ? names[0] : null
}

function isValidAt(certificate: X509Certificate, now: Date): boolean {
  const time = now.getTime()
  return Date.parse(certificate.validFrom) <= time && time <= Date.parse(certificate.validTo)
}

function isIssuedBy(subject: X509Certificate, issuer: X509Certificate): boolean {
  return issuer.ca && subject.checkIssued(issuer) && subject.verify(issuer.publicKey)
}

function validateLeaf(pem: string, trust: TpayJwsTrustConfig, now: Date): X509Certificate {
  const [leaf] = splitPemCertificates(pem)
  if (!leaf) throw new TpayJwsError('invalidCertificate')
  if (leaf.publicKey.asymmetricKeyType !== 'rsa') throw new TpayJwsError('invalidCertificate')
  if (commonNameOf(leaf) !== trust.expectedLeafCommonName) throw new TpayJwsError('unexpectedCommonName')
  const anchors = splitPemCertificates(trust.anchors)
  const root = anchors.find((certificate) => certificate.fingerprint256 === trust.rootFingerprint256)
  if (!root || !isIssuedBy(root, root)) throw new TpayJwsError('untrustedChain')
  const intermediate = anchors.find(
    (certificate) => certificate !== root && isIssuedBy(leaf, certificate) && isIssuedBy(certificate, root),
  )
  if (!intermediate) throw new TpayJwsError('untrustedChain')
  if (![leaf, intermediate, root].every((certificate) => isValidAt(certificate, now))) {
    throw new TpayJwsError('certificateNotValidNow')
  }
  return leaf
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > TPAY_CERTIFICATE_MAX_BYTES) {
    throw new WebhookVerificationUnavailableError('[internal] Tpay certificate response too large')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > TPAY_CERTIFICATE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new WebhookVerificationUnavailableError('[internal] Tpay certificate response too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function fetchTpayCertificatePem(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(TPAY_CERTIFICATE_FETCH_TIMEOUT_MS),
    })
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined)
      throw new WebhookVerificationUnavailableError(
        `[internal] Tpay certificate fetch responded with HTTP ${response.status}`,
      )
    }
    return await readBoundedText(response)
  } catch (error) {
    if (error instanceof WebhookVerificationUnavailableError) throw error
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new WebhookVerificationUnavailableError('[internal] Tpay certificate fetch timed out')
    }
    throw new WebhookVerificationUnavailableError('[internal] Tpay certificate fetch failed')
  }
}

async function loadLeaf(
  cacheKey: string,
  trust: TpayJwsTrustConfig,
  fetchCertificate: TpayCertificateFetcher,
  now: () => Date,
): Promise<X509Certificate> {
  const blockedUntil = negativeCache.get(cacheKey)
  if (blockedUntil !== undefined && now().getTime() < blockedUntil) {
    throw new WebhookVerificationUnavailableError('[internal] Tpay certificate temporarily unavailable')
  }
  let pem: string
  try {
    pem = await fetchCertificate(trust.x5u)
  } catch (error) {
    negativeCache.set(cacheKey, now().getTime() + TPAY_CERTIFICATE_NEGATIVE_CACHE_MS)
    if (error instanceof WebhookVerificationUnavailableError) throw error
    throw new WebhookVerificationUnavailableError('[internal] Tpay certificate fetch failed')
  }
  negativeCache.delete(cacheKey)
  const current = now()
  const leaf = validateLeaf(pem, trust, current)
  const expiresAt = Math.min(current.getTime() + TPAY_CERTIFICATE_CACHE_TTL_MS, Date.parse(leaf.validTo))
  leafCache.set(cacheKey, { leaf, fetchedAt: current.getTime(), expiresAt })
  return leaf
}

function loadLeafOnce(
  cacheKey: string,
  trust: TpayJwsTrustConfig,
  fetchCertificate: TpayCertificateFetcher,
  now: () => Date,
): Promise<X509Certificate> {
  const pending = inFlight.get(cacheKey)
  if (pending) return pending
  const promise = loadLeaf(cacheKey, trust, fetchCertificate, now).finally(() => {
    inFlight.delete(cacheKey)
  })
  inFlight.set(cacheKey, promise)
  return promise
}

function signatureMatches(leaf: X509Certificate, signingInput: Buffer, signature: Buffer): boolean {
  try {
    return verifySignature('RSA-SHA256', signingInput, leaf.publicKey, signature)
  } catch {
    return false
  }
}

export async function verifyTpayJws(
  input: TpayJwsVerifyInput,
  options: TpayJwsInternalOptions = {},
): Promise<void> {
  const trust = (options.trust ?? TPAY_JWS_TRUST)[input.environment]
  if (!trust) throw new TpayJwsError('untrustedCertificateUrl')
  const now = options.now ?? (() => new Date())
  const fetchCertificate = input.fetchCertificate ?? fetchTpayCertificatePem
  const parsed = parseJws(input.header, trust)
  const signingInput = Buffer.from(`${parsed.signingInputPrefix}${input.rawBody.toString('base64url')}`, 'ascii')
  const cacheKey = `${input.environment}|${trust.x5u}`
  const cached = leafCache.get(cacheKey)
  const checkedAt = now().getTime()
  if (cached && checkedAt < cached.expiresAt) {
    if (signatureMatches(cached.leaf, signingInput, parsed.signature)) return
    if (checkedAt - cached.fetchedAt < TPAY_CERTIFICATE_REFRESH_MIN_INTERVAL_MS) {
      throw new TpayJwsError('signatureMismatch')
    }
  }
  const leaf = await loadLeafOnce(cacheKey, trust, fetchCertificate, now)
  if (!signatureMatches(leaf, signingInput, parsed.signature)) throw new TpayJwsError('signatureMismatch')
}
