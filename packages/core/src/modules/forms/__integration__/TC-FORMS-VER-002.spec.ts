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
 * SKIPPED — MODULE DEFECT, not a test defect. Draft-schema validation fails OPEN.
 *
 * `forms.form_version.update_draft` compiles the incoming schema and translates a
 * `FormCompilationError` into `422 forms.errors.schema_invalid`. Its catch block
 * (commands/form-version.ts, the `if (touched)` block) is:
 *
 *     } catch (error) {
 *       if (error instanceof FormCompilationError) {
 *         throw new CrudHttpError(422, { error: 'forms.errors.schema_invalid', … })
 *       }
 *       version.registryVersion = registry.getRegistryVersion()
 *     }
 *
 * The fallback arm SWALLOWS the error and stamps a registry version as though the
 * compile had succeeded. So whenever `instanceof FormCompilationError` does not
 * hold — the same class-identity problem that turns the runtime's service errors
 * into 500s, see the notes for this task — the invalid schema is accepted and
 * persisted with a 200.
 *
 * Observed on the ephemeral lane at this commit, on a freshly started app:
 *
 *     PATCH /api/forms/:id/versions/:versionId
 *       body: schema with "x-om-editable-by": ["not_a_declared_role"]
 *       -> 200 {"ok":true}
 *     GET /api/forms/:id/versions/:versionId
 *       -> schema still contains "not_a_declared_role", schemaHash stamped, status "draft"
 *     POST /api/forms/:id/versions/:versionId/publish
 *       -> 500 {"error":"forms.errors.internal"}
 *
 * Expected: 422 `forms.errors.schema_invalid` on the PATCH, nothing persisted.
 *
 * Why it matters: the compiled schema is the contract every later stage trusts —
 * AJV validation of answers, the role read/write policy, the field index the
 * renderer draws from, and the `schemaHash` pinned on the published version. A
 * draft that holds an uncompilable schema is a form the author cannot publish and
 * cannot diagnose: the only feedback is an opaque `500 forms.errors.internal`,
 * with no code, path or message pointing at the offending keyword. Worse, the
 * stamped `schemaHash` makes the row look validated to anything that reads it.
 * The status quo is strictly worse than rejecting at save time, which the code
 * clearly intends to do.
 *
 * Two fixes are needed and they are independent:
 *  1. Make the fallback arm fail CLOSED — rethrow (or map to a 500 with the
 *     underlying message) instead of silently continuing. An error path that
 *     cannot classify its error must not conclude "all good".
 *  2. Fix the underlying class-identity problem so `instanceof` is reliable; that
 *     also repairs the runtime's 4xx/5xx mapping.
 *
 * Then delete the `test.skip` below. The spec is written against the intended
 * behaviour and needs no other change — it also asserts the schema was not
 * persisted, which is the half a status-only assertion would miss.
 */
test.describe('TC-FORMS-VER-002: uncompilable schemas cannot be published', () => {
  // Unskipped: update_draft now rethrows an unclassified compile failure instead of persisting the schema.

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
