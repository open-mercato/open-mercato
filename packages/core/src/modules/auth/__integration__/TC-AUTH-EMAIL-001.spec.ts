import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  getTokenScope,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

test.describe('TC-AUTH-EMAIL-001: Auth transactional email uses system channel', () => {
  test('password reset, invite create, and resend invite dispatch through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const passwordUserEmail = `qa-auth-email-reset-${stamp}@example.com`
    const invitedUserEmail = `qa-auth-email-invite-${stamp}@example.com`
    let passwordUserId: string | null = null
    let invitedUserId: string | null = null

    try {
      const passwordUserResponse = await apiRequest(request, 'POST', '/api/auth/users', {
        token,
        data: {
          email: passwordUserEmail,
          password: 'Valid1!Pass',
          organizationId: scope.organizationId,
          roles: ['employee'],
        },
      })
      expect(passwordUserResponse.status()).toBe(201)
      passwordUserId = expectId((await readJsonSafe<{ id?: string }>(passwordUserResponse))?.id, 'password user id')

      await clearCapturedSystemEmails(request, token)
      const resetBody = new URLSearchParams()
      resetBody.set('email', passwordUserEmail)
      const resetResponse = await request.post('/api/auth/reset', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: resetBody.toString(),
      })
      expect(resetResponse.status()).toBe(200)
      const resetEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === passwordUserEmail && String(email.metadata?.subject ?? '').includes('Password reset requested'),
        { description: 'password reset email' },
      )
      expect(String(resetEmail.metadata?.from ?? '')).toContain('@')
      expect(resetEmail.scope.tenantId).toBe(scope.tenantId)
      expect(resetEmail.scope.organizationId).toBe(scope.organizationId)
      expect(resetEmail.content.bodyFormat).toBe('html')

      await clearCapturedSystemEmails(request, token)
      const inviteCreateResponse = await apiRequest(request, 'POST', '/api/auth/users', {
        token,
        data: {
          email: invitedUserEmail,
          organizationId: scope.organizationId,
          roles: [],
          sendInviteEmail: true,
        },
      })
      const inviteCreateBody = await readJsonSafe<{ id?: string; _warning?: string }>(inviteCreateResponse)
      expect(
        inviteCreateResponse.status(),
        `invite create response: ${JSON.stringify(inviteCreateBody)}`,
      ).toBe(201)
      expect(inviteCreateBody?._warning).toBeUndefined()
      invitedUserId = expectId(inviteCreateBody?.id, 'invited user id')
      await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === invitedUserEmail && email.metadata?.subject === 'You have been invited',
        { description: 'initial invite email' },
      )

      await clearCapturedSystemEmails(request, token)
      const resendResponse = await apiRequest(request, 'POST', '/api/auth/users/resend-invite', {
        token,
        data: { id: invitedUserId },
      })
      const resendBody = await readJsonSafe<{ ok?: boolean; warning?: string }>(resendResponse)
      expect(resendResponse.status(), `resend response: ${JSON.stringify(resendBody)}`).toBe(200)
      expect(resendBody?.warning).toBeUndefined()
      const resendEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === invitedUserEmail && email.metadata?.subject === 'You have been invited',
        { description: 'resend invite email' },
      )
      expect(resendEmail.scope.tenantId).toBe(scope.tenantId)
      expect(resendEmail.scope.organizationId).toBe(scope.organizationId)
    } finally {
      await deleteUserIfExists(request, token, invitedUserId)
      await deleteUserIfExists(request, token, passwordUserId)
    }
  })
})
