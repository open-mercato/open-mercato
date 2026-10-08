import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFormFixture,
  deleteFormIfExists,
  uniqueFormKey,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-CRUD-003: a duplicate form key inside one organization is rejected.
 *
 * `forms.form.create` raises `CrudHttpError(422, 'forms.errors.form_key_taken')`,
 * which `handleRouteError` passes through verbatim — so unlike the malformed-
 * payload probes this one can pin the status and code exactly.
 */
test.describe('TC-FORMS-CRUD-003: duplicate form key', () => {
  test('rejects a second form with the same key and leaves the first intact', async ({ request }) => {
    const key = uniqueFormKey('qa_crud003')
    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      const first = await createFormFixture(request, adminToken, { key, name: 'QA CRUD003 original' })
      formId = first.id

      const duplicateRes = await apiRequest(request, 'POST', '/api/forms', {
        token: adminToken,
        data: { key, name: 'QA CRUD003 duplicate', defaultLocale: 'en', supportedLocales: ['en'] },
      })
      const duplicateBody = await readJsonSafe<{ error?: string; id?: string }>(duplicateRes)
      expect(duplicateRes.status(), 'the duplicate key should be a 422').toBe(422)
      expect(duplicateBody?.error, 'the duplicate should name the key conflict').toBe('forms.errors.form_key_taken')
      expect(duplicateBody?.id, 'a rejected create must not report an id').toBeFalsy()

      const stillThere = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      expect(stillThere.status(), 'the original form is untouched').toBe(200)
      const detail = await readJsonSafe<{ name?: string }>(stillThere)
      expect(detail?.name, 'the original name survived the rejected duplicate').toBe('QA CRUD003 original')

      // No orphan row: exactly one form carries this key.
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(key)}&pageSize=100`,
        { token: adminToken },
      )
      const list = await readJsonSafe<{ items?: Array<{ key: string }> }>(listRes)
      const matching = (list?.items ?? []).filter((item) => item.key === key)
      expect(matching.length, 'the rejected create left no orphan row behind').toBe(1)
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
