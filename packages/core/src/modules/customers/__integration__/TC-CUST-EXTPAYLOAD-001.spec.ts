import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CUST-EXTPAYLOAD-001: the injected-CrudForm extension payload survives a real
 * `makeCrudRoute` write without reaching the entity (#5373).
 *
 * `CrudForm` ships injected field values to CRUD `POST`/`PUT` under the private
 * `__om_ext_v1` transport field, and `makeCrudRoute` extracts it before any schema
 * parse so it can surface as `InterceptorContext.extensionPayload`. The unit suites
 * pin that plumbing against a synthetic route; this spec pins the same contract
 * against a live one — `customers/people`, the route the widget-injection docs use —
 * where a regression would show up as a 400/422 from the entity schema, a 500 from a
 * poisoned payload object, or the transport field leaking into the stored record.
 *
 * Self-contained: creates its own person and soft-deletes it in `finally`.
 */
const PEOPLE_PATH = '/api/customers/people'
const TRANSPORT_KEY = '__om_ext_v1'

async function readPersonById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${PEOPLE_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  )
  expect(response.status(), `read-back person failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: Record<string, unknown>[] }>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

test.describe('TC-CUST-EXTPAYLOAD-001 injected CrudForm extension payload', () => {
  test('a CRUD write carrying the transport field succeeds and never persists it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', PEOPLE_PATH, {
        token,
        data: {
          firstName: 'ExtPayload',
          lastName: `Person${stamp}`,
          displayName: `ExtPayload Person ${stamp}`,
          [TRANSPORT_KEY]: { relations: { relatedPersonId: `person-${stamp}`, relationType: 'father' } },
        },
      })
      const createdBody = await readJsonSafe<Record<string, unknown>>(created)
      expect(
        created.status(),
        `POST with the transport field must not be rejected by the entity schema (body: ${JSON.stringify(createdBody)})`,
      ).toBe(201)
      personId = expectId(
        (createdBody?.id ?? createdBody?.entityId ?? createdBody?.personId) as unknown,
        'POST response carries no person id',
      )

      const stored = await readPersonById(request, token, personId)
      expect(stored, 'created person is not readable').not.toBeNull()
      expect(stored).not.toHaveProperty(TRANSPORT_KEY)
      expect(stored).toMatchObject({ display_name: `ExtPayload Person ${stamp}` })

      const updated = await apiRequest(request, 'PUT', PEOPLE_PATH, {
        token,
        data: {
          id: personId,
          displayName: `ExtPayload Person ${stamp} updated`,
          [TRANSPORT_KEY]: { relations: { relationType: 'mother' } },
        },
      })
      const updatedBody = await readJsonSafe<Record<string, unknown>>(updated)
      expect(
        updated.status(),
        `PUT with the transport field must not be rejected by the entity schema (body: ${JSON.stringify(updatedBody)})`,
      ).toBe(200)

      const reread = await readPersonById(request, token, personId)
      expect(reread).not.toHaveProperty(TRANSPORT_KEY)
      expect(reread).toMatchObject({ display_name: `ExtPayload Person ${stamp} updated` })
    } finally {
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
    }
  })

  test('a prototype-poisoned transport field is sanitized instead of breaking the request', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', PEOPLE_PATH, {
        token,
        // Written as raw JSON on purpose: an object literal's `__proto__` sets the
        // prototype instead of creating the own property an attacker actually sends.
        data: JSON.parse(`{
          "firstName": "ExtPayloadProto",
          "lastName": "Person${stamp}",
          "displayName": "ExtPayloadProto Person ${stamp}",
          "${TRANSPORT_KEY}": {
            "__proto__": { "hasOwnProperty": 1, "toString": 2 },
            "relations": { "__proto__": { "toString": 3 }, "relatedPersonId": "person-${stamp}" }
          }
        }`),
      })
      const createdBody = await readJsonSafe<Record<string, unknown>>(created)
      expect(
        created.status(),
        `a hostile transport field must not reach an interceptor as a re-parented object (body: ${JSON.stringify(createdBody)})`,
      ).toBe(201)
      personId = expectId(
        (createdBody?.id ?? createdBody?.entityId ?? createdBody?.personId) as unknown,
        'POST response carries no person id',
      )
    } finally {
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
    }
  })
})
