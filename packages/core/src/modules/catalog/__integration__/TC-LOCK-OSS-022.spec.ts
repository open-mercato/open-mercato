import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readUpdatedAt,
  bumpRecordViaApi,
  putWithLock,
  expectConflictBody,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-022 — catalog option-schema (product-option-schema template)
 * optimistic-lock conflict contract (manual case CAT-07).
 *
 * The product-option-schema admin surface is `/api/catalog/option-schemas`
 * (`packages/core/src/modules/catalog/api/option-schemas/route.ts`), a
 * `makeCrudRoute` collection route whose update/delete dispatch on the body
 * `id` and run through the command pattern
 * (`catalog.optionSchemas.{update,delete}` in
 * `packages/core/src/modules/catalog/commands/optionSchemas.ts`). There is NO
 * dedicated `data-crud-field-id` CrudForm edit page for an option-schema
 * template — the only UI surface is an inline control inside the product form
 * (`backend/catalog/products/optionSchemaClient.ts`). So, exactly like
 * TC-LOCK-OSS-043, the conflict contract is proven at the API level:
 *
 *  1. create a fixture via `POST /api/catalog/option-schemas` (org/tenant are
 *     injected from auth by `parseScopedCommandInput`),
 *  2. capture its `updated_at`,
 *  3. advance `updated_at` out-of-band via a header-less PUT (the strictly
 *     additive path always succeeds and bumps `updated_at`),
 *  4. replay the now-stale write with the original expected-version header →
 *     409 `optimistic_lock_conflict`.
 *
 * The factory auto-registers a generic optimistic-lock reader for the
 * `CatalogOptionSchemaTemplate` entity (OSS opt-in optimistic locking, Step
 * 13.3 of `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`), so the collection
 * route enforces the lock without a hand-wired reader.
 */

const OPTION_SCHEMAS_API = '/api/catalog/option-schemas'

async function createOptionSchema(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<{ id: string; updatedAt: string }> {
  const created = await apiRequest(request, 'POST', OPTION_SCHEMAS_API, {
    token,
    data: {
      name: `QA Lock 022 ${stamp}`,
      schema: { version: 1, options: [] },
    },
  })
  expect(created.status(), 'POST option-schema should be 201').toBe(201)
  const body = (await created.json()) as { id?: string }
  expect(typeof body.id, 'option-schema creation should return an id').toBe('string')
  const updatedAt = await readUpdatedAt(request, token, OPTION_SCHEMAS_API, body.id as string)
  return { id: body.id as string, updatedAt }
}

async function deleteOptionSchema(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  const current = await readUpdatedAt(request, token, OPTION_SCHEMAS_API, id).catch(() => undefined)
  await request
    .fetch(resolveApiUrl(OPTION_SCHEMAS_API), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(current ? { [OPTIMISTIC_LOCK_HEADER_NAME]: current } : {}),
      },
      data: { id },
    })
    .catch(() => undefined)
}

test.describe('TC-LOCK-OSS-022: catalog option-schema edit/delete optimistic lock', () => {
  test('CAT-07 stale option-schema PUT is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let schemaId: string | null = null
    try {
      const schema = await createOptionSchema(page.request, token, stamp)
      schemaId = schema.id
      const staleUpdatedAt = schema.updatedAt

      // Advance updated_at out-of-band via a header-less PUT (additive path).
      const bumped = await bumpRecordViaApi(page.request, token, OPTION_SCHEMAS_API, {
        id: schemaId,
        name: `QA Lock 022 bumped ${stamp}`,
      })
      expect(bumped, 'header-less PUT should bump updated_at').not.toBe(staleUpdatedAt)

      // Replay the now-stale write with the original expected-version → 409.
      const conflict = await putWithLock(
        page.request,
        token,
        OPTION_SCHEMAS_API,
        { id: schemaId, name: `QA Lock 022 stale ${stamp}` },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      if (schemaId) await deleteOptionSchema(page.request, token, schemaId)
    }
  })

  test('CAT-07 stale option-schema DELETE is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let schemaId: string | null = null
    try {
      const schema = await createOptionSchema(page.request, token, stamp)
      schemaId = schema.id
      const staleUpdatedAt = schema.updatedAt

      const bumped = await bumpRecordViaApi(page.request, token, OPTION_SCHEMAS_API, {
        id: schemaId,
        name: `QA Lock 022 del bumped ${stamp}`,
      })
      expect(bumped, 'header-less PUT should bump updated_at').not.toBe(staleUpdatedAt)

      const conflict = await page.request.fetch(resolveApiUrl(OPTION_SCHEMAS_API), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: staleUpdatedAt,
        },
        data: { id: schemaId },
      })
      await expectConflictBody(conflict)
    } finally {
      if (schemaId) await deleteOptionSchema(page.request, token, schemaId)
    }
  })

  test('CAT-07 clean option-schema PUT with a fresh token does not 409', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let schemaId: string | null = null
    try {
      const schema = await createOptionSchema(page.request, token, stamp)
      schemaId = schema.id

      // A write carrying the current expected-version header must succeed (no
      // false-positive conflict for a single-writer save).
      const fresh = await putWithLock(
        page.request,
        token,
        OPTION_SCHEMAS_API,
        { id: schemaId, name: `QA Lock 022 fresh ${stamp}` },
        schema.updatedAt,
      )
      expect(fresh.status(), 'clean PUT with current token should not 409').toBeLessThan(400)
    } finally {
      if (schemaId) await deleteOptionSchema(page.request, token, schemaId)
    }
  })
})
