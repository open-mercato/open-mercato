import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalFormSchema,
  buildUncompilableFormSchema,
  createFormFixture,
  deleteFormIfExists,
  forkDraftFixture,
  updateDraftFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-VER-002: an uncompilable schema never reaches a published version.
 *
 * The plan expected the rejection at publish time. The module rejects it EARLIER —
 * `forms.form_version.update_draft` compiles too, so a broken schema is refused
 * by the draft `PATCH` with `422 forms.errors.schema_invalid` and is never
 * persisted at all. That is the stronger contract, so this asserts it where it
 * actually happens: an uncompilable draft cannot exist in the first place.
 *
 * The publish path is compiled too (`commands/form-version.ts` wraps
 * `FormCompilationError` in a `CrudHttpError(422)`), which is the arm that would
 * catch a schema that became uncompilable after the fact — a field-type registry
 * change, say. It is not probed with an empty draft here because an empty schema
 * compiles fine and publishes: a fork that was never filled in yields a valid,
 * fieldless version. That is a separate observation, not this case's claim.
 */
test.describe('TC-FORMS-VER-002: uncompilable schemas cannot be published', () => {
  test('rejects a broken schema on draft update and never persists it', async ({ request }) => {
    test.slow()

    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const form = await createFormFixture(request, adminToken, { name: 'QA VER002' })
      formId = form.id

      const versionId = await forkDraftFixture(request, adminToken, formId)

      const brokenPatch = await apiRequest(request, 'PATCH', `/api/forms/${formId}/versions/${versionId}`, {
        token: adminToken,
        data: { schema: buildUncompilableFormSchema(), uiSchema: {}, roles: ['admin', 'participant'] },
      })
      const brokenBody = await readJsonSafe<{
        error?: string
        code?: string
        path?: unknown
        message?: string
      }>(brokenPatch)
      expect(
        brokenPatch.status(),
        `a broken schema must be refused on draft update (got ${brokenPatch.status()}: ${JSON.stringify(brokenBody)})`,
      ).toBe(422)
      expect(brokenBody?.error, 'the rejection names the invalid schema').toBe('forms.errors.schema_invalid')
      expect(brokenBody?.code, 'the rejection carries the compiler error code').toBe('ROLE_NOT_DECLARED')
      expect(brokenBody?.path, 'the rejection points at the offending keyword').toEqual([
        'properties',
        'full_name',
        'x-om-editable-by',
      ])
      expect(brokenBody?.message, 'the rejection explains which role is undeclared').toContain(
        'not_a_declared_role',
      )

      // The refused PATCH persisted nothing: the draft still carries the empty
      // schema the fork created, so the broken one never reached the table.
      const versionRes = await apiRequest(request, 'GET', `/api/forms/${formId}/versions/${versionId}`, {
        token: adminToken,
      })
      expect(versionRes.status(), 'the draft is still readable').toBe(200)
      const version = await readJsonSafe<{ status?: string; schema?: Record<string, unknown> }>(versionRes)
      expect(version?.status, 'the draft was not advanced by the refused update').toBe('draft')
      expect(
        JSON.stringify(version?.schema ?? {}),
        'the refused schema was not persisted',
      ).not.toContain('not_a_declared_role')

      const detailRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      const detail = await readJsonSafe<{
        status?: string
        currentPublishedVersionId?: string | null
        versions?: Array<{ id: string; status: string }>
      }>(detailRes)
      expect(detail?.status, 'a refused schema update leaves the parent form in draft').toBe('draft')
      expect(detail?.currentPublishedVersionId, 'nothing was published').toBeNull()
      expect(
        (detail?.versions ?? []).find((entry) => entry.id === versionId)?.status,
        'the rejected version is still a draft',
      ).toBe('draft')

      // Control: the same draft accepts a valid schema and publishes, proving the
      // rejections above were about the schema and not a broken fixture.
      await updateDraftFixture(request, adminToken, formId, versionId, {
        schema: buildMinimalFormSchema(),
        uiSchema: { full_name: { 'ui:widget': 'text' } },
        roles: ['admin', 'participant'],
      })
      const goodPublish = await apiRequest(
        request,
        'POST',
        `/api/forms/${formId}/versions/${versionId}/publish`,
        { token: adminToken, data: {} },
      )
      expect(goodPublish.status(), 'a compilable schema publishes normally').toBe(200)
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
