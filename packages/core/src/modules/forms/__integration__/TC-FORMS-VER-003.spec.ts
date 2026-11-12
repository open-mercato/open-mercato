import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalFormSchema,
  createPublishedFormFixture,
  deleteFormIfExists,
  forkDraftFixture,
  publishVersionFixture,
  updateDraftFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-VER-003: forking from a published version produces v2, and v1 stays
 * readable.
 *
 * Immutability of a published version is the contract every in-flight submission
 * depends on — a submission pins `form_version_id`, so v1 must survive v2's
 * publish. The v1 status assertion is deliberately a set (`published` or
 * `archived`) with the observed value pinned in a second assertion, because the
 * module could reasonably archive the superseded version and the plan did not
 * settle which it does.
 */
test.describe('TC-FORMS-VER-003: fork from a published version', () => {
  test('publishes v2, repoints the form, and leaves v1 readable', async ({ request }) => {
    test.slow()

    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: 'QA VER003' })
      formId = published.formId
      expect(published.versionNumber, 'the fixture published version 1').toBe(1)

      const secondDraftId = await forkDraftFixture(request, adminToken, formId, published.versionId)
      expect(secondDraftId, 'forking from v1 yields a new draft id').not.toBe(published.versionId)

      // Change a label so the schema hash differs — an identical republish is
      // refused with `no_op_publish`, which would mask this case.
      const changedSchema = buildMinimalFormSchema()
      const properties = changedSchema.properties as Record<string, Record<string, unknown>>
      properties.full_name['x-om-label'] = { en: 'Full legal name' }
      await updateDraftFixture(request, adminToken, formId, secondDraftId, {
        schema: changedSchema,
        uiSchema: { full_name: { 'ui:widget': 'text' } },
        roles: ['admin', 'participant'],
        changelog: 'relabel full_name',
      })

      const secondPublish = await publishVersionFixture(request, adminToken, formId, secondDraftId, 'v2')
      expect(secondPublish.versionNumber, 'the second publish is version 2').toBe(2)

      const detailRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      const detail = await readJsonSafe<{
        currentPublishedVersionId?: string | null
        versions?: Array<{ id: string; status: string; versionNumber: number; schemaHash: string }>
      }>(detailRes)
      expect(detail?.currentPublishedVersionId, 'the form now serves v2').toBe(secondDraftId)

      const v1 = (detail?.versions ?? []).find((entry) => entry.id === published.versionId)
      const v2 = (detail?.versions ?? []).find((entry) => entry.id === secondDraftId)
      expect(v1, 'v1 is still listed').toBeTruthy()
      expect(v2, 'v2 is listed').toBeTruthy()
      expect(v1?.versionNumber).toBe(1)
      expect(v2?.versionNumber).toBe(2)
      expect(
        v1?.schemaHash === v2?.schemaHash,
        'the edited schema must produce a different hash',
      ).toBe(false)

      const v1Res = await apiRequest(request, 'GET', `/api/forms/${formId}/versions/${published.versionId}`, {
        token: adminToken,
      })
      expect(v1Res.status(), 'the superseded version is still readable').toBe(200)
      const v1Detail = await readJsonSafe<{ status?: string; versionNumber?: number }>(v1Res)
      expect(v1Detail?.versionNumber, 'the superseded version keeps its number').toBe(1)
      // `forms.form_version.publish` repoints `currentPublishedVersionId` but
      // never touches the superseded row, so v1 stays `published`. Pinned so a
      // future archive-on-supersede change is a failing test rather than a
      // silent behaviour drift for submissions that pinned v1.
      expect(v1Detail?.status, 'publishing v2 leaves v1 published, not archived').toBe('published')
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
