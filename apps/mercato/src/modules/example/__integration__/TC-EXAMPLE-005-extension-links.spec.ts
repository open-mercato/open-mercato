import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = {
  dependsOnModules: ['example', 'customers'],
}

const PRIORITIES_API = '/api/example/customer-priorities'
const PEOPLE_API = '/api/customers/people'

type PriorityList = { items?: Array<{ id?: string; customer_id?: string; priority?: string }> }

async function listPriorities(
  request: APIRequestContext,
  token: string,
  customerId: string,
  selectedOrgId?: string,
): Promise<PriorityList['items']> {
  const path = `${PRIORITIES_API}?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=20`
  const response = selectedOrgId
    ? await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId })
    : await apiRequest(request, 'GET', path, { token })
  expect(response.ok(), `GET customer priorities failed: ${response.status()}`).toBeTruthy()
  return ((await response.json()) as PriorityList).items ?? []
}

/**
 * Milestone B coverage for the module's cross-module extension link.
 *
 * `data/extensions.ts` links `example:example_customer_priority` to
 * `customers:customer_entity` through a plain `customer_id` column, because the platform bans
 * ORM relationships across module boundaries. The contract worth exercising end to end is what
 * that ban implies: the contributor owns and scopes its own row, it points at a host record it
 * does not join to, and it keeps working — as an empty result rather than an error — when the
 * host record it names is not there. A test that only proved the happy round trip would pass
 * just as well against an illegal foreign key.
 */
test.describe('TC-EXAMPLE-005: the customer-priority contributor round-trips against its host', () => {
  test('writes, reads and updates a priority for a real customer and stays scoped to its organization', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)

    let personId: string | null = null
    let priorityId: string | null = null
    let otherOrgId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Tc',
        lastName: `Example005${suffix}`,
        displayName: `TC-EXAMPLE-005 ${suffix}`,
      })
      expect(personId).toBeTruthy()

      // A host with no contributor row reads as an empty list, not as a 404: the contributor is
      // optional by construction.
      expect(await listPriorities(request, token, personId!)).toHaveLength(0)

      const created = await apiRequest(request, 'POST', PRIORITIES_API, {
        token,
        data: { customerId: personId, priority: 'high' },
      })
      expect(created.ok(), `create priority failed: ${created.status()}`).toBeTruthy()
      priorityId = ((await created.json()) as { id?: string }).id ?? null
      expect(priorityId).toBeTruthy()

      const listed = await listPriorities(request, token, personId!)
      expect(listed).toHaveLength(1)
      expect(listed?.[0]?.customer_id).toBe(personId)
      expect(listed?.[0]?.priority).toBe('high')

      const updated = await apiRequest(request, 'PUT', PRIORITIES_API, {
        token,
        data: { id: priorityId, customerId: personId, priority: 'critical' },
      })
      expect(updated.ok(), `update priority failed: ${updated.status()}`).toBeTruthy()
      expect((await listPriorities(request, token, personId!))?.[0]?.priority).toBe('critical')

      // Cross-scope: the row belongs to the organization that created it and must not surface
      // in a sibling organization of the same tenant.
      otherOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-005 org ${suffix}`,
        tenantId,
      })
      expect(await listPriorities(request, token, personId!, otherOrgId)).toHaveLength(0)
    } finally {
      if (priorityId) {
        await apiRequest(request, 'DELETE', PRIORITIES_API, { token, data: { id: priorityId } })
          .catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, otherOrgId)
      await deleteEntityIfExists(request, token, PEOPLE_API, personId)
    }
  })

  test('accepts a priority for an absent host and refuses an unauthenticated write', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const missingCustomerId = randomUUID()
    let priorityId: string | null = null

    try {
      // There is no join and no foreign key, so a contributor row may name a host that does not
      // exist. That is the documented consequence of the cross-module ban, and pinning it here
      // means a future change that quietly adds a foreign key is caught rather than celebrated.
      const created = await apiRequest(request, 'POST', PRIORITIES_API, {
        token,
        data: { customerId: missingCustomerId, priority: 'low' },
      })
      expect(created.ok(), `create priority for absent host failed: ${created.status()}`).toBeTruthy()
      priorityId = ((await created.json()) as { id?: string }).id ?? null
      expect(priorityId).toBeTruthy()

      const listed = await listPriorities(request, token, missingCustomerId)
      expect(listed).toHaveLength(1)
      expect(listed?.[0]?.customer_id).toBe(missingCustomerId)

      // The write side is feature-gated on the route, not only in the UI that reaches it.
      const denied = await apiRequest(request, 'POST', PRIORITIES_API, {
        token: 'not-a-real-token',
        data: { customerId: missingCustomerId, priority: 'low' },
      })
      expect(denied.ok(), 'an unauthenticated contributor write must be refused').toBeFalsy()
      expect([401, 403]).toContain(denied.status())
    } finally {
      if (priorityId) {
        await apiRequest(request, 'DELETE', PRIORITIES_API, { token, data: { id: priorityId } })
          .catch(() => undefined)
      }
    }
  })
})
