import { hasUsableIdentifier, splitName } from './normalization'

export type LeadDedupDecision =
  | { status: 'matched_contact'; contactId: string; auditAction: 'lead.matched_contact' }
  | { status: 'created_contact'; contactId: string; auditAction: 'lead.created_contact' }
  | { status: 'manual_review'; contactId: null; auditAction: 'lead.manual_review_required' }

export type DedupLeadLike = {
  id: string
  emailNormalized?: string | null
  phoneE164?: string | null
  nameRaw?: string | null
}

export type ContactCandidate = {
  id: string
  primaryEmail?: string | null
  primaryPhoneE164?: string | null
}

export type LeadDedupRepository<TContact extends ContactCandidate = ContactCandidate> = {
  findContactByEmail(email: string): Promise<TContact | null>
  findContactByPhone(phone: string): Promise<TContact | null>
  createContact(input: {
    displayName: string
    firstName: string | null
    lastName: string | null
    primaryEmail: string | null
    primaryPhoneE164: string | null
  }): Promise<TContact>
  linkLead(decision: LeadDedupDecision): Promise<void>
  writeAudit(decision: LeadDedupDecision): Promise<void>
}

export async function deduplicateLead<TContact extends ContactCandidate>(
  lead: DedupLeadLike,
  repo: LeadDedupRepository<TContact>,
): Promise<LeadDedupDecision> {
  if (lead.emailNormalized) {
    const byEmail = await repo.findContactByEmail(lead.emailNormalized)
    if (byEmail) return persistDecision(repo, { status: 'matched_contact', contactId: byEmail.id, auditAction: 'lead.matched_contact' })
  }

  if (lead.phoneE164) {
    const byPhone = await repo.findContactByPhone(lead.phoneE164)
    if (byPhone) return persistDecision(repo, { status: 'matched_contact', contactId: byPhone.id, auditAction: 'lead.matched_contact' })
  }

  const identity = {
    emailNormalized: lead.emailNormalized ?? null,
    phoneE164: lead.phoneE164 ?? null,
    nameRaw: lead.nameRaw ?? null,
  }

  if (!hasUsableIdentifier(identity)) {
    return persistDecision(repo, { status: 'manual_review', contactId: null, auditAction: 'lead.manual_review_required' })
  }

  const displayName = identity.nameRaw || identity.emailNormalized || identity.phoneE164 || 'Unknown contact'
  const name = splitName(lead.nameRaw ?? null)
  const contact = await repo.createContact({
    displayName,
    firstName: name.firstName,
    lastName: name.lastName,
    primaryEmail: lead.emailNormalized ?? null,
    primaryPhoneE164: lead.phoneE164 ?? null,
  })

  return persistDecision(repo, { status: 'created_contact', contactId: contact.id, auditAction: 'lead.created_contact' })
}

async function persistDecision(
  repo: LeadDedupRepository,
  decision: LeadDedupDecision,
): Promise<LeadDedupDecision> {
  await repo.linkLead(decision)
  await repo.writeAudit(decision)
  return decision
}

