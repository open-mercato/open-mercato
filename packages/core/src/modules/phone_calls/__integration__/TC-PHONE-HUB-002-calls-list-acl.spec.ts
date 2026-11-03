import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deletePhoneCallsIfExist, seedPhoneCalls } from './helpers/phoneCallsFixtures'

type CallRow = Record<string, unknown>
type ListBody = { items?: CallRow[] }

/**
 * TC-PHONE-HUB-002 — `phone_calls.view` gates the call list.
 *
 * ACL is declared at module level (`phone_calls.view` reads, `phone_calls.manage` pulls),
 * and the route declares `requireFeatures: ['phone_calls.view']`. This asserts the guard
 * actually fires instead of trusting the declaration.
 *
 * Two principals hit the same route rather than one principal being re-graded mid-test:
 * granted features are memoized server-side, so a grant is not guaranteed to be visible to
 * the next request and asserting on it would make the test time-dependent. Contrasting a
 * restricted user against an admin proves the 403 comes from the feature gate and not from
 * a missing route or a broken token.
 */
test.describe('TC-PHONE-HUB-002: phone calls list ACL', () => {
  test('a role without phone_calls.view is denied while an admin is served', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Phone002!Pass1'
    const email = `qa-phone-hub-002-noview-${stamp}@acme.com`
    const roleName = `qa_phone_hub_002_noview_${stamp}`

    let superToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      superToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superToken)

      roleId = await createRoleFixture(request, superToken, { name: roleName, tenantId: scope.tenantId })
      // An unrelated feature keeps the user a valid, authenticated principal, so a
      // rejection can only come from the phone_calls gate.
      await setRoleAclFeatures(request, superToken, {
        roleId,
        features: ['dictionaries.manage'],
        organizations: null,
      })
      userId = await createUserFixture(request, superToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })

      const restrictedToken = await getAuthToken(request, email, password)
      const denied = await apiRequest(request, 'GET', '/api/phone_calls/calls', { token: restrictedToken })
      expect(denied.status(), 'a user without phone_calls.view must not read the list').toBe(403)

      const adminToken = await getAuthToken(request, 'admin')
      const allowed = await apiRequest(request, 'GET', '/api/phone_calls/calls', { token: adminToken })
      expect(allowed.status(), 'an admin holding phone_calls.* reads the same route').toBe(200)
    } finally {
      await deleteUserIfExists(request, superToken, userId)
      await deleteRoleIfExists(request, superToken, roleId)
    }
  })

  test('a view-only role is served the list without recording links', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Phone002!Pass2'
    const email = `qa-phone-hub-002-viewonly-${stamp}@acme.com`
    const roleName = `qa_phone_hub_002_viewonly_${stamp}`
    const externalCallId = `qa-phone-hub-002-${stamp}`

    let superToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let seeded: string[] = []

    try {
      superToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superToken)

      seeded = await seedPhoneCalls([
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          externalCallId,
          direction: 'inbound',
          status: 'completed',
          recordingUrl: 'https://recordings.example.com/qa.wav?token=must-not-leak',
        },
      ])

      roleId = await createRoleFixture(request, superToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, superToken, {
        roleId,
        features: ['phone_calls.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })

      const viewOnlyToken = await getAuthToken(request, email, password)
      const response = await apiRequest(
        request,
        'GET',
        `/api/phone_calls/calls?q=${encodeURIComponent(externalCallId)}`,
        { token: viewOnlyToken },
      )
      expect(response.status(), 'phone_calls.view alone reads the list').toBe(200)

      const body = await readJsonSafe<ListBody>(response)
      const row = body?.items?.find((item) => item.external_call_id === externalCallId)
      expect(row, 'the seeded call should be listed').toBeTruthy()
      // Recording links are bearer URLs, so a view-only principal must never receive one,
      // while the key itself stays in the response shape.
      expect(row).toHaveProperty('recording_url')
      expect(row!.recording_url).toBeNull()
      expect(JSON.stringify(body)).not.toContain('must-not-leak')
    } finally {
      await deletePhoneCallsIfExist(seeded)
      await deleteUserIfExists(request, superToken, userId)
      await deleteRoleIfExists(request, superToken, roleId)
    }
  })
})
