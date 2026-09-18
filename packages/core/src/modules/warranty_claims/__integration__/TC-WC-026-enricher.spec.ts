import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  transitionClaim,
  uniqueLabel,
} from './helpers'

type WarrantyClaimsMetrics = {
  openCount: number
  lifetimeCount: number
  lastClaimDate: string | null
}

type PersonWithWarrantyClaims = {
  id?: string | null
  displayName?: string | null
  _warranty_claims?: WarrantyClaimsMetrics
}

type PeopleListResponse = {
  items?: PersonWithWarrantyClaims[]
  _meta?: {
    enrichedBy?: string[]
  }
}

async function listPeople(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<PeopleListResponse> {
  const query = new URLSearchParams({ search: stamp, pageSize: '100' })
  const response = await apiRequest(request, 'GET', `/api/customers/people?${query.toString()}`, { token })
  const body = await readJsonSafe<PeopleListResponse>(response)
  expect(response.status(), `GET /api/customers/people should return 200: ${JSON.stringify(body)}`).toBe(200)
  return body ?? {}
}

function findPerson(items: readonly PersonWithWarrantyClaims[] | undefined, personId: string): PersonWithWarrantyClaims {
  const person = items?.find((item) => item.id === personId)
  expect(person, `people list should include ${personId}`).toBeTruthy()
  return person as PersonWithWarrantyClaims
}

test.describe('TC-WC-026: warranty claim customer enricher', () => {
  test('adds batched claim metrics to people lists and hides them without warranty claim view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-026')
    const noWarrantyEmail = `${stamp}@test.invalid`
    const noWarrantyPassword = 'Valid1!Pass'

    let personAId: string | null = null
    let personBId: string | null = null
    let openClaimAId: string | null = null
    let terminalClaimAId: string | null = null
    let openClaimBId: string | null = null
    let noWarrantyRoleId: string | null = null
    let noWarrantyUserId: string | null = null

    try {
      personAId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Alpha ${stamp}`,
        displayName: `QA WC Enricher Alpha ${stamp}`,
      })
      personBId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Beta ${stamp}`,
        displayName: `QA WC Enricher Beta ${stamp}`,
      })

      const openClaimA = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId: personAId,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      openClaimAId = openClaimA.id

      const terminalClaimA = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerId: personAId,
        reasonCode: 'damaged',
        currencyCode: 'USD',
      })
      terminalClaimAId = terminalClaimA.id
      const cancelResponse = await transitionClaim(
        request,
        adminToken,
        { id: terminalClaimA.id!, toStatus: 'cancelled' },
        terminalClaimA.updatedAt,
      )
      expect(cancelResponse.status(), 'draft claim should transition to cancelled for terminal metrics').toBe(200)

      const openClaimB = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId: personBId,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      openClaimBId = openClaimB.id

      const enriched = await listPeople(request, adminToken, stamp)
      expect(enriched._meta?.enrichedBy).toContain('warranty_claims.customer-claim-metrics-person')
      const personA = findPerson(enriched.items, personAId)
      const personB = findPerson(enriched.items, personBId)
      expect(personA._warranty_claims).toMatchObject({
        openCount: 1,
        lifetimeCount: 2,
      })
      expect(personA._warranty_claims?.lastClaimDate).toBeTruthy()
      expect(personB._warranty_claims).toMatchObject({
        openCount: 1,
        lifetimeCount: 1,
      })
      expect(personB._warranty_claims?.lastClaimDate).toBeTruthy()

      noWarrantyRoleId = await createRoleFixture(request, adminToken, { name: `QA WC Enricher No Warranty ${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId: noWarrantyRoleId,
        features: ['customers.people.view'],
        organizations: [organizationId],
      })
      noWarrantyUserId = await createUserFixture(request, adminToken, {
        email: noWarrantyEmail,
        password: noWarrantyPassword,
        organizationId,
        roles: [noWarrantyRoleId],
        name: `QA WC Enricher No Warranty ${stamp}`,
      })
      const noWarrantyToken = await getAuthToken(request, noWarrantyEmail, noWarrantyPassword)
      const gated = await listPeople(request, noWarrantyToken, stamp)
      const gatedPersonA = findPerson(gated.items, personAId)
      expect(gatedPersonA._warranty_claims).toBeUndefined()
      expect(gated._meta?.enrichedBy ?? []).not.toContain('warranty_claims.customer-claim-metrics-person')
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, openClaimBId)
      await cleanupDraftClaimWithLines(request, adminToken, terminalClaimAId)
      await cleanupDraftClaimWithLines(request, adminToken, openClaimAId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personBId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personAId)
      await deleteUserIfExists(request, adminToken, noWarrantyUserId)
      await deleteRoleIfExists(request, adminToken, noWarrantyRoleId)
    }
  })
})
