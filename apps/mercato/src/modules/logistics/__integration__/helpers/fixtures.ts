import { randomUUID } from 'node:crypto'
import { expect, test as base, type Page } from '@playwright/test'
import { getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

export const sections = [
  { path: '/backend/logistics', title: 'Dispatcher dashboard' },
  { path: '/backend/logistics/transport-jobs', title: 'Transport jobs' },
  { path: '/backend/logistics/fleet', title: 'Vehicles / drivers' },
  { path: '/backend/logistics/trips', title: 'Trips and routes' },
  { path: '/backend/logistics/map', title: 'Fleet map' },
  { path: '/backend/logistics/statistics', title: 'Statistics' },
  { path: '/backend/logistics/proposals-disruptions', title: 'Proposals and disruptions' },
] as const

type LogisticsFixture = {
  organizationId: string
  organizationName: string
  addOrganization: () => Promise<{ id: string; name: string }>
  grant: (features: string[], organizations?: string[], secondary?: boolean) => Promise<void>
}

export const test = base.extend<{ logistics: LogisticsFixture }>({
  logistics: async ({ request, page, baseURL }, use) => {
    expect(baseURL, 'The prepared integration environment must provide a base URL').toBeTruthy()
    const administratorToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(administratorToken)
    const stamp = randomUUID()
    const organizationName = `QA Logistics ${stamp}`
    const organizationIds: string[] = []
    const roleIds: string[] = []
    let userId: string | null = null
    try {
      const organizationId = await createOrganizationFixture(request, administratorToken, {
        name: organizationName,
        tenantId,
      })
      organizationIds.push(organizationId)
      for (const suffix of ['primary', 'secondary']) {
        roleIds.push(await createRoleFixture(request, administratorToken, {
          name: `qa-logistics-${suffix}-${stamp}`,
          tenantId,
        }))
      }
      const grant = async (features: string[], organizations = [organizationId], secondary = false) => {
        await setRoleAclFeatures(request, administratorToken, {
          roleId: roleIds[secondary ? 1 : 0],
          features,
          organizations,
        })
      }
      await grant(['logistics.view'])
      await grant([], [organizationId], true)
      const email = `qa-logistics-${stamp}@example.com`
      const password = `Qa-${randomUUID()}!`
      userId = await createUserFixture(request, administratorToken, {
        email,
        password,
        organizationId,
        roles: roleIds,
      })
      const loginResponse = await postForm(page.request, '/api/auth/login', { email, password })
      expect(loginResponse.ok(), 'The isolated logistics user should be able to sign in').toBe(true)
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId },
        { name: 'om_selected_org', value: organizationId },
        { name: 'locale', value: 'en' },
        { name: 'om_demo_notice_ack', value: 'ack' },
        { name: 'om_cookie_notice_ack', value: 'ack' },
        { name: 'om_feedback_suppress', value: '1' },
      ].map((cookie) => ({ ...cookie, url: baseURL!, sameSite: 'Lax' as const })))
      await use({
        organizationId,
        organizationName,
        grant,
        addOrganization: async () => {
          const name = `QA Logistics scope ${randomUUID()}`
          const id = await createOrganizationFixture(request, administratorToken, { name, tenantId })
          organizationIds.push(id)
          return { id, name }
        },
      })
    } finally {
      await deleteUserIfExists(request, administratorToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, administratorToken, roleId)
      for (const organizationId of organizationIds.reverse()) {
        await deleteOrganizationIfExists(request, administratorToken, organizationId)
      }
    }
  },
})

export { expect }

export async function expectPlannedPage(page: Page, section: typeof sections[number]): Promise<void> {
  const content = page.getByTestId('logistics-page')
  await expect(content.getByRole('heading', { name: section.title, exact: true })).toBeVisible()
  await expect(content.getByText('Planned feature', { exact: true })).toBeVisible()
}

export async function expectAccessDenied(page: Page): Promise<void> {
  await expect(page.getByText('You do not have permission to view this page. Please contact your administrator.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('logistics-page')).toHaveCount(0)
  await expect(page.getByTestId('sidebar').getByRole('button', { name: 'Logistics', exact: true })).toHaveCount(0)
}
