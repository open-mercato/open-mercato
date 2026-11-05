import { GET, metadata } from '../route'
import { buildEntityListUrl } from '../../../../translations/lib/helpers'
import { resolveDictionaryRouteContext } from '../../dictionaries/context'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const entryId = '33333333-3333-4333-8333-333333333333'
const mockEm = { count: jest.fn(async () => 1) }

jest.mock('../../dictionaries/context', () => ({
  resolveDictionaryRouteContext: jest.fn(async () => ({
    em: mockEm, tenantId, organizationId,
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => [{ id: entryId, kind: 'status', value: 'active', label: 'Active' }]),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

describe('TranslationManager customer dictionary records', () => {
  beforeEach(() => jest.clearAllMocks())

  it('serves base labels from the manager lookup URL with tenant and organization scope', async () => {
    const url = buildEntityListUrl('customers:customer_dictionary_entry')
    expect(url).toBe('/api/customers/customer-dictionary-entries')
    const response = await GET(new Request(`http://localhost${url}?id=${entryId}&pageSize=1`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [{ id: entryId, label: 'Active' }], total: 1, pageSize: 1 })
    expect(findWithDecryption).toHaveBeenCalledWith(mockEm, expect.any(Function), {
      tenantId, organizationId, id: entryId,
    }, expect.objectContaining({ limit: 1, offset: 0 }), { tenantId, organizationId })
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['customers.settings.manage', 'translations.view'] })
  })

  it('bounds pagination and escapes searches', async () => {
    await GET(new Request('http://localhost/api/customers/customer-dictionary-entries?page=2&pageSize=20&search=50%25'))
    expect(findWithDecryption).toHaveBeenCalledWith(mockEm, expect.any(Function), {
      tenantId, organizationId, label: { $ilike: '%50\\%%' },
    }, expect.objectContaining({ limit: 20, offset: 20 }), { tenantId, organizationId })
    const invalid = await GET(new Request('http://localhost/api/customers/customer-dictionary-entries?pageSize=101'))
    expect(invalid.status).toBe(400)
    expect(findWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing selected organization instead of listing tenant-wide entries', async () => {
    jest.mocked(resolveDictionaryRouteContext).mockResolvedValueOnce({
      em: mockEm, tenantId, organizationId: null,
      translate: (key: string, fallback?: string) => fallback ?? key,
    } as never)
    const response = await GET(new Request('http://localhost/api/customers/customer-dictionary-entries'))
    expect(response.status).toBe(400)
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(mockEm.count).not.toHaveBeenCalled()
  })
})
