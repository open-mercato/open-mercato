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

const DEV_ONLY_SECRET = 'om-consent-integrity-dev-only-secret'
let missingSecretWarned = false

function getSecret(): string {
  const secret = process.env.CONSENT_INTEGRITY_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[consentIntegrity] No CONSENT_INTEGRITY_SECRET/NEXTAUTH_SECRET set. ' +
        'Refusing to compute or verify consent integrity hashes in production without a real secret.',
      )
    }
    if (!missingSecretWarned) {
      missingSecretWarned = true
      console.warn(
        '[consentIntegrity] No CONSENT_INTEGRITY_SECRET/NEXTAUTH_SECRET set — ' +
        'using insecure dev-only default. Set a secret before deploying to production.',
      )
    }
    return DEV_ONLY_SECRET
  }
  return secret
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
