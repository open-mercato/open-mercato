import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCustomerRoleFixture, deleteCustomerRoleFixture, deleteCustomerUserFixture } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

type CapturedEmail = {
  to?: string
  subject?: string
  links?: string[]
  text?: string
}

const EMAIL_CAPTURE_PATH = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')

async function readCapturedEmails(): Promise<CapturedEmail[]> {
  try {
    const raw = await readFile(EMAIL_CAPTURE_PATH, 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CapturedEmail)
  } catch {
    return []
  }
}

/**
 * Invite links come from `urlForCustomerOrg`: `<base>/<orgSlug>/portal/invite?token=` by
 * default, but `https://<hostname>/invite?token=` once the organization has an active custom
 * domain. Match the path suffix so the spec does not depend on the org's domain state.
 */
function isInviteLink(link: string): boolean {
  try {
    const url = new URL(link)
    return url.pathname.endsWith('/invite') && url.searchParams.has('token')
  } catch {
    return false
  }
}

async function waitForInviteEmail(to: string): Promise<CapturedEmail> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const email = (await readCapturedEmails())
      .reverse()
      .find((entry) => entry.to?.toLowerCase() === to.toLowerCase() && entry.links?.some(isInviteLink))
    if (email) return email
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for captured invitation email to ${to}`)
}

function extractInviteToken(email: CapturedEmail): string {
  const inviteLink = email.links?.find(isInviteLink)
  expect(inviteLink, 'captured invite email should contain a portal invite link').toBeTruthy()
  const url = new URL(inviteLink!)
  const token = url.searchParams.get('token')
  expect(token, 'captured invite link should include token').toBeTruthy()
  return token!
}

/**
 * TC-AUTH-033: Customer invitation email happy path
 *
 * Covers the end-to-end invite flow that requires the raw one-time token:
 * admin invite -> captured customer invitation email -> token extracted from
 * /portal/invite link -> invitation accepted through the public API.
 */
test.describe('TC-AUTH-033: customer invitation email happy path', () => {
  test('admin invite sends a portal invite email whose token can be accepted', async ({ request }) => {
    const stamp = Date.now()
    const inviteEmail = `qa-auth-033-${stamp}@test.local`
    const displayName = `QA Auth 033 ${stamp}`
    const acceptedDisplayName = `QA Accepted ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')

    let roleId: string | null = null
    let invitationId: string | null = null
    let userId: string | null = null

    try {
      roleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })).id

      const inviteRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token: adminToken,
        data: {
          email: inviteEmail,
          roleIds: [roleId],
          displayName,
        },
      })
      expect(inviteRes.status(), 'admin invite should return 201').toBe(201)
      const inviteBody = (await inviteRes.json()) as {
        ok: boolean
        invitation: { id: string; email: string; expiresAt: string }
      }
      invitationId = inviteBody.invitation.id
      expect(inviteBody.ok).toBe(true)
      expect(JSON.stringify(inviteBody), 'raw token must not be exposed by invite API').not.toContain('/invite?token=')

      const capturedEmail = await waitForInviteEmail(inviteEmail)
      expect(capturedEmail.subject).toContain('invited')
      const token = extractInviteToken(capturedEmail)

      const acceptRes = await request.post('/api/customer_accounts/invitations/accept', {
        data: {
          token,
          password: `Password${stamp}!`,
          displayName: acceptedDisplayName,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(acceptRes.status(), 'invite token from captured email should be accepted').toBe(201)
      const acceptBody = (await acceptRes.json()) as {
        ok: boolean
        user: { id: string; email: string; displayName: string; emailVerified: boolean }
      }
      userId = acceptBody.user.id
      expect(acceptBody.ok).toBe(true)
      expect(acceptBody.user.email.toLowerCase()).toBe(inviteEmail.toLowerCase())
      expect(acceptBody.user.displayName).toBe(acceptedDisplayName)
      expect(acceptBody.user.emailVerified).toBe(true)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      if (invitationId) await withClient(async (client) => {
        await client.query('delete from customer_user_invitations where id = $1', [invitationId])
      })
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
