import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalFormSchema,
  createFormFixture,
  deleteFormIfExists,
  forkDraftFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-VER-001: the full authoring lifecycle — fork a draft, fill it,
 * publish it, and see the parent form flip to `active`.
 *
 * Publishing is the only thing that makes a form runnable, so the parent-form
 * side effects (`status`, `currentPublishedVersionId`,
 * `currentPublishedVersionNumber`) are as load-bearing as the version row itself.
 */
test.describe('TC-FORMS-VER-001: draft → publish lifecycle', () => {
  test('forks a draft, updates its schema and publishes version 1', async ({ request }) => {
    test.slow()

    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const form = await createFormFixture(request, adminToken, { name: 'QA VER001' })
      formId = form.id

      const versionId = await forkDraftFixture(request, adminToken, formId)

      const beforePublish = await apiRequest(request, 'GET', `/api/forms/${formId}/versions/${versionId}`, {
        token: adminToken,
      })
      expect(beforePublish.status(), 'the forked version is readable').toBe(200)
      const draft = await readJsonSafe<{ status?: string; versionNumber?: number }>(beforePublish)
      expect(draft?.status, 'a fresh fork is a draft').toBe('draft')

      const patchRes = await apiRequest(request, 'PATCH', `/api/forms/${formId}/versions/${versionId}`, {
        token: adminToken,
        data: {
          schema: buildMinimalFormSchema(),
          uiSchema: { full_name: { 'ui:widget': 'text' } },
          roles: ['admin', 'participant'],
          changelog: 'initial schema',
        },
      })
      expect(patchRes.status(), 'updating the draft should return 200').toBe(200)
      const patchResult = await readJsonSafe<{ ok?: boolean; updatedAt?: string }>(patchRes)
      expect(patchResult).toEqual(expect.objectContaining({ ok: true }))
      expect(patchResult?.updatedAt, 'draft update returns the fresh optimistic-lock token').toBeTruthy()

      const publishRes = await apiRequest(
        request,
        'POST',
        `/api/forms/${formId}/versions/${versionId}/publish`,
        { token: adminToken, data: { changelog: 'v1' } },
      )
      const published = await readJsonSafe<{ versionId?: string; versionNumber?: number }>(publishRes)
      expect(
        publishRes.status(),
        `publish should return 200 (got ${publishRes.status()}: ${JSON.stringify(published)})`,
      ).toBe(200)
      expect(published?.versionId, 'publish echoes the version id').toBe(versionId)
      expect(published?.versionNumber, 'the first publish is version 1').toBe(1)

      const detailRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      const detail = await readJsonSafe<{
        status?: string
        currentPublishedVersionId?: string | null
        versions?: Array<{ id: string; status: string; versionNumber: number; schemaHash: string }>
      }>(detailRes)
      expect(detail?.status, 'publishing activates the parent form').toBe('active')
      expect(detail?.currentPublishedVersionId, 'the parent points at the published version').toBe(versionId)

      const versionRow = (detail?.versions ?? []).find((entry) => entry.id === versionId)
      expect(versionRow, 'the published version appears in the detail projection').toBeTruthy()
      expect(versionRow?.status, 'the version row is published').toBe('published')
      expect(versionRow?.versionNumber, 'the version row carries number 1').toBe(1)
      expect(versionRow?.schemaHash, 'publishing pins a schema hash').toMatch(/^[a-f0-9]{64}$/)

      // The list projection agrees with the detail projection.
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(form.key)}&pageSize=100`,
        { token: adminToken },
      )
      const list = await readJsonSafe<{
        items?: Array<{ id: string; currentPublishedVersionNumber: number | null }>
      }>(listRes)
      const listed = (list?.items ?? []).find((item) => item.id === formId)
      expect(listed?.currentPublishedVersionNumber, 'the list reports the published version number').toBe(1)
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
