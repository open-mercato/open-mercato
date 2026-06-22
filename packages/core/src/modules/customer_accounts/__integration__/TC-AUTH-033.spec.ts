import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

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

async function waitForInviteEmail(to: string): Promise<CapturedEmail> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const email = (await readCapturedEmails())
      .reverse()
      .find((entry) => entry.to?.toLowerCase() === to.toLowerCase() && entry.links?.some((link) => link.includes('/portal/invite?token=')))
    if (email) return email
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for captured invitation email to ${to}`)
}

function extractInviteToken(email: CapturedEmail): string {
  const inviteLink = email.links?.find((link) => link.includes('/portal/invite?token='))
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
        displayName,
      },
    })
    expect(inviteRes.status(), 'admin invite should return 201').toBe(201)
    const inviteBody = (await inviteRes.json()) as {
      ok: boolean
      invitation: { id: string; email: string; expiresAt: string }
    }
    expect(inviteBody.ok).toBe(true)
    expect(JSON.stringify(inviteBody), 'raw token must not be exposed by invite API').not.toContain('/portal/invite?token=')

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
      user: { email: string; displayName: string; emailVerified: boolean }
    }
    expect(acceptBody.ok).toBe(true)
    expect(acceptBody.user.email.toLowerCase()).toBe(inviteEmail.toLowerCase())
    expect(acceptBody.user.displayName).toBe(acceptedDisplayName)
    expect(acceptBody.user.emailVerified).toBe(true)
  })
})
