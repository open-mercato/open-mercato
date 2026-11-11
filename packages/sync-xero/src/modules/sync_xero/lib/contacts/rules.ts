import { nonBlank, type XeroContact } from './contact'

/**
 * What the Contacts run does with a Contact (App Spec § 6.4, § 6.1 merges, § 10 #23 (c)):
 * - `merge_mark`: a mapped Contact merged into another one only marks its Company, and this wins
 *   over the archive rule, since a merged-away Contact is archived too;
 * - `status_only`: a mapped GDPR-redacted Contact flips its Company's status and writes nothing else;
 * - `skip`: an unmapped Contact that is supplier-only, archived or GDPR-redacted gets no Company;
 * - `write`: everything else, an update or a first-sync match.
 */
export type XeroContactDecision =
  | { kind: 'merge_mark'; survivingContactId: string }
  | { kind: 'status_only' }
  | { kind: 'skip' }
  | { kind: 'write' }

export function isSupplierOnly(contact: XeroContact): boolean {
  return contact.IsSupplier === true && contact.IsCustomer === false
}

function statusOf(contact: XeroContact): string | null {
  return nonBlank(contact.ContactStatus)?.toUpperCase() ?? null
}

export function classifyXeroContact(contact: XeroContact, mapped: boolean): XeroContactDecision {
  const survivingContactId = nonBlank(contact.MergedToContactID)
  const status = statusOf(contact)
  if (mapped) {
    if (survivingContactId) return { kind: 'merge_mark', survivingContactId }
    if (status === 'GDPRREQUEST') return { kind: 'status_only' }
    return { kind: 'write' }
  }
  if (isSupplierOnly(contact) || status === 'ARCHIVED' || status === 'GDPRREQUEST') return { kind: 'skip' }
  return { kind: 'write' }
}
