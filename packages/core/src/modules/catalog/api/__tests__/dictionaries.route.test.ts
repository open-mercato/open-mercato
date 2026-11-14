/** @jest-environment node */

const mockEm = {
  find: jest.fn(),
}

const mockCanViewDictionaries = jest.fn()
const mockContainer = { resolve: jest.fn(() => ({ userHasAllFeatures: mockCanViewDictionaries })) }
const mockContext = {
  container: mockContainer,
  em: mockEm,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  readableOrganizationIds: ['org-1', 'org-parent'],
  auth: { sub: 'user-1' },
  translate: (key: string) => key,
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => mockContext),
}))

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: class Dictionary {},
  DictionaryEntry: class DictionaryEntry {},
}))

import { applyLocalizedContent } from '@open-mercato/shared/lib/localization/resolver'
import { registerTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { resolveLocaleFromRequest } from '@open-mercato/core/modules/translations/lib/locale'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'
import { GET } from '../dictionaries/[key]/route'

const dictionary = { id: 'dict-1', organizationId: 'org-1', tenantId: 'tenant-1' }
const entries = [
  { id: 'entry-box', value: 'box', label: 'Box (piece)', color: null, icon: null },
  { id: 'entry-kg', value: 'kg', label: 'Kilogram (weight)', color: null, icon: null },
]
const storedTranslations: Record<string, Record<string, Record<string, unknown>>> = {
  'entry-box': { pl: { label: 'QA AI karton' } },
}

function request(locale?: string) {
  const headers: Record<string, string> = locale ? { cookie: `locale=${locale}` } : {}
  return new Request('http://localhost/api/catalog/dictionaries/unit', { headers })
}

async function readEntries(response: Response) {
  const body = (await response.json()) as { entries: Array<{ value: string; label: string }> }
  return body.entries.map((entry) => ({ value: entry.value, label: entry.label }))
}

describe('catalog dictionary lookup — entry translations (#6951)', () => {
  const overlay = jest.fn(async (items: Record<string, unknown>[], options: { locale: string }) =>
    items.map((item) => applyLocalizedContent(item, storedTranslations[String(item.id)] ?? null, options.locale)),
  )

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockImplementation(async (entity: unknown) => (entity === Dictionary ? [dictionary] : entries))
    registerTranslationOverlayPlugin(overlay, resolveLocaleFromRequest)
  })

  afterAll(() => {
    registerTranslationOverlayPlugin(null, null)
  })

  it('returns the label translation saved for the request locale', async () => {
    const response = await GET(request('pl'), { params: { key: 'unit' } })

    expect(response.status).toBe(200)
    expect(await readEntries(response)).toEqual([
      { value: 'box', label: 'QA AI karton' },
      { value: 'kg', label: 'Kilogram (weight)' },
    ])
    expect(overlay).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        entityType: 'dictionaries:dictionary_entry',
        locale: 'pl',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        container: mockContainer,
      }),
    )
  })

  it('keeps the stored label when no translation exists for the locale', async () => {
    const response = await GET(request('de'), { params: { key: 'unit' } })

    expect(await readEntries(response)).toEqual([
      { value: 'box', label: 'Box (piece)' },
      { value: 'kg', label: 'Kilogram (weight)' },
    ])
  })

  it('keeps the stored labels when the translations module is not registered', async () => {
    registerTranslationOverlayPlugin(null, null)

    const response = await GET(request('pl'), { params: { key: 'unit' } })

    expect(await readEntries(response)).toEqual([
      { value: 'box', label: 'Box (piece)' },
      { value: 'kg', label: 'Kilogram (weight)' },
    ])
  })

  it('matches translated labels to entries by id regardless of overlay order', async () => {
    overlay.mockImplementationOnce(async (items: Record<string, unknown>[], options: { locale: string }) =>
      items
        .map((item) => applyLocalizedContent(item, storedTranslations[String(item.id)] ?? null, options.locale))
        .reverse(),
    )

    const response = await GET(request('pl'), { params: { key: 'unit' } })

    expect(await readEntries(response)).toEqual([
      { value: 'box', label: 'QA AI karton' },
      { value: 'kg', label: 'Kilogram (weight)' },
    ])
  })

  it('reads translations in the selected organization scope they are saved under', async () => {
    const inheritedDictionary = { id: 'dict-parent', organizationId: 'org-parent', tenantId: 'tenant-1' }
    mockEm.find.mockImplementation(async (entity: unknown) =>
      entity === Dictionary ? [inheritedDictionary] : entries,
    )

    const response = await GET(request('pl'), { params: { key: 'unit' } })

    expect(await readEntries(response)).toContainEqual({ value: 'box', label: 'QA AI karton' })
    expect(overlay).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
    )
  })

  it('falls back to the stored labels when the overlay fails', async () => {
    overlay.mockRejectedValueOnce(new Error('[internal] overlay unavailable'))

    const response = await GET(request('pl'), { params: { key: 'unit' } })

    expect(response.status).toBe(200)
    expect(await readEntries(response)).toEqual([
      { value: 'box', label: 'Box (piece)' },
      { value: 'kg', label: 'Kilogram (weight)' },
    ])
  })
})


describe('catalog dictionary authorization and organization scope (#9157)', () => {
  const storedDictionaries = [
    { id: 'outside', key: 'unit', organizationId: 'org-outside', tenantId: 'tenant-1', deletedAt: null, isActive: true },
    { id: 'parent', key: 'unit', organizationId: 'org-parent', tenantId: 'tenant-1', deletedAt: null, isActive: true },
    { id: 'own', key: 'unit', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null, isActive: true },
    { id: 'other-tenant', key: 'unit', organizationId: 'org-1', tenantId: 'tenant-other', deletedAt: null, isActive: true },
    { id: 'custom', key: 'private-status', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null, isActive: true },
  ]
  let availableDictionaries = storedDictionaries

  beforeEach(() => {
    jest.clearAllMocks()
    mockContext.readableOrganizationIds = ['org-1', 'org-parent']
    mockCanViewDictionaries.mockResolvedValue(false)
    availableDictionaries = storedDictionaries
    registerTranslationOverlayPlugin(null, null)
    mockEm.find.mockImplementation(async (entity: unknown, where: {
      tenantId: string
      organizationId?: { $in: string[] } | string
      key?: { $in: string[] }
      dictionary?: { id: string }
      deletedAt?: null
      isActive?: boolean
    }) => {
      if (entity !== Dictionary) return [{ ...entries[0], id: `${where.dictionary?.id}-entry` }]
      return availableDictionaries.filter((item) =>
        item.tenantId === where.tenantId
        && where.key?.$in.includes(item.key)
        && (typeof where.organizationId !== 'object' || where.organizationId.$in.includes(item.organizationId))
        && item.deletedAt === where.deletedAt
        && item.isActive === where.isActive,
      )
    })
  })

  it('does not expose a dictionary that exists only in another organization', async () => {
    availableDictionaries = storedDictionaries.filter((item) => item.id === 'outside')

    const response = await GET(request(), { params: { key: 'unit' } })

    expect(response.status).toBe(404)
    expect(mockEm.find).toHaveBeenCalledTimes(1)
  })

  it('fails closed when no organizations are readable', async () => {
    mockContext.readableOrganizationIds = []

    const response = await GET(request(), { params: { key: 'unit' } })

    expect(response.status).toBe(404)
  })

  it('prefers the selected organization and keeps tenant, active and deletion filters', async () => {
    const response = await GET(request(), { params: { key: ' UNIT ' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'own', entries: [{ id: 'own-entry' }] })
    expect(mockEm.find).toHaveBeenNthCalledWith(1, Dictionary, {
      tenantId: 'tenant-1',
      organizationId: { $in: ['org-1', 'org-parent'] },
      key: { $in: ['unit', 'units', 'measurement_units'] },
      deletedAt: null,
      isActive: true,
    }, expect.any(Object))
    expect(mockCanViewDictionaries).not.toHaveBeenCalled()
  })

  it('falls back only to a readable inherited dictionary', async () => {
    availableDictionaries = storedDictionaries.filter((item) => item.id !== 'own')

    const response = await GET(request(), { params: { key: 'unit' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'parent', entries: [{ id: 'parent-entry' }] })
  })

  it.each(['currency', 'currencies', 'unit', 'units', 'measurement_units'])(
    'keeps catalog-owned key %s available without dictionaries.view', async (key) => {
      await GET(request(), { params: { key } })

      expect(mockCanViewDictionaries).not.toHaveBeenCalled()
      expect(mockEm.find).toHaveBeenCalled()
    },
  )

  it.each(['private-status', 'constructor', '__proto__', 'tostring'])(
    'requires dictionaries.view before reading non-catalog key %s', async (key) => {
      const response = await GET(request(), { params: { key } })

      expect(response.status).toBe(403)
      expect(mockCanViewDictionaries).toHaveBeenCalledWith('user-1', ['dictionaries.view'], {
        tenantId: 'tenant-1', organizationId: 'org-1',
      })
      expect(mockEm.find).not.toHaveBeenCalled()
    },
  )

  it('preserves arbitrary-key reads when the scoped RBAC service authorizes them', async () => {
    mockCanViewDictionaries.mockResolvedValue(true)

    const response = await GET(request(), { params: { key: 'private-status' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'custom' })
    expect(mockCanViewDictionaries).toHaveBeenCalledWith('user-1', ['dictionaries.view'], {
      tenantId: 'tenant-1', organizationId: 'org-1',
    })
  })
})
