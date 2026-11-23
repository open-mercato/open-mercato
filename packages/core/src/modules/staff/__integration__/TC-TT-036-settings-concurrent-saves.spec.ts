import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import type { TimeTrackingSettings } from '../lib/time-tracking/settings'

export const integrationMeta = { dependsOnModules: ['auth', 'configs', 'directory'] }

const TENANTS = '/api/directory/tenants'
const SETTINGS = '/api/staff/timesheets/settings'
const SETTINGS_PAGE = '/backend/staff/time-tracking/settings'

async function readSettings(request: APIRequestContext, token: string): Promise<TimeTrackingSettings> {
  const response = await apiRequest(request, 'GET', SETTINGS, { token })
  expect(response.status(), 'The settings API returns the editor’s tenant settings').toBe(200)
  return await response.json() as TimeTrackingSettings
}

test('TC-TT-036: a Polish settings editor preserves a second editor’s saved change', async ({ page, request }) => {
  const superadmin = await getAuthToken(request, 'superadmin')
  const suffix = randomUUID()
  const password = `QA-${suffix}!aA1`
  let tenantId: string | null = null
  let organizationId: string | null = null
  let roleId: string | null = null
  const userIds: string[] = []

  try {
    const tenant = await apiRequest(request, 'POST', TENANTS, {
      token: superadmin,
      data: { name: `QA TT036 ${suffix}` },
    })
    expect(tenant.status()).toBe(201)
    tenantId = expectId((await readJsonSafe<{ id?: string }>(tenant))?.id, 'Created tenant')
    organizationId = await createOrganizationFixture(request, superadmin, {
      name: `QA TT036 editor organization ${suffix}`, tenantId,
    })
    roleId = await createRoleFixture(request, superadmin, { name: `qa-tt036-${suffix}`, tenantId })
    await setRoleAclFeatures(request, superadmin, {
      roleId,
      organizations: [organizationId],
      features: ['staff.view', 'staff.timesheets.view', 'staff.timesheets.settings.manage'],
    })
    const editorEmail = `qa-tt036-editor-${suffix}@example.com`
    const secondEditorEmail = `qa-tt036-second-${suffix}@example.com`
    for (const email of [editorEmail, secondEditorEmail]) {
      userIds.push(await createUserFixture(request, superadmin, { email, password, organizationId, roles: [roleId] }))
    }

    const editorToken = await getAuthToken(page.request, editorEmail, password)
    await acknowledgeGlobalNotices(page)
    const locale = await page.request.post('/api/auth/locale', { data: { locale: 'pl' } })
    expect(locale.status()).toBe(200)
    await page.goto(SETTINGS_PAGE)

    const dailyHours = page.getByRole('textbox', { name: 'Dzienny cel godzin', exact: true })
    const chainStart = page.getByRole('switch', { name: 'Start = koniec poprzedniego wpisu', exact: true })
    await expect(dailyHours).toBeEditable()
    await expect(chainStart).toBeVisible()
    const editorBaseline = await readSettings(page.request, editorToken)
    const originallyChains = editorBaseline.defaults.chainStartFromPreviousEnd
    const nextDailyHours = editorBaseline.targets.dailyHours === 7.5 ? 6.5 : 7.5
    const localizedDailyHours = String(nextDailyHours).replace('.', ',')

    await withCredentialIsolatedRequest(async (secondRequest) => {
      const secondEditorToken = await getAuthToken(secondRequest, secondEditorEmail, password)
      const secondBaseline = await readSettings(secondRequest, secondEditorToken)
      const changed = await apiRequest(secondRequest, 'PUT', `${SETTINGS}?changedKeys=defaults.chainStartFromPreviousEnd`, {
        token: secondEditorToken,
        data: {
          ...secondBaseline,
          defaults: { ...secondBaseline.defaults, chainStartFromPreviousEnd: !originallyChains },
        },
      })
      expect(changed.status(), 'Second editor saves the switch while the first editor’s page stays open').toBe(200)
    })

    await expect(chainStart).toHaveAttribute('aria-checked', String(originallyChains))
    await dailyHours.fill(localizedDailyHours)
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === SETTINGS && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click()
    const saveResponse = await saved
    expect(saveResponse.status()).toBe(200)
    expect(new URL(saveResponse.url()).searchParams.get('changedKeys')).toBe('targets.dailyHours')

    const stored = await readSettings(page.request, editorToken)
    expect(stored.defaults.chainStartFromPreviousEnd).toBe(!originallyChains)
    expect(stored.targets.dailyHours).toBe(nextDailyHours)
    await page.reload()
    await expect(dailyHours).toHaveValue(localizedDailyHours)
    await expect(chainStart).toHaveAttribute('aria-checked', String(!originallyChains))
    await test.info().attach('settings-reload-pl', { body: await page.screenshot(), contentType: 'image/png' })
  } finally {
    try {
      if (tenantId) {
        await withClient(async (client) => {
          await client.query('delete from module_configs where tenant_id = $1 and module_id = $2', [tenantId, 'staff.time_tracking'])
        })
      }
    } finally {
      for (const userId of userIds) await deleteUserIfExists(request, superadmin, userId)
      await deleteRoleIfExists(request, superadmin, roleId)
      await deleteOrganizationIfExists(request, superadmin, organizationId)
      await deleteGeneralEntityIfExists(request, superadmin, TENANTS, tenantId)
    }
  }
})
