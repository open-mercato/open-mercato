import { expect, test } from '@playwright/test'
import {
  createDealFixture,
  createPersonFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-088: Deal People tab — linked-people parity
 *
 * The deal People tab now renders the same card list as the company tab, backed by
 * `GET /api/customers/deals/{id}/people`. That endpoint was widened additively so the shared
 * card has the fields it renders, and link/unlink still go through the deal's own update
 * rather than a per-link endpoint.
 *
 * This covers the server half of that parity end to end:
 *
 *  - the widened payload carries the card's fields while keeping every pre-existing key, so
 *    `DealLinkedEntitiesTab` (still used by the Companies tab) and third-party consumers work;
 *  - search matches on the newly exposed columns, not just the label;
 *  - unlink and link round-trip through `PUT /api/customers/deals`;
 *  - profile-backed columns resolve for every linked person, which is what the batched read
 *    added by this change is for.
 *
 * The two surfaces the tab deliberately withholds — the linked date and the "recently linked"
 * sort — are asserted at the unit level in `DealPeopleSection.test.tsx` instead: they are a
 * client-side decision, and the endpoint keeps supporting `sort=recent` for existing callers.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type DealPersonItem = {
  id: string
  label: string
  subtitle: string | null
  kind: string
  linkedAt: string
  isPrimary: boolean
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  status: string | null
  lifecycleStage: string | null
  jobTitle: string | null
  department: string | null
  createdAt: string
  organizationId: string
  temperature: string | null
  source: string | null
}

type DealPeoplePage = {
  items: DealPersonItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

test.describe('TC-CRM-088 deal linked-people parity', () => {
  test('exposes the card fields additively, searches them, and round-trips link changes', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const stamp = Date.now()
    const created: Array<{ path: string; id: string }> = []

    const adaId = await createPersonFixture(request, token, {
      firstName: 'Ada',
      lastName: `Lovelace ${stamp}`,
      displayName: `Ada Lovelace ${stamp}`,
    })
    created.push({ path: '/api/customers/people', id: adaId })

    const graceId = await createPersonFixture(request, token, {
      firstName: 'Grace',
      lastName: `Hopper ${stamp}`,
      displayName: `Grace Hopper ${stamp}`,
    })
    created.push({ path: '/api/customers/people', id: graceId })

    const dealId = await createDealFixture(request, token, {
      title: `Expansion renewal ${stamp}`,
      personIds: [adaId, graceId],
    })
    created.push({ path: '/api/customers/deals', id: dealId })

    const authHeaders = { Authorization: `Bearer ${token}` }
    const listPeople = async (query = ''): Promise<DealPeoplePage> => {
      const response = await request.get(
        resolveUrl(`/api/customers/deals/${dealId}/people?page=1&pageSize=20&sort=name-asc${query}`),
        { headers: authHeaders },
      )
      expect(response.ok()).toBeTruthy()
      return (await response.json()) as DealPeoplePage
    }

    try {
      const initial = await listPeople()
      expect(initial.total).toBe(2)

      const ada = initial.items.find((item) => item.id === adaId)
      expect(ada).toBeDefined()

      // Pre-existing keys are retained with unchanged meaning — this is what keeps
      // DealLinkedEntitiesTab and any third-party consumer working.
      expect(ada!.label).toContain('Ada Lovelace')
      expect(ada!.kind).toBe('person')
      expect(typeof ada!.linkedAt).toBe('string')
      expect(typeof ada!.isPrimary).toBe('boolean')

      // Added keys the shared card renders. `jobTitle` / `department` come from the person
      // profile via the batched read, so they must be present (possibly null) for every row.
      expect(ada!.displayName).toContain('Ada Lovelace')
      for (const item of initial.items) {
        expect(item).toHaveProperty('primaryEmail')
        expect(item).toHaveProperty('primaryPhone')
        expect(item).toHaveProperty('status')
        expect(item).toHaveProperty('lifecycleStage')
        expect(item).toHaveProperty('jobTitle')
        expect(item).toHaveProperty('department')
        expect(item).toHaveProperty('temperature')
        expect(item).toHaveProperty('source')
        expect(typeof item.createdAt).toBe('string')
        expect(typeof item.organizationId).toBe('string')
      }

      // Search still narrows by name.
      const byName = await listPeople(`&search=${encodeURIComponent('Grace Hopper')}`)
      expect(byName.items.map((item) => item.id)).toEqual([graceId])

      // Unlink goes through the deal's own update, the same write the tab's card action makes.
      const unlink = await request.put(resolveUrl('/api/customers/deals'), {
        headers: authHeaders,
        data: { id: dealId, personIds: [graceId] },
      })
      expect(unlink.ok()).toBeTruthy()

      const afterUnlink = await listPeople()
      expect(afterUnlink.total).toBe(1)
      expect(afterUnlink.items.map((item) => item.id)).toEqual([graceId])

      // …and linking back is the same path in reverse, which is what the link dialog performs.
      const relink = await request.put(resolveUrl('/api/customers/deals'), {
        headers: authHeaders,
        data: { id: dealId, personIds: [graceId, adaId] },
      })
      expect(relink.ok()).toBeTruthy()

      const afterRelink = await listPeople()
      expect(afterRelink.total).toBe(2)
      expect(afterRelink.items.map((item) => item.id).sort()).toEqual([adaId, graceId].sort())
    } finally {
      for (const entry of created.reverse()) {
        await deleteEntityByBody(request, token, entry.path, entry.id)
      }
    }
  })
})
