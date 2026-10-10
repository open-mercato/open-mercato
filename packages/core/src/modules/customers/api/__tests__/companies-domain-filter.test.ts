import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ListConfig = {
  schema: { parse: (input: unknown) => Record<string, unknown> }
  buildFilters: (query: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
}

const captured: { list: ListConfig | null } = { list: null }
const mockFindCompanyIdsByDomain = jest.fn()
const mockFindSearchIds = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: { list: ListConfig }) => {
    captured.list = options.list
    return { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))
jest.mock('../../lib/findCompanyIdsByDomain', () => ({
  findCompanyIdsByDomain: (...args: unknown[]) => mockFindCompanyIdsByDomain(...args),
}))
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  findMatchingEntityIdsBySearchTokensAcrossSources: (...args: unknown[]) => mockFindSearchIds(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

const EXACT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'
const em = { name: 'request-em' }

const buildCtx = (overrides: Record<string, unknown> = {}) => ({
  auth: { tenantId: 'tenant-a', orgId: 'org-home' },
  selectedOrganizationId: 'org-a',
  organizationIds: ['org-a', 'org-a-child'],
  container: { resolve: () => em },
  ...overrides,
})

const buildFilters = (query: Record<string, unknown>, ctx = buildCtx()) =>
  captured.list!.buildFilters(captured.list!.schema.parse(query), ctx)

beforeAll(() => {
  require('../companies/route')
})

beforeEach(() => {
  mockFindCompanyIdsByDomain.mockReset().mockResolvedValue({ status: 'ok', companyIds: [EXACT_ID] })
  mockFindSearchIds.mockReset().mockResolvedValue([EXACT_ID, OTHER_ID])
})

describe('GET /api/customers/companies ?domain=', () => {
  it('restricts the list to the companies the lookup verified, within the list scope', async () => {
    const filters = await buildFilters({ domain: '@WWW.Acme.com', withDeleted: 'true' })
    expect(filters.id).toEqual({ $in: [EXACT_ID] })
    expect(mockFindCompanyIdsByDomain).toHaveBeenCalledWith(em, 'acme.com', {
      tenantId: 'tenant-a',
      organizationIds: ['org-a', 'org-a-child'],
      selectedOrganizationId: 'org-a',
      decryptionOrganizationId: 'org-a',
      includeDeleted: true,
    })
  })

  it('skips deleted companies unless withDeleted is set', async () => {
    await buildFilters({ domain: 'acme.com' })
    expect(mockFindCompanyIdsByDomain).toHaveBeenCalledWith(em, 'acme.com', expect.objectContaining({ includeDeleted: false }))
  })

  it('rejects a value that is not a domain, blank included, with a translated 400 instead of returning the whole list', async () => {
    for (const domain of ['', '  ', 'https://', '/', 'https://www.acme.com/', 'acme.com\\other.com', 'acme', 'jane@acme.com', 'acme..com']) {
      const result = buildFilters({ domain })
      await expect(result).rejects.toBeInstanceOf(CrudHttpError)
      await expect(result).rejects.toMatchObject({
        status: 400,
        body: { error: 'customers.errors.invalid_domain', code: 'invalid_domain' },
      })
    }
    expect(mockFindCompanyIdsByDomain).not.toHaveBeenCalled()
  })

  it('leaves the list unfiltered when no domain is passed', async () => {
    const filters = await buildFilters({})
    expect(filters.id).toBeUndefined()
    expect(mockFindCompanyIdsByDomain).not.toHaveBeenCalled()
  })

  it('fails the request when the lookup fails instead of dropping the domain filter', async () => {
    mockFindCompanyIdsByDomain.mockRejectedValue(new Error('[internal] lookup failed'))
    await expect(buildFilters({ domain: 'acme.com' })).rejects.toThrow('lookup failed')
  })

  it('answers a scope too large to verify with a translated 422 instead of a partial result', async () => {
    mockFindCompanyIdsByDomain.mockResolvedValue({ status: 'scope-too-large', limit: 10000 })
    const result = buildFilters({ domain: 'acme.com' })
    await expect(result).rejects.toBeInstanceOf(CrudHttpError)
    await expect(result).rejects.toMatchObject({
      status: 422,
      body: { error: 'customers.errors.domain_lookup_too_broad', code: 'domain_lookup_too_broad' },
    })
  })

  it('documents the domain errors in OpenAPI without excluding the other list errors', () => {
    const { openApi } = require('../companies/route')
    const errors: Array<{ status: number; schema: { safeParse: (body: unknown) => { success: boolean } } }> =
      openApi.methods.GET.errors
    const accepts = (status: number, body: unknown) =>
      errors.find((entry) => entry.status === status)!.schema.safeParse(body).success
    expect(accepts(400, { error: 'Invalid domain', code: 'invalid_domain' })).toBe(true)
    expect(accepts(400, { error: 'Invalid input', details: [] })).toBe(true)
    expect(accepts(422, { error: 'Too many companies', code: 'domain_lookup_too_broad' })).toBe(true)
    expect(accepts(422, { error: 'Selection invalid', code: 'organization_selection_invalid' })).toBe(true)
  })

  it('combines with search: only companies matching both are kept', async () => {
    const filters = await buildFilters({ domain: 'acme.com', search: 'acme' })
    expect(filters.id).toEqual({ $in: [EXACT_ID] })
  })

  it('combines with search: no company matching both means no result', async () => {
    mockFindSearchIds.mockResolvedValue([OTHER_ID])
    const filters = await buildFilters({ domain: 'acme.com', search: 'other' })
    expect(filters.id).toEqual({ $eq: NO_MATCH_ID })
  })
})
