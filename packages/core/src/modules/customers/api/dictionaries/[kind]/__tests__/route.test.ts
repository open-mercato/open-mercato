const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const em = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

jest.mock('../../context', () => ({
  mapDictionaryKind: jest.fn((kind?: string) => ({
    kind,
    mappedKind: kind === 'statuses' ? 'status' : kind === 'pipeline-stages' ? 'pipeline_stage' : kind,
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
  loadDictionary: jest.fn(async (locale: string) => require(`../../../../i18n/${locale}.json`)),
  resolveTranslations: async () => ({
    locale: 'en',
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const mockOverlay = jest.fn(async (items: Record<string, unknown>[]) => items)

jest.mock('@open-mercato/shared/lib/localization/overlay-plugin', () => ({
  getTranslationOverlayPlugin: () => ({
    overlay: mockOverlay,
    resolveLocale: (req: Request) => new URL(req.url).searchParams.get('locale') ?? 'en',
  }),
}))

jest.mock('../../../../commands/settings', () => ({
  loadCustomerSettings: jest.fn(async () => null),
}))

import { GET } from '../route'
import { resolveDictionaryRouteContext } from '../../context'
import { CUSTOMER_DICTIONARY_ORGANIZATION_REQUIRED_CODE } from '../../../../lib/dictionaries'

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
    expect(body.sortMode).toBe('label_asc')
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

  it('returns a stable error code when organization context is unavailable', async () => {
    jest.mocked(resolveDictionaryRouteContext).mockResolvedValueOnce({
      translate: (_key: string, fallback?: string) => fallback ?? 'error',
      em,
      organizationId: null,
      tenantId,
      readableOrganizationIds: [],
      cache: undefined,
    } as never)

    const response = await GET(
      new Request('http://localhost/api/customers/dictionaries/statuses'),
      { params: { kind: 'statuses' } },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Organization context is required',
      code: CUSTOMER_DICTIONARY_ORGANIZATION_REQUIRED_CODE,
    })
  })

  it('does not seed/persist pipeline_stage entries for stages lacking one (read-only GET, #2735)', async () => {
    const stage = {
      id: '33333333-3333-4333-8333-333333333333',
      label: 'Legacy Stage Without Entry',
      organizationId,
      tenantId,
    }
    // First find loads dictionary entries (none); second loads pipeline stages.
    em.find.mockResolvedValueOnce([]).mockResolvedValueOnce([stage])
    em.findOne.mockResolvedValue(null)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'seeded-entry',
      normalizedValue: String((payload as { value?: string }).value ?? '').trim().toLowerCase(),
      ...payload,
    }))

    const response = await GET(
      new Request('http://localhost/api/customers/dictionaries/pipeline-stages'),
      { params: { kind: 'pipeline-stages' } },
    )

    expect(response.status).toBe(200)

    // A GET must not have write side effects — a pipeline stage missing its
    // dictionary entry must NOT be auto-seeded inside the read handler (#2735).
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})


describe('localized customer dictionary reads', () => {
  const entries = [
    { id: '33333333-3333-4333-8333-333333333333', value: 'archived', label: 'Archived', organizationId, normalizedValue: 'archived' },
    { id: '44444444-4444-4444-8444-444444444444', value: 'inactive', label: 'Inactive', organizationId, normalizedValue: 'inactive' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    em.find.mockReset()
    mockOverlay.mockImplementation(async (items) => items)
  })

  it('sorts the displayed translated labels while keeping stable values', async () => {
    em.find.mockResolvedValueOnce(entries)
    const response = await GET(new Request('http://localhost/api/customers/dictionaries/statuses?locale=pl'), { params: { kind: 'statuses' } })
    const body = await response.json()
    expect(body.items.map((item: { value: string; label: string }) => [item.value, item.label])).toEqual([
      ['inactive', 'Nieaktywny'], ['archived', 'Zarchiwizowany'],
    ])
    expect(entries[0].label).toBe('Archived')
  })

  it('caches base labels and re-applies translations on a cache hit', async () => {
    const stored = new Map<string, unknown>()
    const cache = {
      get: jest.fn(async (key: string) => stored.get(key) ?? null),
      set: jest.fn(async (key: string, payload: unknown) => { stored.set(key, payload) }),
    }
    jest.mocked(resolveDictionaryRouteContext).mockResolvedValue({
      translate: (key: string, fallback?: string) => fallback ?? key,
      em, tenantId, organizationId, readableOrganizationIds: [organizationId], cache,
    } as never)
    em.find.mockResolvedValue(entries)
    const req = new Request('http://localhost/api/customers/dictionaries/statuses?locale=pl')
    const first = await GET(req, { params: { kind: 'statuses' } })
    expect((await first.json()).items[0].label).toBe('Nieaktywny')
    expect(Array.from(stored.values())[0]).toMatchObject({ items: [{ label: 'Archived' }, { label: 'Inactive' }] })

    mockOverlay.mockImplementation(async (items) => items.map((item) => ({ ...item, label: `Custom ${item.label}` })))
    const second = await GET(req, { params: { kind: 'statuses' } })
    expect((await second.json()).items[0].label).toBe('Custom Nieaktywny')
    expect(em.find).toHaveBeenCalledTimes(1)

    const english = await GET(new Request('http://localhost/api/customers/dictionaries/statuses?locale=en'), { params: { kind: 'statuses' } })
    expect((await english.json()).items[0].label).toBe('Custom Archived')
    expect(stored.size).toBe(2)
    expect(Array.from(stored.keys())).toEqual(expect.arrayContaining([expect.stringContaining('locale=pl'), expect.stringContaining('locale=en')]))
  })
})
