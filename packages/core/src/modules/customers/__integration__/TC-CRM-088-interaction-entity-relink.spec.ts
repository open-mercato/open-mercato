import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-088 (#6050 follow-up, #6383): HTTP-level coverage for re-linking an
 * interaction's `entityId` via `PUT /api/customers/interactions`.
 *
 * Command-layer coverage already exists in
 * `commands/__tests__/interactions.relink.test.ts`; this exercises the real
 * route end-to-end: re-link, re-read, and confirm the next-interaction
 * projection moved from the original entity to the target entity.
 */

const INTERACTIONS = '/api/customers/interactions'
const PEOPLE = '/api/customers/people'

type PersonDetail = {
  person?: { nextInteractionRefId?: string | null }
}

async function readPersonNextInteractionRefId(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  personId: string,
): Promise<string | null> {
  const res = await apiRequest(request, 'GET', `${PEOPLE}/${personId}`, { token })
  expect(res.ok(), `GET ${PEOPLE}/${personId} status ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe<PersonDetail>(res))
  return body?.person?.nextInteractionRefId ?? null
}

test.describe('TC-CRM-088 interaction entity re-link (HTTP)', () => {
  test('re-linking an interaction moves the next-interaction projection between entities', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personAId: string | null = null
    let personBId: string | null = null
    let interactionId: string | null = null

    try {
      personAId = await createPersonFixture(request, token, {
        firstName: 'Relink',
        lastName: `PersonA ${stamp}`,
        displayName: `Relink PersonA ${stamp}`,
      })
      personBId = await createPersonFixture(request, token, {
        firstName: 'Relink',
        lastName: `PersonB ${stamp}`,
        displayName: `Relink PersonB ${stamp}`,
      })

      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const createRes = await apiRequest(request, 'POST', INTERACTIONS, {
        token,
        data: {
          entityId: personAId,
          interactionType: 'task',
          title: `Relink me ${stamp}`,
          status: 'planned',
          scheduledAt,
        },
      })
      expect(createRes.status(), `interaction create status ${createRes.status()}`).toBe(201)
      const created = (await readJsonSafe<{ id?: string }>(createRes))
      interactionId = created?.id ?? null
      expect(interactionId, 'created interaction id').toBeTruthy()

      expect(await readPersonNextInteractionRefId(request, token, personAId), 'A starts as the next-interaction owner')
        .toBe(interactionId)
      expect(await readPersonNextInteractionRefId(request, token, personBId), 'B starts with no next interaction')
        .toBeNull()

      const relinkRes = await apiRequest(request, 'PUT', INTERACTIONS, {
        token,
        data: { id: interactionId, entityId: personBId },
      })
      expect(relinkRes.ok(), `re-link status ${relinkRes.status()}`).toBeTruthy()

      const readRes = await apiRequest(request, 'GET', `${INTERACTIONS}?entityId=${encodeURIComponent(personBId)}&limit=100`, { token })
      const readBody = (await readJsonSafe<{ items?: Array<{ id: string; entityId: string }> }>(readRes))
      const relinked = readBody?.items?.find((item) => item.id === interactionId)
      expect(relinked, 're-linked interaction visible under person B').toBeTruthy()
      expect(relinked?.entityId, 'entityId moved to person B').toBe(personBId)

      expect(await readPersonNextInteractionRefId(request, token, personAId), 'A\'s projection cleared after re-link')
        .toBeNull()
      expect(await readPersonNextInteractionRefId(request, token, personBId), 'B\'s projection now owns the moved interaction')
        .toBe(interactionId)
    } finally {
      await deleteEntityIfExists(request, token, INTERACTIONS, interactionId)
      await deleteEntityIfExists(request, token, PEOPLE, personAId)
      await deleteEntityIfExists(request, token, PEOPLE, personBId)
    }
  })
})
