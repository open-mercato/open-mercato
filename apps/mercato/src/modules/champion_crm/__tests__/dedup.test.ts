import { deduplicateLead, type LeadDedupDecision, type LeadDedupRepository } from '../lib/dedup'

type Contact = { id: string; primaryEmail?: string | null; primaryPhoneE164?: string | null }

function createRepo(overrides: Partial<LeadDedupRepository<Contact>> = {}) {
  const decisions: LeadDedupDecision[] = []
  const repo: LeadDedupRepository<Contact> = {
    findContactByEmail: jest.fn(async () => null),
    findContactByPhone: jest.fn(async () => null),
    createContact: jest.fn(async () => ({ id: 'contact-1' })),
    linkLead: jest.fn(async (decision) => { decisions.push(decision) }),
    writeAudit: jest.fn(async () => undefined),
    ...overrides,
  }
  return { repo, decisions }
}

describe('champion_crm dedup', () => {
  it('matches an existing contact by email before creating a contact', async () => {
    const { repo } = createRepo({
      findContactByEmail: jest.fn(async () => ({ id: 'contact-email', primaryEmail: 'lead@example.com' })),
    })

    const decision = await deduplicateLead({ id: 'lead-1', emailNormalized: 'lead@example.com' }, repo)

    expect(decision).toEqual({ status: 'matched_contact', contactId: 'contact-email', auditAction: 'lead.matched_contact' })
    expect(repo.createContact).not.toHaveBeenCalled()
    expect(repo.linkLead).toHaveBeenCalledWith(decision)
    expect(repo.writeAudit).toHaveBeenCalledWith(decision)
  })

  it('creates a contact when identity is usable and no match exists', async () => {
    const { repo } = createRepo()

    const decision = await deduplicateLead({ id: 'lead-1', emailNormalized: 'lead@example.com', nameRaw: 'Ada Nowak' }, repo)

    expect(decision.status).toBe('created_contact')
    expect(repo.createContact).toHaveBeenCalledWith({
      displayName: 'Ada Nowak',
      firstName: 'Ada',
      lastName: 'Nowak',
      primaryEmail: 'lead@example.com',
      primaryPhoneE164: null,
    })
  })

  it('routes leads without identifiers to manual review', async () => {
    const { repo } = createRepo()

    const decision = await deduplicateLead({ id: 'lead-1', nameRaw: 'No Contact' }, repo)

    expect(decision).toEqual({ status: 'manual_review', contactId: null, auditAction: 'lead.manual_review_required' })
    expect(repo.createContact).not.toHaveBeenCalled()
  })
})

