import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteFormIfExists,
  uniqueFormKey,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-CRUD-001: form create → read → patch → delete round trip.
 *
 * `DELETE /api/forms/:id` runs `forms.form.archive`, which sets
 * `status = 'archived'` and leaves `deleted_at` null (commands/form.ts) — so the
 * post-delete read is a 200 carrying `status: 'archived'`, not a 404. The plan's
 * "final GET 404" expectation does not match the implementation; this asserts
 * the real (and more useful) contract, because a 404 assertion here would pass
 * just as happily against a hard delete.
 */
test.describe('TC-FORMS-CRUD-001: form CRUD round trip', () => {
  test('creates, reads, renames and archives a form', async ({ request }) => {
    const key = uniqueFormKey('qa_crud001')
    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      const createRes = await apiRequest(request, 'POST', '/api/forms', {
        token: adminToken,
        data: {
          key,
          name: 'QA CRUD 001',
          description: 'created by TC-FORMS-CRUD-001',
          defaultLocale: 'en',
          supportedLocales: ['en', 'pl'],
        },
      })
      const created = await readJsonSafe<{ id?: string }>(createRes)
      expect(createRes.status(), 'create should return 201').toBe(201)
      formId = created?.id ?? null
      expect(formId, 'create should return the new form id').toBeTruthy()

      const readRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      expect(readRes.status(), 'detail read should return 200').toBe(200)
      const detail = await readJsonSafe<{
        key?: string
        name?: string
        status?: string
        defaultLocale?: string
        supportedLocales?: string[]
        currentPublishedVersionId?: string | null
        versions?: unknown[]
      }>(readRes)
      expect(detail?.key, 'detail should echo the key').toBe(key)
      expect(detail?.name, 'detail should echo the name').toBe('QA CRUD 001')
      expect(detail?.status, 'a form with no published version starts as draft').toBe('draft')
      expect(detail?.defaultLocale).toBe('en')
      expect(detail?.supportedLocales).toEqual(['en', 'pl'])
      expect(detail?.currentPublishedVersionId, 'nothing is published yet').toBeNull()
      expect(Array.isArray(detail?.versions), 'detail carries a versions array').toBe(true)

      const patchRes = await apiRequest(request, 'PATCH', `/api/forms/${formId}`, {
        token: adminToken,
        data: { name: 'QA CRUD 001 renamed' },
      })
      expect(patchRes.status(), 'patch should return 200').toBe(200)
      const patchResult = await readJsonSafe<{ ok?: boolean; updatedAt?: string }>(patchRes)
      expect(patchResult).toEqual(expect.objectContaining({ ok: true }))
      expect(patchResult?.updatedAt, 'patch returns the fresh optimistic-lock token').toBeTruthy()

      const afterPatch = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      const patched = await readJsonSafe<{ name?: string }>(afterPatch)
      expect(patched?.name, 'the rename persisted').toBe('QA CRUD 001 renamed')

      const deleteRes = await apiRequest(request, 'DELETE', `/api/forms/${formId}`, { token: adminToken })
      expect(deleteRes.status(), 'delete should return 200').toBe(200)
      const deleteResult = await readJsonSafe<{ ok?: boolean; updatedAt?: string }>(deleteRes)
      expect(deleteResult).toEqual(expect.objectContaining({ ok: true }))
      expect(deleteResult?.updatedAt, 'archive returns the fresh optimistic-lock token').toBeTruthy()

      const afterDelete = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      expect(afterDelete.status(), 'archive is a soft transition, so the row stays readable').toBe(200)
      const archived = await readJsonSafe<{ status?: string }>(afterDelete)
      expect(archived?.status, 'delete archives the form rather than removing it').toBe('archived')
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
