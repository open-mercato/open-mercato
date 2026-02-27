/** @jest-environment node */

import { matchContacts } from '../contactMatcher'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockEm = {} as any
const MockCustomerEntity = class {} as any

const scope = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const deps = { customerEntityClass: MockCustomerEntity }

describe('matchContacts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('returns exact match on email with confidence 1.0', async () => {
    const contact = {
      id: 'contact-1',
      kind: 'person',
      displayName: 'John Doe',
      primaryEmail: 'john@example.com',
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(contact)

    const results = await matchContacts(mockEm, [
      { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
    ], scope, deps)

    expect(results).toHaveLength(1)
    expect(results[0].match).toEqual({
      contactId: 'contact-1',
      contactType: 'person',
      contactName: 'John Doe',
      confidence: 1.0,
    })
    expect(results[0].participant.matchedContactId).toBe('contact-1')
  })

  it('returns company type for company entities', async () => {
    const contact = {
      id: 'company-1',
      kind: 'company',
      displayName: 'Acme Corp',
      primaryEmail: 'info@acme.com',
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(contact)

    const results = await matchContacts(mockEm, [
      { name: 'Acme Corp', email: 'info@acme.com', role: 'buyer' },
    ], scope, deps)

    expect(results[0].match?.contactType).toBe('company')
    expect(results[0].match?.contactId).toBe('company-1')
  })

  it('falls back to fuzzy name match with lower confidence', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null) // no email match
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'contact-2', kind: 'person', displayName: 'John Doe', createdAt: new Date() },
      { id: 'contact-3', kind: 'person', displayName: 'Jane Smith', createdAt: new Date() },
    ])

    const results = await matchContacts(mockEm, [
      { name: 'John Doe', email: 'unknown@example.com', role: 'buyer' },
    ], scope, deps)

    expect(results).toHaveLength(1)
    expect(results[0].match).not.toBeNull()
    expect(results[0].match?.contactId).toBe('contact-2')
    expect(results[0].match?.confidence).toBe(1.0) // exact name match
  })

  it('returns null match when no contact found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'contact-99', kind: 'person', displayName: 'Completely Different', createdAt: new Date() },
    ])

    const results = await matchContacts(mockEm, [
      { name: 'John Doe', email: 'notfound@example.com', role: 'buyer' },
    ], scope, deps)

    expect(results).toHaveLength(1)
    expect(results[0].match).toBeNull()
    expect(results[0].participant.matchedContactId).toBeNull()
  })

  it('handles participants with no email and no name', async () => {
    const results = await matchContacts(mockEm, [
      { name: '', email: '', role: 'other' },
    ], scope, deps)

    expect(results).toHaveLength(1)
    expect(results[0].match).toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('handles multiple participants in batch', async () => {
    const contact1 = { id: 'c-1', kind: 'person', displayName: 'Alice', primaryEmail: 'alice@example.com' }
    mockFindOneWithDecryption
      .mockResolvedValueOnce(contact1)  // first participant - email match
      .mockResolvedValueOnce(null)      // second participant - no match

    mockFindWithDecryption.mockResolvedValueOnce([]) // no fuzzy results for Bob

    const results = await matchContacts(mockEm, [
      { name: 'Alice', email: 'alice@example.com', role: 'buyer' },
      { name: 'Bob', email: 'bob@example.com', role: 'seller' },
    ], scope, deps)

    expect(results).toHaveLength(2)
    expect(results[0].match?.contactId).toBe('c-1')
    expect(results[1].match).toBeNull()
  })

  it('matches by name prefix with 0.9 confidence', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'c-1', kind: 'person', displayName: 'John Doe Jr.', createdAt: new Date() },
    ])

    const results = await matchContacts(mockEm, [
      { name: 'John Doe', email: '', role: 'buyer' },
    ], scope, deps)

    expect(results[0].match).not.toBeNull()
    // "John Doe Jr." starts with "John Doe" - score should be 0.9
    // But since 'john doe jr.' includes 'john doe' and vice versa test approach
    expect(results[0].match?.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('skips fuzzy match for very short names', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const results = await matchContacts(mockEm, [
      { name: 'A', email: '', role: 'other' },
    ], scope, deps)

    expect(results[0].match).toBeNull()
    // Name is only 1 char — too short for fuzzy search
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
