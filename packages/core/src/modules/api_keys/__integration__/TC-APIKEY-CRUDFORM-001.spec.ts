import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'

/**
 * TC-APIKEY-CRUDFORM-001: API key CrudForm persists scalars + roles array (#2466, #2568).
 *
 * The api_keys create form (`backend/api-keys/create/page.tsx`) submits scalars (name,
 * description, expiresAt), an organization reference, and a `roles` tags field. This spec
 * proves every value round-trips: create → read-back → assert ALL fields.
 *
 * Deviations from the generic sweep template, verified against the live route
 * (`api/keys/route.ts`) and entity (`data/entities.ts`):
 * - **No update step.** The route exports only GET/POST/DELETE — API keys are create-once
 *   (the secret is shown once, then immutable) and there is no edit page. `updateApiKeySchema`
 *   is declared but intentionally not wired, so `runCrudFormRoundTrip` (which mandates a PUT)
 *   does not fit; this spec covers the supported create → persist → delete cycle inline,
 *   reusing the shared `assertScalarFieldsPersisted` + sweep gate.
 * - **No `?id=`/`?ids=` list filter.** The list hand-builds its query and only supports
 *   `?search=` (ILIKE on name/keyPrefix), so read-back searches by the unique name and matches
 *   on id.
 * - **camelCase responses.** The list hook returns `description`/`organizationId`/`expiresAt`/
 *   `roles` in camelCase (not the snake_case the makeCrud default emits).
 * - **No custom fields.** api_keys has no `ce.ts`, so there is nothing to assert via `cf_*`.
 *
 * Self-contained: the only fixture is a bare role (no ACL) created in the caller's tenant — such
 * a role is grantable by any actor holding `api_keys.create` (`assertActorCanGrantRoles` returns
 * early on a role without a RoleAcl). The role and key are deleted in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const API_KEYS_PATH = '/api/api_keys/keys'

async function readApiKeyByName(
  request: APIRequestContext,
  token: string,
  name: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${API_KEYS_PATH}?search=${encodeURIComponent(name)}&page=1&pageSize=200`,
    { token },
  )
  expect(response.status(), `read-back api_keys failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response)
  return (body?.items ?? []).find((item) => item.id === id) ?? null
}

test.describe('TC-APIKEY-CRUDFORM-001: API key CrudForm persists scalars + roles array', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips name/description/expiresAt/organization + roles[] on create', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const { organizationId, tenantId } = getTokenContext(token)
    const keyName = `QA CRUDFORM API Key ${stamp}`
    const description = 'Original CRUDFORM api key description'
    const expiresAt = new Date(stamp + 30 * 24 * 60 * 60 * 1000).toISOString()

    let roleId: string | null = null
    let keyId: string | null = null

    try {
      // Bare role in the caller's tenant — grantable without extra ACL setup.
      roleId = await createRoleFixture(request, token, {
        name: `QA CRUDFORM API Key Role ${stamp}`,
        tenantId: tenantId || undefined,
      })

      const createPayload: CrudRecord = {
        name: keyName,
        description,
        roles: [roleId],
        expiresAt,
      }
      // organizationId is the caller's own (in-scope) org; only submit when present so the
      // uuid validator never receives an empty string.
      if (organizationId) createPayload.organizationId = organizationId

      const createResponse = await apiRequest(request, 'POST', API_KEYS_PATH, {
        token,
        data: createPayload,
      })
      expect(createResponse.status(), `create api key failed (${createResponse.status()})`).toBe(201)
      const created = (await readJsonSafe<CrudRecord>(createResponse)) ?? {}
      keyId = expectId(created.id, 'create response should include an id')
      // The full secret is returned exactly once on create.
      expect(
        typeof created.secret === 'string' && (created.secret as string).length > 0,
        'create response should return the one-time secret',
      ).toBe(true)

      const persisted = await readApiKeyByName(request, token, keyName, keyId)
      expect(persisted, `created key ${keyId} should be readable from the list`).toBeTruthy()
      const record = persisted as CrudRecord

      // Scalars round-trip (list response is camelCase).
      const expectedScalars: CrudRecord = { name: keyName, description }
      if (organizationId) expectedScalars.organizationId = organizationId
      assertScalarFieldsPersisted(record, expectedScalars, 'after-create')

      // Date scalar: compare by instant to avoid ISO formatting drift.
      expect(record.expiresAt, 'expiresAt should persist').toBeTruthy()
      expect(new Date(String(record.expiresAt)).getTime()).toBe(new Date(expiresAt).getTime())

      // Array/multiselect: the assigned role round-trips.
      const persistedRoles = Array.isArray(record.roles)
        ? (record.roles as Array<{ id?: string }>)
        : []
      expect(persistedRoles.map((role) => role.id)).toEqual([roleId])
    } finally {
      if (keyId) {
        await apiRequest(request, 'DELETE', `${API_KEYS_PATH}?id=${encodeURIComponent(keyId)}`, {
          token,
        }).catch(() => undefined)
      }
      await deleteRoleIfExists(request, token, roleId)
    }
  })
})
