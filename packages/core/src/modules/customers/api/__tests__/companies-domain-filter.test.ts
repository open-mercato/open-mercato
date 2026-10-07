import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ListConfig = {
  schema: { parse: (input: unknown) => Record<string, unknown> }
  buildFilters: (query: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
}

const captured: { list: ListConfig | null } = { list: null }
const mockFindWithDecryption = jest.fn()
const mockFindEntityIdsBySearchTokens = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: { list: ListConfig }) => {
    captured.list = options.list
    return { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: (...args: unknown[]) => mockFindEntityIdsBySearchTokens(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const EXACT_ID = '11111111-1111-4111-8111-111111111111'
const SUBDOMAIN_ID = '22222222-2222-4222-8222-222222222222'
const CIPHERTEXT = 'FCka6vUXPkwOziNi:+1v4NlDZKkuD:AAAAAAAAAAAAAAAAAAAAAA==:v1'

const buildCtx = (overrides: Record<string, unknown> = {}) => ({
  auth: { tenantId: 'tenant-a', orgId: 'org-a' },
  selectedOrganizationId: 'org-a',
  organizationIds: ['org-a'],
  container: { resolve: () => ({ getKysely: () => ({}) }) },
  ...overrides,
})

const buildFilters = (query: Record<string, unknown>, ctx = buildCtx()) =>
  captured.list!.buildFilters(captured.list!.schema.parse(query), ctx)

beforeAll(() => {
  require('../companies/route')
})

beforeEach(() => {
  mockFindWithDecryption.mockReset().mockResolvedValue([
    { domain: 'https://www.Acme.com/', entity: { id: EXACT_ID } },
    { domain: 'shop.acme.com', entity: { id: SUBDOMAIN_ID } },
  ])
  mockFindEntityIdsBySearchTokens.mockReset().mockResolvedValue({ matched: true, ids: ['profile-1', 'profile-2'] })
})

describe('GET /api/customers/companies ?domain=', () => {
  it('keeps only the exact normalized domain', async () => {
    const filters = await buildFilters({ domain: 'ACME.com' })
    expect(filters.id).toEqual({ $in: [EXACT_ID] })
  })

  it('rejects a non-empty value that is not a domain instead of returning the whole list', () => {
    for (const domain of ['https://', '/', 'https://www.acme.com/', 'acme']) {
      expect(() => captured.list!.schema.parse({ domain })).toThrow()
    }
  })

  it('ignores a blank value', async () => {
    const filters = await buildFilters({ domain: '  ' })
    expect(filters.id).toBeUndefined()
    expect(mockFindEntityIdsBySearchTokens).not.toHaveBeenCalled()
  })

  it('fails instead of reporting no match when a candidate domain cannot be decrypted', async () => {
    mockFindWithDecryption.mockResolvedValue([{ domain: CIPHERTEXT, entity: { id: EXACT_ID } }])
    const result = buildFilters({ domain: 'acme.com' })
    await expect(result).rejects.toBeInstanceOf(CrudHttpError)
    await expect(result).rejects.toMatchObject({ status: 500 })
  })

  it('limits the fallback scan to the organizations the caller can access', async () => {
    mockFindEntityIdsBySearchTokens.mockResolvedValue({ matched: false, reason: 'search-disabled' })
    await buildFilters({ domain: 'acme.com' }, buildCtx({ selectedOrganizationId: null, organizationIds: ['org-a', 'org-b'] }))
    const where = mockFindWithDecryption.mock.calls[0][2]
    expect(where).toEqual({ tenantId: 'tenant-a', domain: { $ne: null }, organizationId: { $in: ['org-a', 'org-b'] } })
  })
})
