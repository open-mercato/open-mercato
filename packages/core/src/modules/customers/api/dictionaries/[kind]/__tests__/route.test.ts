const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const em = {
  find: jest.fn(),
}

jest.mock('../../context', () => ({
  mapDictionaryKind: jest.fn((kind?: string) => ({
    kind,
    mappedKind: kind === 'statuses' ? 'status' : kind,
  })),
  resolveDictionaryRouteContext: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? 'error',
    em,
    organizationId,
    tenantId,
    readableOrganizationIds: [organizationId, '99999999-9999-9999-9999-999999999999'],
    cache: undefined,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { GET } from '../route'
import { resolveDictionaryRouteContext } from '../../context'

describe('customer dictionary route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns local dictionary entries first while preserving inherited entries that are not overridden', async () => {
    em.find.mockResolvedValueOnce([
      {
        id: 'local-active',
        value: 'active',
        label: 'Active',
        color: '#3366ff',
        icon: 'circle',
        organizationId,
        normalizedValue: 'active',
      },
      {
        id: 'inherited-active',
        value: 'active',
        label: 'Active (parent)',
        color: '#94a3b8',
        icon: 'circle',
        organizationId: '99999999-9999-9999-9999-999999999999',
        normalizedValue: 'active',
      },
      {
        id: 'inherited-lead',
        value: 'lead',
        label: 'Lead',
        color: '#22c55e',
        icon: 'sparkles',
        organizationId: '99999999-9999-9999-9999-999999999999',
        normalizedValue: 'lead',
      },
    ])

    const response = await GET(
      new Request('http://localhost/api/customers/dictionaries/statuses'),
      { params: { kind: 'statuses' } },
    )

    expect(response.status).toBe(200)
    expect(em.find).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        kind: 'status',
        organizationId: {
          $in: [organizationId, '99999999-9999-9999-9999-999999999999'],
        },
      }),
      expect.objectContaining({
        orderBy: { label: 'asc' },
      }),
    )

    const body = await response.json()
    expect(body.items).toEqual([
      {
        id: 'local-active',
        value: 'active',
        label: 'Active',
        color: '#3366ff',
        icon: 'circle',
        organizationId,
        isInherited: false,
      },
      {
        id: 'inherited-lead',
        value: 'lead',
        label: 'Lead',
        color: '#22c55e',
        icon: 'sparkles',
        organizationId: '99999999-9999-9999-9999-999999999999',
        isInherited: true,
      },
    ])
  })

  it('passes organization overrides through to the dictionary context resolver', async () => {
    em.find.mockResolvedValueOnce([])

    await GET(
      new Request(`http://localhost/api/customers/dictionaries/statuses?organizationId=${organizationId}`),
      { params: { kind: 'statuses' } },
    )

    expect(resolveDictionaryRouteContext).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ selectedId: organizationId }),
    )
  })
})
