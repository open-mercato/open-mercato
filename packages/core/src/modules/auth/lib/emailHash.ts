import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'

export function computeEmailHash(email: string): string {
  return hashForLookup(email)
}

export function emailHashLookupValues(email: string): string[] {
  return lookupHashCandidates(email)
}
