/** @jest-environment node */

const mockEm = {
  find: jest.fn(),
}

const mockContainer = { resolve: jest.fn() }

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => ({
    container: mockContainer,
    em: mockEm,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  })),
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
