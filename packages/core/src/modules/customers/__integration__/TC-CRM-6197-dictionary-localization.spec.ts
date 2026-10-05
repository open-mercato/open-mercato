import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

export const integrationMeta = { dependsOnModules: ['customers', 'translations'] }

type DictionaryItem = { id: string; value: string; label: string }

test.describe('TC-CRM-6197: Customer dictionary localization', () => {
  test('serves seeded labels by locale while preserving their values', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    for (const [locale, label] of Object.entries({ en: 'Active', pl: 'Aktywny', de: 'Aktiv', es: 'Activo', ko: '활성' })) {
      const response = await apiRequest(request, 'GET', `/api/customers/dictionaries/statuses?locale=${locale}`, { token })
      expect(response.ok()).toBeTruthy()
      const body: { items: DictionaryItem[] } = await response.json()
      expect(body.items.find((item) => item.value === 'active')?.label).toBe(label)
    }
  })

  test('lets TranslationManager find custom records and reflects saved labels through cached reads', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const value = `qa_dictionary_${Date.now()}`
    let entryId: string | null = null
    let translationPath: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/customers/dictionaries/sources', {
        token, data: { value, label: 'Custom source' },
      })
      expect(created.ok()).toBeTruthy()
      entryId = (await created.json()).id
      expect(entryId).toBeTruthy()
      translationPath = `/api/translations/customers%3Acustomer_dictionary_entry/${entryId}`
      const base = await apiRequest(request, 'GET', `/api/customers/customer-dictionary-entries?id=${entryId}&pageSize=1`, { token })
      expect(base.ok()).toBeTruthy()
      expect((await base.json()).items).toEqual([expect.objectContaining({ id: entryId, label: 'Custom source' })])

      const warm = await apiRequest(request, 'GET', '/api/customers/dictionaries/sources?locale=pl', { token })
      expect(warm.ok()).toBeTruthy()
      for (const label of ['Własne źródło', 'Nowe źródło']) {
        const saved = await apiRequest(request, 'PUT', translationPath, { token, data: { pl: { label } } })
        expect(saved.ok()).toBeTruthy()
        const localized = await apiRequest(request, 'GET', '/api/customers/dictionaries/sources?locale=pl', { token })
        expect(localized.ok()).toBeTruthy()
        const body: { items: DictionaryItem[] } = await localized.json()
        expect(body.items.find((item) => item.id === entryId)).toMatchObject({ value, label })
      }
      const english = await apiRequest(request, 'GET', '/api/customers/dictionaries/sources?locale=en', { token })
      expect(english.ok()).toBeTruthy()
      const englishBody: { items: DictionaryItem[] } = await english.json()
      expect(englishBody.items.find((item) => item.id === entryId)?.label).toBe('Custom source')
      const deleted = await apiRequest(request, 'DELETE', translationPath, { token })
      expect(deleted.ok()).toBeTruthy()
      const fallback = await apiRequest(request, 'GET', '/api/customers/dictionaries/sources?locale=pl', { token })
      expect(fallback.ok()).toBeTruthy()
      const fallbackBody: { items: DictionaryItem[] } = await fallback.json()
      expect(fallbackBody.items.find((item) => item.id === entryId)?.label).toBe('Custom source')
    } finally {
      if (translationPath) await apiRequest(request, 'DELETE', translationPath, { token })
      if (entryId) await apiRequest(request, 'DELETE', `/api/customers/dictionaries/sources/${entryId}`, { token })
    }
  })
})
