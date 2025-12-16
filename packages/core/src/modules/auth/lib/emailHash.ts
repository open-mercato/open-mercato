import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'

export function computeEmailHash(email: string): string {
  return hashForLookup(email)
}
