import { createHmac, timingSafeEqual } from 'node:crypto'

type ConsentHashInput = {
  userId: string
  consentType: string
  isGranted: boolean
  grantedAt: Date | string | null | undefined
  withdrawnAt?: Date | string | null | undefined
  ipAddress: string | null | undefined
  source: string | null | undefined
}

function getSecret(): string {
  const secret = process.env.CONSENT_INTEGRITY_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    console.warn('[consentIntegrity] CONSENT_INTEGRITY_SECRET and NEXTAUTH_SECRET are not set — integrity hashes are insecure')
  }
  return secret || 'om-consent-integrity-default-key'
}

function normalizeDate(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString()
}

export function computeConsentIntegrityHash(input: ConsentHashInput): string {
  const payload = [
    input.userId,
    input.consentType,
    String(input.isGranted),
    normalizeDate(input.grantedAt),
    normalizeDate(input.withdrawnAt),
    input.ipAddress ?? '',
    input.source ?? '',
  ].join('|')

  return createHmac('sha256', getSecret()).update(payload).digest('hex')
}

export function verifyConsentIntegrityHash(input: ConsentHashInput, hash: string | null | undefined): boolean {
  if (!hash) return false
  const expected = computeConsentIntegrityHash(input)
  if (expected.length !== hash.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
}
