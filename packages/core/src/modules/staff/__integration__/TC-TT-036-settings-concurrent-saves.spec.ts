import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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

test('TC-TT-036: a Polish settings editor preserves a second editor’s saved change', async ({ page, request, browser, baseURL }) => {
  const superadmin = await getAuthToken(request, 'superadmin')
  const suffix = randomUUID()
  const password = `QA-${suffix}!aA1`
  let tenantId: string | null = null
  let organizationId: string | null = null
  const roleIds: string[] = []
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
    const roleId = await createRoleFixture(request, superadmin, { name: `qa-tt036-${suffix}`, tenantId })
    roleIds.push(roleId)
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

    const secondContext = await browser.newContext({ baseURL })
    try {
      const secondPage = await secondContext.newPage()
      await getAuthToken(secondPage.request, secondEditorEmail, password)
      await acknowledgeGlobalNotices(secondPage)
      const secondLocale = await secondPage.request.post('/api/auth/locale', { data: { locale: 'en' } })
      expect(secondLocale.status()).toBe(200)
      await secondPage.goto(SETTINGS_PAGE)
      const secondSwitch = secondPage.getByRole('switch', { name: 'Start = end of the previous entry', exact: true })
      await expect(secondSwitch).toHaveAttribute('aria-checked', String(originallyChains))
      await secondSwitch.click()

      const secondSave = secondPage.waitForResponse((response) =>
        new URL(response.url()).pathname === SETTINGS && response.request().method() === 'PUT',
      )
      await secondPage.getByRole('button', { name: 'Save', exact: true }).click()
      const secondSaveResponse = await secondSave
      expect(secondSaveResponse.status()).toBe(200)
      expect(new URL(secondSaveResponse.url()).searchParams.get('changedKeys')).toBe('defaults.chainStartFromPreviousEnd')
      await expect(secondSwitch).toHaveAttribute('aria-checked', String(!originallyChains))
    } finally {
      await secondContext.close()
    }

    await expect(chainStart).toHaveAttribute('aria-checked', String(originallyChains))
    await dailyHours.fill(localizedDailyHours)
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === SETTINGS && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click()
    const saveResponse = await saved
    expect(saveResponse.status()).toBe(200)
    expect(new URL(saveResponse.url()).searchParams.get('changedKeys')).toBe('targets.dailyHours')

    const expectedSettings = {
      ...editorBaseline,
      defaults: { ...editorBaseline.defaults, chainStartFromPreviousEnd: !originallyChains },
      targets: { ...editorBaseline.targets, dailyHours: nextDailyHours },
    }
    await expect(readSettings(page.request, editorToken)).resolves.toEqual(expectedSettings)
    await page.reload()
    await expect(dailyHours).toHaveValue(localizedDailyHours)
    await expect(chainStart).toHaveAttribute('aria-checked', String(!originallyChains))
    await test.info().attach('settings-reload-pl', { body: await page.screenshot(), contentType: 'image/png' })

    const mismatchedTenant = new URLSearchParams({ changedKeys: 'targets.dailyHours', expectedTenantId: randomUUID() })
    const rejected = await apiRequest(page.request, 'PUT', `${SETTINGS}?${mismatchedTenant}`, {
      token: editorToken,
      data: { targets: { dailyHours: 9 } },
    })
    expect(rejected.status()).toBe(409)
    await expect(rejected.json()).resolves.toMatchObject({ code: 'tenant_scope_changed' })

    const viewerRole = await createRoleFixture(request, superadmin, { name: `qa-tt036-viewer-${suffix}`, tenantId })
    roleIds.push(viewerRole)
    await setRoleAclFeatures(request, superadmin, {
      roleId: viewerRole,
      organizations: [organizationId],
      features: ['staff.view', 'staff.timesheets.view'],
    })
    const viewerEmail = `qa-tt036-viewer-${suffix}@example.com`
    userIds.push(await createUserFixture(request, superadmin, {
      email: viewerEmail, password, organizationId, roles: [viewerRole],
    }))

    const viewerContext = await browser.newContext({ baseURL })
    try {
      const viewerPage = await viewerContext.newPage()
      const viewerToken = await getAuthToken(viewerPage.request, viewerEmail, password)
      await acknowledgeGlobalNotices(viewerPage)
      const viewerLocale = await viewerPage.request.post('/api/auth/locale', { data: { locale: 'pl' } })
      expect(viewerLocale.status()).toBe(200)
      await viewerPage.goto(SETTINGS_PAGE)
      await expect(viewerPage.getByText('Brak dostępu', { exact: true })).toBeVisible()
      await expect(viewerPage.getByRole('textbox', { name: 'Dzienny cel godzin', exact: true })).toHaveCount(0)
      const forbidden = await apiRequest(viewerPage.request, 'PUT', `${SETTINGS}?changedKeys=targets.dailyHours`, {
        token: viewerToken,
        data: { targets: { dailyHours: 9 } },
      })
      expect(forbidden.status()).toBe(403)
    } finally {
      await viewerContext.close()
    }

    await expect(readSettings(page.request, editorToken)).resolves.toEqual(expectedSettings)
  } finally {
    try {
      if (tenantId) {
        await withClient(async (client) => {
          await client.query('delete from module_configs where tenant_id = $1 and module_id = $2', [tenantId, 'staff.time_tracking'])
        })
      }
    } finally {
      for (const userId of userIds) await deleteUserIfExists(request, superadmin, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, superadmin, roleId)
      await deleteOrganizationIfExists(request, superadmin, organizationId)
      await deleteGeneralEntityIfExists(request, superadmin, TENANTS, tenantId)
    }
  }
})
