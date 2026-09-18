import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CACC-INVITE-PERSON-001: invite raised from a CRM person card (#4362)
 *
 * The account-status widget on a person detail page sends `personEntityId` only.
 * The invitation must still carry the person's company, because `customerEntityId`
 * is the portal company scope key: the portal Users page, portal invitations, and
 * the company detail "Portal users" group all filter on it, and `autoLinkCrm`
 * cannot derive it later for a user that already has a person link.
 *
 * This covers what unit tests with a mocked EntityManager cannot: that the profile
 * lookup reads the real `customer_person_profiles.company_entity_id` relation and
 * that the ownership probe accepts a genuinely in-org company.
 *
 * The invitation token is deliberately not returned by the API, so the accept half
 * of the flow stays unit-tested (see TC-AUTH-032 for the same constraint).
 */
test.describe('TC-CACC-INVITE-PERSON-001: person invite resolves the company link', () => {
  test('an invite carrying only personEntityId stores the person company', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let companyId: string | null = null
    let personId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      companyId = await createCompanyFixture(request, adminToken, `QA CACC IP001 Company ${stamp}`)

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `CACCIP001${stamp}`,
        displayName: `QA CACC IP001 Person ${stamp}`,
        companyEntityId: companyId,
      })

      const rolesRes = await apiRequest(request, 'GET', '/api/customer_accounts/admin/roles?pageSize=10', {
        token: adminToken,
      })
      expect(rolesRes.ok(), 'roles list should succeed').toBeTruthy()
      const rolesBody = (await rolesRes.json()) as { items: Array<{ id: string }> }
      expect(rolesBody.items.length, 'tenant should have at least one customer role').toBeGreaterThan(0)
      const roleId = rolesBody.items[0].id

      const inviteRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token: adminToken,
        data: {
          email: `qa-cacc-ip001-${stamp}@test.local`,
          roleIds: [roleId],
          displayName: `QA CACC IP001 ${stamp}`,
          personEntityId: personId,
        },
      })
      expect(inviteRes.status(), 'person invite should return 201').toBe(201)
      const inviteBody = (await inviteRes.json()) as {
        invitation: { personEntityId: string | null; customerEntityId: string | null }
      }
      expect(inviteBody.invitation.personEntityId).toBe(personId)
      expect(
        inviteBody.invitation.customerEntityId,
        'the person company must be resolved so the accepted user gets a portal scope key',
      ).toBe(companyId)

      // The same guard from the other side: a company id passed as a person id is
      // rejected instead of being copied onto the future portal user.
      const badRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token: adminToken,
        data: {
          email: `qa-cacc-ip001-bad-${stamp}@test.local`,
          roleIds: [roleId],
          personEntityId: companyId,
        },
      })
      expect(badRes.status(), 'a company id used as personEntityId must be rejected').toBe(400)
      const badBody = (await badRes.json()) as { ok: boolean; error?: string }
      expect(badBody.ok).toBe(false)
      expect(badBody.error).toBe('Person not found')
    } finally {
      // Invitations have no delete endpoint; the CRM fixtures are removed instead.
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    }
  })
})
