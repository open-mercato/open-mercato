import {
  hashForLookup,
  looksLikeEncryptedPayload,
  lookupHashCandidates,
} from '@open-mercato/shared/lib/encryption/aes'

const PHONE_LOOKUP_CONTEXT = 'customers:customer_entity.primary_phone_digits'

function phoneLookupContext(organizationId: string): string {
  return `${PHONE_LOOKUP_CONTEXT}:${organizationId}`
}

export function normalizePhoneLookupDigits(phone: string | null | undefined): string {
  return phone && !looksLikeEncryptedPayload(phone) ? phone.replace(/\D/g, '') : ''
}

export function hashPersonPhoneDigits(phone: string | null | undefined, organizationId: string): string | null {
  const digits = normalizePhoneLookupDigits(phone)
  if (digits.length < 4) return null
  const hash = hashForLookup(digits, phoneLookupContext(organizationId))
  return hash.startsWith('v2:') ? hash : null
}

export function personPhoneHashCandidates(digits: string, organizationId: string): string[] {
  return lookupHashCandidates(digits, phoneLookupContext(organizationId)).filter((hash) => hash.startsWith('v2:'))
}

export function hasPersonPhoneLookupPepper(): boolean {
  return hashForLookup('', PHONE_LOOKUP_CONTEXT).startsWith('v2:')
}
