import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-AUTH-032: Customer invitation creation contract + bad-token rejection
 *
 * Covers two halves of the invitation flow that don't require a raw token:
 *   - The admin endpoint creates an invitation and returns the {id,email,expiresAt}
 *     contract documented in OpenAPI. Token is intentionally not returned.
 *   - The user-facing accept endpoint rejects an invalid token with 400.
 *
 * The full happy-path (invitation accept → session) cannot be exercised
 * without a way to recover the raw token; CustomerInvitationService.acceptInvitation
 * is unit-tested directly.
 */
test.describe('TC-AUTH-032: invitation creation contract', () => {
  test('admin invite creates an invitation; accept with a fake token returns 400', async ({ request }) => {
    const stamp = Date.now()
    const inviteEmail = `qa-auth-032-${stamp}@test.local`

    let adminToken: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      // Look up an assignable customer role to satisfy the inviteUserSchema's
      // roleIds requirement. setup.ts seeds a 'buyer' (or similar) role per tenant.
      const rolesRes = await apiRequest(request, 'GET', '/api/customer_accounts/admin/roles?pageSize=10', {
        token: adminToken,
      })
      expect(rolesRes.ok(), 'roles list should succeed').toBeTruthy()
      const rolesBody = (await rolesRes.json()) as { items: Array<{ id: string; slug: string }> }
      expect(rolesBody.items.length, 'tenant should have at least one customer role').toBeGreaterThan(0)
      const roleId = rolesBody.items[0].id

      const inviteRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token: adminToken,
        data: {
          email: inviteEmail,
          roleIds: [roleId],
          displayName: `QA Auth 032 ${stamp}`,
        },
      })
      expect(inviteRes.status(), 'admin invite should return 201').toBe(201)
      const inviteBody = (await inviteRes.json()) as {
        ok: boolean
        invitation: { id: string; email: string; expiresAt: string }
      }
      expect(inviteBody.ok).toBe(true)
      expect(inviteBody.invitation).toBeTruthy()
      expect(inviteBody.invitation.email.toLowerCase()).toBe(inviteEmail.toLowerCase())
      expect(typeof inviteBody.invitation.id).toBe('string')
      expect(new Date(inviteBody.invitation.expiresAt).getTime()).toBeGreaterThan(Date.now())

      // Bad-token path on the accept endpoint: 400 Invalid or expired invitation.
      const fakeAcceptRes = await request.post('/api/customer_accounts/invitations/accept', {
        data: {
          token: '00000000000000000000000000000000', // 32 chars but not a real token
          password: `Password${stamp}!`,
          displayName: 'Should Not Create',
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(fakeAcceptRes.status(), 'accept must reject an unknown token with 400').toBe(400)
      const fakeBody = (await fakeAcceptRes.json()) as { ok: boolean; error?: string }
      expect(fakeBody.ok).toBe(false)
    } finally {
      // Best-effort cleanup: nothing to delete (the user wasn't created — only the invitation
      // record exists, and there's no public endpoint to delete invitations from tests).
    }
  })
})
