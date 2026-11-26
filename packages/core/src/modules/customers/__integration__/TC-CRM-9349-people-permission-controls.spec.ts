import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

const restrictedRequests = [
  '/api/staff/team-members/assignable',
  '/api/customers/companies',
  '/api/customers/deals',
  '/api/customers/activities',
  '/api/customers/addresses',
  '/api/customers/interactions',
  '/api/customers/todos',
  '/api/attachments',
  '/api/audit_logs/audit-logs/actions',
  '/api/communication_channels/me/channels',
]

test('a People viewer can browse without unauthorized controls or related requests', async ({ page, request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenScope(adminToken)
  const marker = randomUUID()
  const displayName = `Person ${marker}`
  const companyName = `Company ${marker}`
  const email = `people-reader-${marker}@example.test`
  const password = `Qa1!-${randomUUID()}`
  let roleId: string | null = null
  let userId: string | null = null
  let personId: string | null = null
  let companyId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `people-reader-${marker}`, tenantId })
    await setRoleAclFeatures(request, adminToken, { roleId, features: ['customers.people.view', 'dashboards.view'] })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    companyId = await createCompanyFixture(request, adminToken, companyName)
    personId = await createPersonFixture(request, adminToken, {
      displayName,
      firstName: 'Permission',
      lastName: 'Viewer',
      companyEntityId: companyId,
    })
    await acknowledgeGlobalNotices(page)
    const login = await page.request.post('/api/auth/login', { form: { email, password } })
    expect(login.ok()).toBe(true)
    const unauthorizedRequests: string[] = []
    const relatedPersonPath = new RegExp(`^/api/customers/people/${personId}/(companies|roles)(/|$)`)
    page.on('request', (outgoing) => {
      const { pathname } = new URL(outgoing.url())
      if (relatedPersonPath.test(pathname) || restrictedRequests.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
        unauthorizedRequests.push(pathname)
      }
    })

    await page.goto(`/backend/customers/people?search=${encodeURIComponent(marker)}`)
    await expect(page.getByRole('row', { name: new RegExp(displayName) })).toBeVisible()
    await expect(page.getByRole('link', { name: 'New Person' })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Select row', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Set normal priority', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('sidebar').getByRole('link', { name: 'Messages', exact: true })).toHaveCount(0)

    const emailsLoaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/customers/people/${personId}/email-threads` && response.ok(),
    )
    await page.goto(`/backend/customers/people-v2/${personId}?tab=files`)
    await emailsLoaded
    await expect(page.getByRole('heading', { name: displayName })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'First name' })).toBeDisabled()
    await expect(page.getByRole('tab', { name: 'Emails', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Save|Delete|Edit tags|Send message|Manage fields)$/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Connect your mailbox' })).toHaveCount(0)
    await expect(page.getByText(companyName, { exact: true })).toHaveCount(0)
    expect(unauthorizedRequests).toEqual([])
  } finally {
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
