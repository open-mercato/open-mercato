import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerRoleFixture,
  customerTestPassword,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

const invitationsPath = '/api/customer_accounts/admin/users-invite'
const peoplePath = '/api/customers/people'
const capturePath = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim()
  || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')

type CapturedMail = { to?: string; links?: string[] }

async function capturedInvitationLink(email: string): Promise<URL> {
  let invitationLink: URL | undefined
  await expect.poll(async () => {
    const capture = await readFile(capturePath, 'utf8').catch(() => '')
    invitationLink = capture.split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CapturedMail)
      .filter((message) => message.to?.toLowerCase() === email)
      .flatMap((message) => message.links ?? [])
      .map((link) => new URL(link))
      .find((link) => link.pathname.endsWith('/invite') && link.searchParams.has('token'))
    return Boolean(invitationLink)
  }, { timeout: 10_000, message: 'The recipient should receive the invitation email' }).toBe(true)
  if (!invitationLink) throw new Error('[internal] Captured invitation link is missing')
  return invitationLink
}

test('TC-CACC-INVITE-ROLE-001: a restricted portal invitation respects the inviter’s current role permissions', async ({ page, browser, request, baseURL }) => {
  test.slow()
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const suffix = randomUUID().slice(0, 8)
  const recipientEmail = `qa-portal-invite-${suffix}@test.local`
  const staffEmail = `qa-inviting-staff-${suffix}@example.test`
  const staffPassword = customerTestPassword()
  const inviteFeatures = ['customers.*', 'customer_accounts.view', 'customer_accounts.invite']

  let staffId: string | null = null
  let staffRoleId: string | null = null
  let portalRoleId: string | null = null
  let personId: string | null = null
  let invitationId: string | null = null
  let acceptedUserId: string | null = null

  try {
    const portalRole = await createCustomerRoleFixture(request, adminToken, {
      name: `QA Restricted ${suffix}`,
      customerAssignable: false,
    })
    portalRoleId = portalRole.id
    const person = await apiRequestWithSelectedOrg(request, 'POST', peoplePath, {
      token: adminToken,
      selectedOrgId: organizationId,
      data: {
        firstName: 'Portal',
        lastName: suffix,
        displayName: `Portal ${suffix}`,
        primaryEmail: recipientEmail,
      },
    })
    expect(person.status()).toBe(201)
    personId = expectId(((await person.json()) as { id?: string }).id, 'Person creation should return an id')

    staffRoleId = await createRoleFixture(request, adminToken, {
      name: `qa-inviting-staff-${suffix}`,
      tenantId,
    })
    await setRoleAclFeatures(request, adminToken, {
      roleId: staffRoleId,
      features: [...inviteFeatures, 'customer_accounts.roles.manage'],
      organizations: [organizationId],
    })
    staffId = await createUserFixture(request, adminToken, {
      email: staffEmail,
      password: staffPassword,
      organizationId,
      roles: [staffRoleId],
    })

    await acknowledgeGlobalNotices(page)
    await page.goto('/login')
    await expect(page.locator('form[data-auth-ready="1"]')).toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill(staffEmail)
    await page.getByLabel('Password', { exact: true }).fill(staffPassword)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)

    await page.goto(`/backend/customers/people-v2/${personId}`)
    await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Portal account', exact: true }).click()
    const accountPanel = page.getByRole('tabpanel', { name: 'Portal account' })
    await accountPanel.getByRole('button', { name: 'Invite to Portal', exact: true }).click()
    await accountPanel.getByRole('button', { name: portalRole.name, exact: true }).click()

    const issued = page.waitForResponse((response) => (
      response.url().endsWith(invitationsPath) && response.request().method() === 'POST'
    ))
    await accountPanel.getByRole('button', { name: 'Send Invitation', exact: true }).click()
    const issueResponse = await issued
    expect(issueResponse.status()).toBe(201)
    const invite = (await issueResponse.json()) as { invitation: { id: string; personEntityId: string } }
    invitationId = invite.invitation.id
    expect(invite.invitation.personEntityId).toBe(personId)
    await expect(accountPanel.getByText('Invitation pending', { exact: true })).toBeVisible()

    await setRoleAclFeatures(request, adminToken, {
      roleId: staffRoleId,
      features: inviteFeatures,
      organizations: [organizationId],
    })
    const invitationLink = await capturedInvitationLink(recipientEmail)
    const recipient = await browser.newPage({ baseURL })
    try {
      await recipient.goto(invitationLink.pathname + invitationLink.search)
      await expect(recipient.getByRole('heading', { name: 'Accept Invitation', exact: true })).toBeVisible()

      const password = customerTestPassword()
      await recipient.getByLabel('Display Name', { exact: true }).fill('Portal test user')
      await recipient.getByLabel('Password', { exact: true }).fill(password)
      await recipient.getByLabel('Confirm Password', { exact: true }).fill(password)
      const submitted = recipient.waitForResponse((response) => (
        response.url().endsWith('/api/customer_accounts/invitations/accept') && response.request().method() === 'POST'
      ))
      await recipient.getByRole('button', { name: 'Accept Invitation', exact: true }).click()
      const accepted = await submitted
      if (accepted.status() === 201) {
        acceptedUserId = ((await accepted.json()) as { user: { id: string } }).user.id
      }

      expect(accepted.status()).toBe(400)
      await expect(recipient.getByText('Invalid or expired invitation.', { exact: true })).toBeVisible()
      expect((await recipient.context().cookies()).filter(({ name }) => name === 'customer_auth_token' || name === 'customer_session_token')).toHaveLength(0)
    } finally {
      await recipient.close()
    }
  } finally {
    if (invitationId && !acceptedUserId) {
      await apiRequest(request, 'DELETE', `${invitationsPath}?id=${invitationId}`, { token: adminToken }).catch(() => undefined)
    }
    await deleteCustomerUserFixture(request, adminToken, acceptedUserId)
    await deleteUserIfExists(request, adminToken, staffId)
    await deleteRoleIfExists(request, adminToken, staffRoleId)
    if (personId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `${peoplePath}?id=${personId}`, {
        token: adminToken,
        selectedOrgId: organizationId,
      }).catch(() => undefined)
    }
    await deleteCustomerRoleFixture(request, adminToken, portalRoleId)
  }
})
