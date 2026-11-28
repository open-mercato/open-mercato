import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createCustomerRoleFixture,
  deleteCustomerRoleFixture,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customer_accounts', 'customers'] }

const invitationEndpoint = '/api/customer_accounts/admin/users-invite'

async function openPortalAccount(page: Page, personId: string) {
  await page.goto(`/backend/customers/people-v2/${personId}`)
  await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Portal account', exact: true }).click()
}

test('TC-CACC-INVITE-SHARED-EMAIL-001: a shared address preserves the original person’s invitation', async ({ page, request }, testInfo) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const suffix = uniqueSuffix()
  const email = `qa-shared-invitation-${suffix}@test.local`
  const personIds: string[] = []
  let roleId: string | null = null

  try {
    const role = await createCustomerRoleFixture(request, adminToken)
    roleId = role.id
    for (const name of ['First', 'Second']) {
      personIds.push(await createPersonFixture(request, adminToken, {
        firstName: name,
        lastName: suffix,
        displayName: `${name} ${suffix}`,
        primaryEmail: email,
      }))
    }
    const [ownerPersonId, otherPersonId] = personIds
    const created = await apiRequest(request, 'POST', invitationEndpoint, {
      token: adminToken,
      data: { email, roleIds: [role.id], personEntityId: ownerPersonId },
    })
    expect(created.status()).toBe(201)
    const creation = await readJsonSafe<{ invitation?: { id?: string } }>(created)
    const invitationId = expectId(creation?.invitation?.id, 'The created invitation has an ID')

    const readTokenVerifier = () => withClient(async (client) => {
      const { rows } = await client.query<{ token: string }>(
        'select token from customer_user_invitations where id = $1 and tenant_id = $2 and organization_id = $3',
        [invitationId, tenantId, organizationId],
      )
      return rows[0]?.token
    })
    const originalVerifier = await readTokenVerifier()
    expect(Boolean(originalVerifier), 'The pending invitation has a token verifier').toBe(true)

    await login(page, 'admin')
    await openPortalAccount(page, otherPersonId)
    await expect(page.getByText('No account linked', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invite to Portal', exact: true })).toBeVisible()
    await expect(page.getByText('Invitation pending', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Resend invitation', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel invitation', exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('other-person-portal-account.png'), fullPage: true })

    const conflict = await apiRequest(request, 'POST', invitationEndpoint, {
      token: adminToken,
      data: { email, roleIds: [role.id], personEntityId: otherPersonId },
    })
    expect(conflict.status()).toBe(409)
    expect(await readTokenVerifier() === originalVerifier, 'The rejected invite keeps the original token verifier').toBe(true)

    const listing = await apiRequest(request, 'GET', `${invitationEndpoint}?email=${encodeURIComponent(email)}`, {
      token: adminToken,
    })
    expect(listing.status()).toBe(200)
    const invitations = await readJsonSafe<{ items: { id: string; personEntityId: string | null }[] }>(listing)
    expect(invitations?.items.map(({ id, personEntityId }) => ({ id, personEntityId })))
      .toEqual([{ id: invitationId, personEntityId: ownerPersonId }])

    await openPortalAccount(page, ownerPersonId)
    await expect(page.getByText('Invitation pending', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resend invitation', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('invitation-owner-portal-account.png'), fullPage: true })
  } finally {
    try {
      if (personIds.length > 0) {
        await withClient(async (client) => {
          await client.query(
            'delete from customer_user_invitations where tenant_id = $1 and organization_id = $2 and person_entity_id = any($3::uuid[])',
            [tenantId, organizationId, personIds],
          )
        })
      }
    } finally {
      for (const personId of personIds) await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
    }
  }
})
