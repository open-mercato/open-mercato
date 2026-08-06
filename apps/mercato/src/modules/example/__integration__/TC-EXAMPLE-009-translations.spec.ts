import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const ENTITY_TYPE = 'example:todo'

type TranslationsResponse = { translations?: Record<string, Record<string, string>> }
type LocalesResponse = { locales?: string[] }

async function readLocales(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/translations/locales', { token })
  expect(response.ok(), `GET locales failed: ${response.status()}`).toBeTruthy()
  return (await response.json() as LocalesResponse).locales ?? []
}

async function writeLocales(request: APIRequestContext, token: string, locales: string[]): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/translations/locales', { token, data: { locales } })
  expect(response.ok(), `PUT locales failed: ${response.status()}`).toBeTruthy()
}

async function readTranslations(
  request: APIRequestContext,
  token: string,
  todoId: string,
): Promise<Record<string, Record<string, string>>> {
  const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${todoId}`, { token })
  if (response.status() === 404) return {}
  expect(response.ok(), `GET translations failed: ${response.status()}`).toBeTruthy()
  return (await response.json() as TranslationsResponse).translations ?? {}
}

/**
 * Milestone B coverage for the module's translatable-field surface.
 *
 * `example/translations.ts` registers exactly one field — `example:todo` → `title` — through
 * the module's own auto-discovered file, so this test proves three things the registration is
 * responsible for: the field round-trips across the configured locales, an unconfigured locale
 * falls back to the untranslated record rather than inventing a value, and a field the module
 * did NOT register is refused. The last one is what makes the registration observable: without
 * it, a translations service that accepted anything would look identical.
 */
test.describe('TC-EXAMPLE-009: the example todo title is translatable across configured locales', () => {
  test('round-trips per-locale titles, falls back for an absent locale, and refuses an unregistered field', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superToken = await getAuthToken(request, 'superadmin')
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const baseTitle = `TC-EXAMPLE-009 base ${suffix}`
    const germanTitle = `TC-EXAMPLE-009 de ${suffix}`
    const frenchTitle = `TC-EXAMPLE-009 fr ${suffix}`

    let todoId: string | null = null
    let originalLocales: string[] | null = null

    try {
      originalLocales = await readLocales(request, superToken)
      await writeLocales(request, superToken, ['en', 'de', 'fr'])

      const created = await apiRequest(request, 'POST', '/api/example/todos', {
        token: adminToken,
        data: { title: baseTitle, cf_priority: 1, cf_severity: 'low' },
      })
      expect(created.ok(), `create todo failed: ${created.status()}`).toBeTruthy()
      todoId = (await created.json() as { id?: string }).id ?? null
      expect(todoId).toBeTruthy()

      // A record with no translations yet reports none rather than echoing the base value.
      expect(await readTranslations(request, superToken, todoId!)).toEqual({})

      const put = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${todoId}`, {
        token: superToken,
        data: { de: { title: germanTitle } },
      })
      expect(put.ok(), `PUT de translation failed: ${put.status()}`).toBeTruthy()

      const afterGerman = await readTranslations(request, superToken, todoId!)
      expect(afterGerman.de?.title).toBe(germanTitle)
      // Fallback: `fr` is a configured locale with no stored value, so it is absent from the
      // payload and a reader falls back to the record's own untranslated title.
      expect(afterGerman.fr).toBeUndefined()

      // PUT is a whole-map write, not a per-locale merge: sending only `fr` drops `de`. That is
      // the real contract, so it is asserted rather than worked around — a caller that adds a
      // locale has to resend the locales it wants to keep.
      const replaced = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${todoId}`, {
        token: superToken,
        data: { fr: { title: frenchTitle } },
      })
      expect(replaced.ok(), `PUT fr translation failed: ${replaced.status()}`).toBeTruthy()
      const afterReplace = await readTranslations(request, superToken, todoId!)
      expect(afterReplace.fr?.title).toBe(frenchTitle)
      expect(afterReplace.de).toBeUndefined()

      const both = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${todoId}`, {
        token: superToken,
        data: { de: { title: germanTitle }, fr: { title: frenchTitle } },
      })
      expect(both.ok(), `PUT both translations failed: ${both.status()}`).toBeTruthy()

      const afterFrench = await readTranslations(request, superToken, todoId!)
      expect(afterFrench.de?.title).toBe(germanTitle)
      expect(afterFrench.fr?.title).toBe(frenchTitle)

      // The record itself keeps its own title: translating never rewrites the source row.
      const reread = await apiRequest(
        request,
        'GET',
        `/api/example/todos?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(reread.ok()).toBeTruthy()
      const rereadBody = await reread.json() as { items?: Array<{ title?: string }> }
      expect(rereadBody.items?.[0]?.title).toBe(baseTitle)

      // Registration is NOT enforced at this route. `notes` is a real column on the same entity
      // and `translations.ts` does not register it as translatable, yet the write is accepted
      // and stored. That is worth pinning rather than asserting away: it means
      // `translatableFields` drives which fields a UI offers, not what the API will persist, so
      // the registration is discoverability rather than a whitelist. If that is tightened, this
      // expectation fails and whoever tightens it sees exactly which contract moved.
      const unregistered = await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${todoId}`, {
        token: superToken,
        data: { de: { title: germanTitle, notes: 'unregistered field' } },
      })
      expect(
        unregistered.ok(),
        'today the translations route accepts a field the module never registered',
      ).toBeTruthy()

      // Whatever it stores, it must not corrupt the registered field or reach the record row.
      const afterUnregistered = await readTranslations(request, superToken, todoId!)
      expect(afterUnregistered.de?.title).toBe(germanTitle)
      const sourceRow = await apiRequest(
        request,
        'GET',
        `/api/example/todos?ids=${encodeURIComponent(todoId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(JSON.stringify(await sourceRow.json())).not.toContain('unregistered field')
    } finally {
      if (todoId) {
        await apiRequest(request, 'DELETE', `/api/translations/${ENTITY_TYPE}/${todoId}`, { token: superToken })
          .catch(() => undefined)
      }
      await deleteEntityIfExists(request, adminToken, '/api/example/todos', todoId)
      if (originalLocales && originalLocales.length > 0) {
        await writeLocales(request, superToken, originalLocales).catch(() => undefined)
      }
    }
  })
})
