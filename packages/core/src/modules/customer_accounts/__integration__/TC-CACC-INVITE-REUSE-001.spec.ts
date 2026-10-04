import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * TC-CACC-INVITE-REUSE-001: re-inviting the email of a soft-deleted portal user (#5532)
 *
 * The bug was in the database, not the handler: `customer_users` carried a full
 * `UNIQUE (tenant_id, email_hash)` covering soft-deleted rows, so accepting a
 * re-invitation for a deleted user's address failed the constraint on insert and
 * surfaced as a raw 500. The fix narrows it to a partial unique index
 * (`WHERE deleted_at IS NULL`) plus a conflict guard in the service.
 *
 * Unit tests with a mocked EntityManager cannot observe any of that — they assert
 * the where clause the service passes, not whether Postgres accepts the insert. A
 * typo in the index expression, a migration that does not apply, or a predicate
 * Postgres cannot use for uniqueness would all ship green. This spec exercises the
 * real schema end to end.
 *
 * `POST /admin/users-invite` deliberately never returns the raw token (see
 * TC-AUTH-032), so the raw token is read out of the captured invitation email,
 * exactly as TC-AUTH-033 does.
 */

type CapturedEmail = { to?: string; links?: string[] }

const EMAIL_CAPTURE_PATH = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim()
  || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')

async function readCapturedEmails(): Promise<CapturedEmail[]> {
  try {
    const raw = await readFile(EMAIL_CAPTURE_PATH, 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as CapturedEmail)
  } catch {
    return []
  }
}

/** Wait for the invitation email this test just triggered and return its raw token. */
async function waitForInviteToken(to: string, alreadySeen: Set<string>): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const tokens = (await readCapturedEmails())
      .filter((entry) => entry.to?.toLowerCase() === to.toLowerCase())
      .flatMap((entry) => entry.links ?? [])
      .filter((link) => link.includes('/portal/invite?token='))
      .map((link) => new URL(link).searchParams.get('token'))
      .filter((token): token is string => !!token && !alreadySeen.has(token))
    if (tokens.length > 0) {
      const token = tokens[tokens.length - 1]
      alreadySeen.add(token)
      return token
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`[internal] timed out waiting for a captured invitation email to ${to}`)
}

async function readDeletedAt(userId: string): Promise<Date | null | undefined> {
  return withClient(async (client) => {
    const result = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from customer_users where id = $1',
      [userId],
    )
    return result.rows[0]?.deleted_at
  })
}

async function deleteInvitationRows(invitationIds: string[]): Promise<void> {
  const ids = invitationIds.filter(Boolean)
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from customer_user_invitations where id = any($1::uuid[])', [ids])
  })
}

test.describe('TC-CACC-INVITE-REUSE-001: a soft-deleted portal user does not block re-invitation', () => {
  test('accepting a re-invitation succeeds, and a second one for the now-active account returns 409', async ({ request }) => {
    const stamp = Date.now()
    const email = `qa-cacc-reuse-001-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let deletedUserId: string | null = null
    let acceptedUserId: string | null = null
    const invitationIds: string[] = []
    const seenTokens = new Set<string>()

    try {
      adminToken = await getAuthToken(request, 'admin')

      const rolesRes = await apiRequest(request, 'GET', '/api/customer_accounts/admin/roles?pageSize=10', {
        token: adminToken,
      })
      expect(rolesRes.ok(), 'roles list should succeed').toBeTruthy()
      const rolesBody = (await rolesRes.json()) as { items: Array<{ id: string }> }
      expect(rolesBody.items.length, 'tenant should have at least one customer role').toBeGreaterThan(0)
      const roleId = rolesBody.items[0].id

      // 1. An active portal user owns the address, then is deleted. The delete is
      //    soft, so its row keeps occupying (tenant_id, email_hash) — the precondition
      //    the old full unique constraint turned into a 500 on the next accept.
      const firstUser = await createCustomerUserFixture(request, adminToken, {
        email,
        password,
        displayName: `QA CACC Reuse 001 ${stamp}`,
        roleIds: [roleId],
      })
      deletedUserId = firstUser.id

      const deleteRes = await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${firstUser.id}`, {
        token: adminToken,
      })
      expect(deleteRes.status(), 'admin delete should succeed').toBe(200)
      expect(
        await readDeletedAt(firstUser.id),
        'the delete must be soft — a hard delete would not reproduce the bug',
      ).not.toBeNull()

      // 2. Re-invite the same address and accept it. Before the partial index this
      //    insert violated customer_users_tenant_email_hash_uniq and returned 500.
      const inviteRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token: adminToken,
        data: { email, roleIds: [roleId], displayName: `QA CACC Reuse 001 ${stamp}` },
      })
      expect(inviteRes.status(), 're-inviting a soft-deleted user should return 201').toBe(201)
      const inviteBody = (await inviteRes.json()) as { invitation: { id: string } }
      invitationIds.push(inviteBody.invitation.id)

      const rawToken = await waitForInviteToken(email, seenTokens)

      const acceptRes = await request.post('/api/customer_accounts/invitations/accept', {
        data: { token: rawToken, password, displayName: `QA CACC Reuse 001 Accepted ${stamp}` },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(
        acceptRes.status(),
        'accepting the re-invitation must succeed against the real schema (#5532)',
      ).toBe(201)
      const acceptBody = (await acceptRes.json()) as { ok: boolean; user: { id: string; email: string } }
      expect(acceptBody.ok).toBe(true)
      acceptedUserId = acceptBody.user.id
      expect(acceptedUserId, 'the accept must create a new row, not revive the deleted one').not.toBe(firstUser.id)

      // The soft-deleted row and the new active row now coexist on the same key,
      // which is exactly what the partial index has to allow.
      expect(await readDeletedAt(firstUser.id), 'the old row stays soft-deleted').not.toBeNull()
      expect(await readDeletedAt(acceptedUserId), 'the new row is active').toBeNull()

      // 3. The other side of the constraint: an *active* account owning the address
      //    is still a genuine conflict, and it must answer 409 rather than the raw
      //    500 this PR set out to remove.
      const secondInviteRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users-invite', {
        token: adminToken,
        data: { email, roleIds: [roleId], displayName: `QA CACC Reuse 001 Conflict ${stamp}` },
      })
      expect(secondInviteRes.status(), 'inviting an already-active address should still create an invitation').toBe(201)
      const secondInviteBody = (await secondInviteRes.json()) as { invitation: { id: string } }
      invitationIds.push(secondInviteBody.invitation.id)

      const conflictToken = await waitForInviteToken(email, seenTokens)

      const conflictRes = await request.post('/api/customer_accounts/invitations/accept', {
        data: { token: conflictToken, password, displayName: `QA CACC Reuse 001 Duplicate ${stamp}` },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(
        conflictRes.status(),
        'an active account owning the address must produce a clean 409, never a 500',
      ).toBe(409)
      const conflictBody = (await conflictRes.json()) as { ok: boolean; error?: string }
      expect(conflictBody.ok).toBe(false)
      expect(conflictBody.error, 'the 409 must carry a message, not an i18n key').toBeTruthy()
      expect(conflictBody.error).not.toContain('customer_accounts.errors.')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, acceptedUserId)
      await deleteCustomerUserFixture(request, adminToken, deletedUserId)
      await deleteInvitationRows(invitationIds)
    }
  })
})
