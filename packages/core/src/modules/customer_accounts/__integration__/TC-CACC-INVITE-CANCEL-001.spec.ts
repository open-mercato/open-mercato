import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerRoleFixture,
  customerTestPassword,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
  setUserAclInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

type CapturedEmail = { to?: string; links?: string[] }
type InvitationState = { cancelled_at: Date | null; accepted_at: Date | null; email_hash: string }
const endpoint = '/api/customer_accounts/admin/users-invite'

async function capturedToken(email: string): Promise<string> {
  let token: string | undefined
  await expect.poll(async () => {
    const path = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')
    let captured: CapturedEmail[] = []
    try {
      captured = (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as CapturedEmail)
    } catch {
      return false
    }
    token = captured.filter((entry) => entry.to?.toLowerCase() === email.toLowerCase())
      .flatMap((entry) => entry.links ?? [])
      .filter((link) => link.includes('/portal/invite?token='))
      .map((link) => new URL(link).searchParams.get('token') ?? undefined)
      .find((value) => Boolean(value))
    return Boolean(token)
  }, { timeout: 10_000, message: 'The invitation email should be captured' }).toBe(true)
  if (!token) throw new Error('[internal] Captured invitation token is missing')
  return token
}

async function createInvitation(request: APIRequestContext, adminToken: string, roleId: string) {
  const email = `qa-invite-cancel-${uniqueSuffix()}@test.local`
  const response = await apiRequest(request, 'POST', endpoint, { token: adminToken, data: { email, roleIds: [roleId] } })
  expect(response.status()).toBe(201)
  const body = await response.json() as { invitation: { id: string } }
  expect(body.invitation).not.toHaveProperty('token')
  expect(body.invitation).not.toHaveProperty('rawToken')
  return { id: body.invitation.id, email }
}

async function invitationState(id: string): Promise<InvitationState> {
  return withClient(async (client) => {
    const result = await client.query<InvitationState>(
      'select cancelled_at, accepted_at, email_hash from customer_user_invitations where id = $1', [id],
    )
    return result.rows[0]
  })
}

async function deleteInvitations(ids: string[]) {
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from customer_user_invitations where id = any($1::uuid[])', [ids])
  })
}

test.describe('TC-CACC-INVITE-CANCEL-001: staff withdrawal of pending invitations', () => {
  test('coordinates concurrent acceptance and cancellation into a single terminal outcome', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let roleId: string | null = null
    let acceptedUserId: string | null = null
    const invitationIds: string[] = []
    try {
      roleId = (await createCustomerRoleFixture(request, adminToken)).id
      const invitation = await createInvitation(request, adminToken, roleId)
      invitationIds.push(invitation.id)
      const token = await capturedToken(invitation.email)
      const [cancellation, acceptance] = await Promise.all([
        apiRequest(request, 'DELETE', `${endpoint}?id=${invitation.id}`, { token: adminToken }),
        request.post('/api/customer_accounts/invitations/accept', {
          data: { token, password: customerTestPassword(), displayName: 'Concurrent invitation' },
        }),
      ])
      expect(cancellation.status()).toBe(200)
      expect(await cancellation.json()).toEqual({ ok: true })
      const state = await invitationState(invitation.id)
      const users = await withClient(async (client) => client.query<{ id: string }>(
        'select id from customer_users where tenant_id = $1 and email_hash = $2 and deleted_at is null', [tenantId, state.email_hash],
      ))
      if (state.cancelled_at) {
        expect(state.accepted_at).toBeNull()
        expect(acceptance.status()).toBe(400)
        expect(users.rows).toHaveLength(0)
      } else {
        expect(state.accepted_at).not.toBeNull()
        expect(acceptance.status()).toBe(201)
        expect(users.rows).toHaveLength(1)
        acceptedUserId = users.rows[0].id
      }
    } finally {
      await deleteCustomerUserFixture(request, adminToken, acceptedUserId)
      await deleteInvitations(invitationIds)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })

  test('allows staff to dismiss the confirmation and then cancel from the CRM person widget', async ({ page, request }, testInfo) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    let roleId: string | null = null
    let personId: string | null = null
    const invitationIds: string[] = []
    try {
      roleId = (await createCustomerRoleFixture(request, adminToken)).id
      const suffix = uniqueSuffix()
      const email = `qa-invite-widget-${suffix}@test.local`
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Cancellation', lastName: suffix, displayName: `Cancellation ${suffix}`, primaryEmail: email,
      })
      const invite = await apiRequest(request, 'POST', endpoint, {
        token: adminToken, data: { email, roleIds: [roleId], personEntityId: personId },
      })
      expect(invite.status()).toBe(201)
      const { invitation } = await invite.json() as { invitation: { id: string } }
      invitationIds.push(invitation.id)
      await login(page, 'admin')
      await page.goto(`/backend/customers/people-v2/${personId}`)
      await expect(page.getByText('Invitation pending', { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('pending-invitation.png'), fullPage: true })
      await page.getByRole('button', { name: 'Cancel invitation', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Cancel invitation?' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(email, { exact: false })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('cancellation-confirmation.png'), fullPage: true })
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      expect((await invitationState(invitation.id)).cancelled_at).toBeNull()

      await page.getByRole('button', { name: 'Cancel invitation', exact: true }).click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(dialog).not.toBeVisible()
      await expect(page.getByText('Invitation pending', { exact: true })).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Invite to Portal', exact: true })).toBeVisible()
      expect((await invitationState(invitation.id)).cancelled_at).not.toBeNull()
      await page.screenshot({ path: testInfo.outputPath('invitation-cancelled.png'), fullPage: true })
    } finally {
      await deleteInvitations(invitationIds)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })

  test('withdraws the link once, removes the pending listing, and never creates an account', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    let roleId: string | null = null
    const invitationIds: string[] = []
    try {
      roleId = (await createCustomerRoleFixture(request, adminToken)).id
      const invitation = await createInvitation(request, adminToken, roleId)
      invitationIds.push(invitation.id)
      const token = await capturedToken(invitation.email)
      const path = `${endpoint}?id=${invitation.id}`

      const cancelled = await apiRequest(request, 'DELETE', path, { token: adminToken })
      expect(cancelled.status()).toBe(200)
      expect(await cancelled.json()).toEqual({ ok: true })
      const initialState = await invitationState(invitation.id)
      expect(initialState.cancelled_at).not.toBeNull()
      expect(initialState.accepted_at).toBeNull()

      const repeated = await apiRequest(request, 'DELETE', path, { token: adminToken })
      expect(repeated.status()).toBe(200)
      expect(await repeated.json()).toEqual({ ok: true })
      expect((await invitationState(invitation.id)).cancelled_at).toEqual(initialState.cancelled_at)

      const pending = await apiRequest(request, 'GET', `${endpoint}?email=${encodeURIComponent(invitation.email)}`, { token: adminToken })
      expect(pending.status()).toBe(200)
      expect((await pending.json() as { items: unknown[] }).items).toEqual([])

      const acceptance = await request.post('/api/customer_accounts/invitations/accept', {
        data: { token, password: customerTestPassword(), displayName: 'Withdrawn invite' },
      })
      expect(acceptance.status()).toBe(400)
      expect((await acceptance.json() as { ok: boolean }).ok).toBe(false)
      const users = await withClient(async (client) => client.query<{ count: string }>(
        'select count(*) from customer_users where tenant_id = $1 and email_hash = $2', [tenantId, initialState.email_hash],
      ))
      expect(Number(users.rows[0].count)).toBe(0)
    } finally {
      await deleteInvitations(invitationIds)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })

  test('returns neutral responses across organizations and tenants while preserving the original acceptance contract', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenContext(adminToken)
    let roleId: string | null = null
    let otherOrgId: string | null = null
    let otherTenantId: string | null = null
    let otherTenantOrgId: string | null = null
    let acceptedUserId: string | null = null
    const invitationIds: string[] = []
    try {
      roleId = (await createCustomerRoleFixture(request, adminToken)).id
      const invitation = await createInvitation(request, adminToken, roleId)
      invitationIds.push(invitation.id)
      const token = await capturedToken(invitation.email)
      otherOrgId = await createOrganizationInDb({ name: `Cancellation scope ${uniqueSuffix()}`, tenantId: scope.tenantId })
      otherTenantId = await withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          'insert into tenants (id, name, is_active, created_at, updated_at) values (gen_random_uuid(), $1, true, now(), now()) returning id',
          [`Cancellation tenant ${uniqueSuffix()}`],
        )
        return result.rows[0].id
      })
      otherTenantOrgId = await createOrganizationInDb({ name: `Cancellation foreign scope ${uniqueSuffix()}`, tenantId: otherTenantId })

      for (const foreignScope of [
        { tenantId: scope.tenantId, organizationId: otherOrgId },
        { tenantId: otherTenantId, organizationId: otherTenantOrgId },
      ]) {
        await withClient(async (client) => {
          await client.query('update customer_user_invitations set tenant_id = $2, organization_id = $3 where id = $1',
            [invitation.id, foreignScope.tenantId, foreignScope.organizationId])
        })
        const response = await apiRequest(request, 'DELETE', `${endpoint}?id=${invitation.id}`, { token: adminToken })
        expect(response.status()).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect((await invitationState(invitation.id)).cancelled_at).toBeNull()
        const listing = await apiRequest(request, 'GET', `${endpoint}?email=${encodeURIComponent(invitation.email)}`, { token: adminToken })
        expect(listing.status()).toBe(200)
        expect((await listing.json() as { items: unknown[] }).items).toEqual([])
      }
      await withClient(async (client) => {
        await client.query('update customer_user_invitations set tenant_id = $2, organization_id = $3 where id = $1',
          [invitation.id, scope.tenantId, scope.organizationId])
      })
      const acceptance = await request.post('/api/customer_accounts/invitations/accept', {
        data: { token, password: customerTestPassword(), displayName: 'Still valid invite' },
      })
      expect(acceptance.status()).toBe(201)
      acceptedUserId = (await acceptance.json() as { user: { id: string } }).user.id
      const acceptedState = await invitationState(invitation.id)
      expect(acceptedState.accepted_at).not.toBeNull()
      const afterAcceptance = await apiRequest(request, 'DELETE', `${endpoint}?id=${invitation.id}`, { token: adminToken })
      expect(afterAcceptance.status()).toBe(200)
      expect(await afterAcceptance.json()).toEqual({ ok: true })
      expect(await invitationState(invitation.id)).toEqual(acceptedState)
      const user = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users/${acceptedUserId}`, { token: adminToken })
      expect(user.status()).toBe(200)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, acceptedUserId)
      await deleteInvitations(invitationIds)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteOrganizationInDb(otherOrgId)
      await deleteOrganizationInDb(otherTenantOrgId)
      if (otherTenantId) await withClient(async (client) => { await client.query('delete from tenants where id = $1', [otherTenantId]) })
    }
  })

  test('protects the action with staff permissions and leaves expired invitations unchanged', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenContext(adminToken)
    let roleId: string | null = null
    let staffId: string | null = null
    const invitationIds: string[] = []
    try {
      roleId = (await createCustomerRoleFixture(request, adminToken)).id
      const invitation = await createInvitation(request, adminToken, roleId)
      invitationIds.push(invitation.id)
      const path = `${endpoint}?id=${invitation.id}`
      const anonymousStatus = await withCredentialIsolatedRequest(async (anonymous) => (await anonymous.delete(path)).status())
      expect(anonymousStatus).toBe(401)
      const staffEmail = `qa-invite-reader-${uniqueSuffix()}@test.local`
      const password = customerTestPassword()
      staffId = await createUserFixture(request, adminToken, { email: staffEmail, password, organizationId: scope.organizationId, roles: [] })
      await setUserAclInDb({ userId: staffId, tenantId: scope.tenantId, features: ['customer_accounts.view'], organizations: [scope.organizationId] })
      const readOnlyToken = await getAuthToken(request, staffEmail, password)
      expect((await apiRequest(request, 'DELETE', path, { token: readOnlyToken })).status()).toBe(403)
      expect((await invitationState(invitation.id)).cancelled_at).toBeNull()

      await withClient(async (client) => { await client.query('update customer_user_invitations set expires_at = now() - interval \'1 minute\' where id = $1', [invitation.id]) })
      const expired = await apiRequest(request, 'DELETE', path, { token: adminToken })
      expect(expired.status()).toBe(200)
      expect(await expired.json()).toEqual({ ok: true })
      expect((await invitationState(invitation.id)).cancelled_at).toBeNull()
      const unknown = await apiRequest(request, 'DELETE', `${endpoint}?id=${randomUUID()}`, { token: adminToken })
      expect(unknown.status()).toBe(200)
      expect(await unknown.json()).toEqual({ ok: true })
      expect((await apiRequest(request, 'DELETE', `${endpoint}?id=invalid`, { token: adminToken })).status()).toBe(400)
    } finally {
      await deleteInvitations(invitationIds)
      if (staffId) await deleteUserAclInDb(staffId)
      await deleteUserIfExists(request, adminToken, staffId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  })
})
