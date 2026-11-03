import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-7265: malformed `tagIds` on the people and companies list APIs are rejected with
 * a 400 instead of reaching the uuid column as a database error, while valid tag ids keep
 * filtering within the caller's tenant/organization scope (#7265).
 */
const unknownTagId = '6f1c2a4e-7b3d-4c5e-9a8f-0d1e2f3a4b5c'

async function listIds(request: APIRequestContext, token: string, path: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path}`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(response)
  return (body?.items ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string')
}

test.describe('TC-CRM-7265: customer list tagIds validation', () => {
  for (const resource of ['people', 'companies'] as const) {
    test(`rejects malformed tagIds and keeps valid filtering on /api/customers/${resource}`, async ({ request }) => {
      let token: string | null = null
      let tagId: string | null = null
      let recordId: string | null = null
      const stamp = Date.now()

      try {
        token = await getAuthToken(request)

        const tagResponse = await apiRequest(request, 'POST', '/api/customers/tags', {
          token,
          data: { slug: `qa-tc-crm-7265-${resource}-${stamp}`, label: `QA TC-CRM-7265 ${resource} ${stamp}` },
        })
        expect(tagResponse.ok()).toBeTruthy()
        tagId = expectId((await readJsonSafe<{ id?: unknown }>(tagResponse))?.id, 'Expected created tag id')

        const recordData =
          resource === 'people'
            ? { firstName: 'QA', lastName: `TC-CRM-7265 ${stamp}`, displayName: `QA TC-CRM-7265 ${stamp}`, tags: [tagId] }
            : { displayName: `QA TC-CRM-7265 Co ${stamp}`, tags: [tagId] }
        const recordResponse = await apiRequest(request, 'POST', `/api/customers/${resource}`, { token, data: recordData })
        expect(recordResponse.ok()).toBeTruthy()
        recordId = expectId((await readJsonSafe<{ id?: unknown }>(recordResponse))?.id, 'Expected created record id')

        for (const malformed of ['not-a-uuid', `${tagId},not-a-uuid`]) {
          const response = await apiRequest(
            request,
            'GET',
            `/api/customers/${resource}?tagIds=${encodeURIComponent(malformed)}`,
            { token },
          )
          expect(response.status(), `tagIds=${malformed}`).toBe(400)
          const body = await readJsonSafe<{ error?: unknown }>(response)
          expect(body?.error).toBe('Invalid input')
        }

        expect(await listIds(request, token, `/api/customers/${resource}?tagIds=${unknownTagId}`)).toEqual([])

        const tagged = await listIds(
          request,
          token,
          `/api/customers/${resource}?tagIds=${encodeURIComponent(` ${tagId} , ${unknownTagId} `)}&pageSize=100`,
        )
        expect(tagged).toEqual([recordId])
      } finally {
        await deleteEntityIfExists(request, token, `/api/customers/${resource}`, recordId)
        await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
      }
    })
  }
})
