import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deletePhoneCallsIfExist, seedPhoneCalls } from './helpers/phoneCallsFixtures'

type CallRow = { external_call_id?: string | null; organization_id?: string | null }
type ListBody = { items?: CallRow[] }

/**
 * TC-PHONE-HUB-005 — call rows never cross an organization boundary.
 *
 * Calls carry phone numbers and recordings, so an org-scope leak here is a privacy
 * incident rather than a cosmetic bug. A user homed in one organization must not read
 * another organization's calls even inside the same tenant.
 */
test.describe('TC-PHONE-HUB-005: phone calls organization scope', () => {
  test('a user homed in one org cannot read another org calls', async ({ request }) => {
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'Phone008!Pass1'
    const email = `qa-phone-hub-005-${stamp}@acme.com`

    let superToken: string | null = null
    let otherOrgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let seeded: string[] = []

    try {
      superToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superToken)

      otherOrgId = await createOrganizationFixture(request, superToken, {
        name: `qa-phone-hub-005-org-${stamp}`,
        tenantId: scope.tenantId,
      })

      seeded = await seedPhoneCalls([
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          externalCallId: `qa-phone-hub-005-home-${stamp}`,
          direction: 'inbound',
          status: 'completed',
        },
        {
          organizationId: otherOrgId,
          tenantId: scope.tenantId,
          externalCallId: `qa-phone-hub-005-foreign-${stamp}`,
          direction: 'inbound',
          status: 'completed',
        },
      ])

      roleId = await createRoleFixture(request, superToken, {
        name: `qa_phone_hub_005_${stamp}`,
        tenantId: scope.tenantId,
      })
      await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superToken,
        data: { roleId, features: ['phone_calls.view'], organizations: [scope.organizationId] },
      })
      userId = await createUserFixture(request, superToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })

      const userToken = await getAuthToken(request, email, password)
      // The run-unique `q` is what keeps this honest against the CRUD list cache
      // (integration runs set ENABLE_CRUD_API_CACHE=true). Rows seeded straight into
      // Postgres never invalidate that cache the way the ingest command does, so an
      // unfiltered query would be served a previous run's payload.
      const response = await apiRequest(
        request,
        'GET',
        `/api/phone_calls/calls?q=${encodeURIComponent(stamp)}&pageSize=100`,
        { token: userToken },
      )
      expect(response.status(), 'the scoped user may read their own org calls').toBe(200)

      const items = (await readJsonSafe<ListBody>(response))?.items ?? []
      const visible = items.map((item) => item.external_call_id)
      expect(visible, 'the home organization call is readable').toContain(`qa-phone-hub-005-home-${stamp}`)
      expect(visible, 'the foreign organization call must not leak').not.toContain(`qa-phone-hub-005-foreign-${stamp}`)
      expect(
        items.every((item) => item.organization_id === scope.organizationId),
        'every returned row belongs to the caller organization',
      ).toBe(true)
    } finally {
      await deletePhoneCallsIfExist(seeded)
      await deleteUserIfExists(request, superToken, userId)
      await deleteRoleIfExists(request, superToken, roleId)
      await deleteOrganizationIfExists(request, superToken, otherOrgId)
    }
  })
})
