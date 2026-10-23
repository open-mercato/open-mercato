import type { EntityManager } from '@mikro-orm/postgresql'
import {
  COMPANY_DOMAIN_LOOKUP_LIMIT,
  findCompanyIdsByDomain,
  type CompanyDomainLookupScope,
} from '../findCompanyIdsByDomain'

const mockFindWithDecryption = jest.fn()
const mockFindEntityIdsBySearchTokens = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: (...args: unknown[]) => mockFindEntityIdsBySearchTokens(...args),
}))

const EXACT_ID = '11111111-1111-4111-8111-111111111111'
const SUBDOMAIN_ID = '22222222-2222-4222-8222-222222222222'
const CIPHERTEXT = 'FCka6vUXPkwOziNi:+1v4NlDZKkuD:AAAAAAAAAAAAAAAAAAAAAA==:v1'

const profile = (index: number, domain: string, entityId = `entity-${index}`, organizationId = 'org-a') => ({
  id: `profile-${index}`,
  domain,
  organizationId,
  entity: { id: entityId },
})

const scanEm = { name: 'scan-em' }
const em = { fork: () => scanEm } as unknown as EntityManager

const scope = (overrides: Partial<CompanyDomainLookupScope> = {}): CompanyDomainLookupScope => ({
  tenantId: 'tenant-a',
  organizationIds: ['org-a'],
  selectedOrganizationId: 'org-a',
  decryptionOrganizationId: 'org-a',
  includeDeleted: false,
  ...overrides,
})

const scannedWhere = () => mockFindWithDecryption.mock.calls.map((call) => call[2])

beforeEach(() => {
  mockFindWithDecryption.mockReset().mockResolvedValue([
    profile(1, 'https://www.Acme.com/', EXACT_ID),
    profile(2, 'shop.acme.com', SUBDOMAIN_ID),
  ])
  mockFindEntityIdsBySearchTokens.mockReset().mockResolvedValue({ matched: true, ids: [] })
})

describe('findCompanyIdsByDomain', () => {
  it('keeps only the companies whose decrypted, normalized domain is equal', async () => {
    await expect(findCompanyIdsByDomain(em, 'acme.com', scope())).resolves.toEqual({
      status: 'ok',
      companyIds: [EXACT_ID],
    })
  })

  it('finds the company even when the search index has no row for its domain', async () => {
    await expect(findCompanyIdsByDomain(em, 'acme.com', scope())).resolves.toEqual({
      status: 'ok',
      companyIds: [EXACT_ID],
    })
    expect(mockFindEntityIdsBySearchTokens).not.toHaveBeenCalled()
  })

  it('matches an internationalized domain stored in Unicode against its punycode form', async () => {
    mockFindWithDecryption.mockResolvedValue([profile(1, 'https://www.BÜCHER.de/', EXACT_ID)])
    await expect(findCompanyIdsByDomain(em, 'xn--bcher-kva.de', scope())).resolves.toEqual({
      status: 'ok',
      companyIds: [EXACT_ID],
    })
  })

  it('reads the organizations the list reads, child organizations included, and skips deleted companies', async () => {
    await findCompanyIdsByDomain(em, 'acme.com', scope({ organizationIds: ['org-a', 'org-a-child'] }))
    await findCompanyIdsByDomain(em, 'acme.com', scope({ organizationIds: null }))
    await findCompanyIdsByDomain(em, 'acme.com', scope({ organizationIds: null, selectedOrganizationId: null }))
    await findCompanyIdsByDomain(em, 'acme.com', scope({ includeDeleted: true }))
    expect(scannedWhere()).toEqual([
      {
        tenantId: 'tenant-a',
        domain: { $ne: null },
        organizationId: { $in: ['org-a', 'org-a-child'] },
        entity: { deletedAt: null },
      },
      { tenantId: 'tenant-a', domain: { $ne: null }, organizationId: 'org-a', entity: { deletedAt: null } },
      { tenantId: 'tenant-a', domain: { $ne: null }, entity: { deletedAt: null } },
      { tenantId: 'tenant-a', domain: { $ne: null }, organizationId: { $in: ['org-a'] } },
    ])
  })

  it('loads only the columns it compares on a forked entity manager, with a bounded limit and an explicit decryption scope', async () => {
    await findCompanyIdsByDomain(em, 'acme.com', scope())
    const [usedEm, , , options, decryptionScope] = mockFindWithDecryption.mock.calls[0]
    expect(usedEm).toBe(scanEm)
    expect(options).toEqual({
      fields: ['id', 'domain', 'entity', 'tenantId', 'organizationId'],
      limit: COMPANY_DOMAIN_LOOKUP_LIMIT + 1,
    })
    expect(decryptionScope).toEqual({ tenantId: 'tenant-a', organizationId: 'org-a' })
  })

  it('answers from a scan of exactly the bound', async () => {
    mockFindWithDecryption.mockResolvedValue(
      Array.from({ length: COMPANY_DOMAIN_LOOKUP_LIMIT }, (_, index) => profile(index, 'acme.com')),
    )
    const result = await findCompanyIdsByDomain(em, 'acme.com', scope())
    expect(result.status).toBe('ok')
  })

  it('reports a scope too large to verify instead of answering from a partial scan', async () => {
    mockFindWithDecryption.mockResolvedValue(
      Array.from({ length: COMPANY_DOMAIN_LOOKUP_LIMIT + 1 }, (_, index) => profile(index, 'acme.com')),
    )
    await expect(findCompanyIdsByDomain(em, 'acme.com', scope())).resolves.toEqual({
      status: 'scope-too-large',
      limit: COMPANY_DOMAIN_LOOKUP_LIMIT,
    })
  })

  it('fails instead of reporting no match when a stored domain cannot be decrypted', async () => {
    mockFindWithDecryption.mockResolvedValue([profile(1, CIPHERTEXT), profile(2, 'acme.com', EXACT_ID)])
    await expect(findCompanyIdsByDomain(em, 'acme.com', scope())).rejects.toThrow('could not decrypt')
  })

  it('still fails on a stored ciphertext when tenant data encryption is turned off for the process', async () => {
    const previous = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'false'
    try {
      mockFindWithDecryption.mockResolvedValue([profile(1, CIPHERTEXT, EXACT_ID)])
      await expect(findCompanyIdsByDomain(em, 'acme.com', scope())).rejects.toThrow('could not decrypt')
    } finally {
      if (previous === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = previous
    }
  })
})
