import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['auth', 'customers', 'directory'],
}

test('a viewer can read a person’s tasks without being offered write actions', async ({ page, request }, testInfo) => {
  const [setupToken, adminToken] = await Promise.all([
    withCredentialIsolatedRequest((loginRequest) => getAuthToken(loginRequest, 'superadmin')),
    withCredentialIsolatedRequest((loginRequest) => getAuthToken(loginRequest, 'admin')),
  ])
  const organizationId = expectId(getTokenContext(adminToken).organizationId, 'The tenant admin has an organization')
  const stamp = `${Date.now()}-${testInfo.retry}`
  const email = `crm9253-viewer-${stamp}@example.org`
  const password = 'Integration-CRM-Viewer-9253!'
  const personName = `Task profile ${stamp}`
  const title = `Customer follow-up ${stamp}`
  let userId: string | null = null
  let personId: string | null = null
  let taskId: string | null = null

  try {
    userId = await createUserFixture(request, setupToken, { email, password, organizationId, roles: [] })
    await setUserAclVisibility(request, setupToken, {
      userId,
      organizations: [organizationId],
      features: [
        'customers.people.view',
        'customers.interactions.view',
        'customers.roles.view',
        'dashboards.view',
      ],
    })
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'Task',
      lastName: 'Profile',
      displayName: personName,
    })
    const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
      token: adminToken,
      data: { entityId: personId, interactionType: 'task', title, status: 'planned' },
    })
    expect(created.status()).toBe(201)
    taskId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'The task was created')

    await acknowledgeGlobalNotices(page)
    const login = await page.request.post('/api/auth/login', { form: { email, password } })
    expect(login.ok()).toBeTruthy()
    await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)

    await expect(page.getByRole('heading', { name: personName, exact: true })).toBeVisible()
    const task = page.getByRole('article').filter({ hasText: title })
    await expect(task).toBeVisible()
    await expect(task.getByRole('checkbox')).toBeDisabled()
    await expect(task.getByRole('button', { name: /^(Edit|Delete|Cancel task)$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Go to all tasks' })).toHaveAttribute('href', '/backend/customer-tasks')

    const denied = await page.request.put('/api/customers/interactions', {
      data: { id: taskId, title: 'Denied task edit' },
    })
    expect(denied.status()).toBe(403)
    expect(await readJsonSafe(denied)).toMatchObject({ requiredFeatures: ['customers.interactions.manage'] })
    await page.screenshot({ path: testInfo.outputPath('view-only-person-tasks.png'), fullPage: true })
  } finally {
    if (taskId) await deleteEntityIfExists(request, adminToken, '/api/customers/interactions', taskId)
    if (personId) await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteUserIfExists(request, setupToken, userId)
  }
})
