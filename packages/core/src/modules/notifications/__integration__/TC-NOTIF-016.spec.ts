import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe, getTokenScope, expectId, deleteGeneralEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

const PREFERENCES_PAGE = '/backend/profile/notification-preferences'
const ADMIN_PREFERENCES_PATH = '/api/notifications/admin/preferences'
const ADMIN_PREFERENCES_PAGE = '/backend/notifications/user-preferences'

type NotificationTypeItem = {
  id: string
  labelKey: string
  descriptionKey?: string | null
  category?: string | null
  categoryLabel?: string | null
  label?: string | null
  description?: string | null
  silent: boolean
  nonOptOut: boolean
  channels: string[] | null
  updatedAt: string | null
}
type TypesResponse = { items: NotificationTypeItem[] }

type PreferenceItem = { notificationTypeId: string; channel: string; enabled: boolean }
type PreferencesResponse = { items: PreferenceItem[] }

const TYPES_PATH = '/api/notifications/types'
const PREFERENCES_PATH = '/api/notifications/preferences'

let typeCounter = 0
function uniqueTypeId(): string {
  typeCounter += 1
  return `qa.notif.pref.${Date.now()}.${typeCounter}`
}

async function getTypes(
  request: APIRequestContext,
  token: string,
  options: { locale?: string } = {},
): Promise<TypesResponse> {
  const path = options.locale ? `${TYPES_PATH}?locale=${options.locale}` : TYPES_PATH
  const res = await apiRequest(request, 'GET', path, { token })
  expect(res.status()).toBe(200)
  const json = await readJsonSafe<TypesResponse>(res)
  return json ?? { items: [] }
}

async function getPreferences(request: APIRequestContext, token: string): Promise<PreferenceItem[]> {
  const res = await apiRequest(request, 'GET', PREFERENCES_PATH, { token })
  expect(res.status()).toBe(200)
  const json = await readJsonSafe<PreferencesResponse>(res)
  return json?.items ?? []
}

async function putPreferences(
  request: APIRequestContext,
  token: string,
  preferences: PreferenceItem[],
): Promise<number> {
  const res = await apiRequest(request, 'PUT', PREFERENCES_PATH, {
    token,
    data: { preferences },
  })
  return res.status()
}

test.describe('TC-NOTIF-016: Notification type catalogue + channel preferences', () => {
  test('GET /types returns the code-registered catalogue mirrored to the DB', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const { items } = await getTypes(request, token)

    // The catalogue is the union of every module's notifications.ts; at least
    // one type is always registered (e.g. auth/customers). Validate shape.
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(typeof item.id).toBe('string')
      expect(item.id.length).toBeGreaterThan(0)
      expect(typeof item.labelKey).toBe('string')
      expect(item.labelKey.length).toBeGreaterThan(0)
      // Phase 5 metadata: every item exposes the silent flag and the opt-out
      // lock as booleans.
      expect(typeof item.silent).toBe('boolean')
      expect(typeof item.nonOptOut).toBe('boolean')
      // `category` is resolved during sync (explicit declaration, else the type-id
      // prefix), so a visible type always carries a grouping key.
      expect(typeof item.category).toBe('string')
      expect(item.category!.length).toBeGreaterThan(0)
      // Display strings are resolved server-side; `categoryLabel` is non-null exactly
      // when `category` is, and falls back to the raw key when untranslated.
      expect(typeof item.categoryLabel).toBe('string')
      expect(item.categoryLabel!.length).toBeGreaterThan(0)
      expect(item.label === null || typeof item.label === 'string').toBe(true)
      expect(item.description === null || typeof item.description === 'string').toBe(true)
    }

    // At least one type defaults silent=false; the catalogue is opt-in per type.
    expect(items.some((item) => item.silent === false)).toBe(true)
  })

  test('grouping stays stable across locales while the headings localize', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const english = await getTypes(request, token, { locale: 'en' })
    const polish = await getTypes(request, token, { locale: 'pl' })

    // Clients group on `category` and display `categoryLabel`; if `category` shifted with
    // the locale, every persisted per-group UI state (collapsed sections) would break.
    expect(polish.items.map((item) => item.category)).toEqual(english.items.map((item) => item.category))
    expect(polish.items.some((item, index) => item.categoryLabel !== english.items[index]!.categoryLabel)).toBe(true)
  })

  test('preferences default to enabled, round-trip on opt-out, and upsert idempotently', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const typeId = uniqueTypeId()
    const channel = 'push'

    // No row yet ⇒ not present in the stored list (treated as enabled by default).
    const before = await getPreferences(request, token)
    expect(before.some((p) => p.notificationTypeId === typeId)).toBe(false)

    // Opt out of push for this type.
    expect(await putPreferences(request, token, [{ notificationTypeId: typeId, channel, enabled: false }])).toBe(200)
    let rows = await getPreferences(request, token)
    let mine = rows.filter((p) => p.notificationTypeId === typeId && p.channel === channel)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.enabled).toBe(false)

    // Re-enable.
    expect(await putPreferences(request, token, [{ notificationTypeId: typeId, channel, enabled: true }])).toBe(200)
    rows = await getPreferences(request, token)
    mine = rows.filter((p) => p.notificationTypeId === typeId && p.channel === channel)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.enabled).toBe(true)

    // Idempotent upsert: applying the same preference again does not duplicate the row.
    expect(await putPreferences(request, token, [{ notificationTypeId: typeId, channel, enabled: true }])).toBe(200)
    rows = await getPreferences(request, token)
    mine = rows.filter((p) => p.notificationTypeId === typeId && p.channel === channel)
    expect(mine).toHaveLength(1)
  })

  test('GET /types is idempotent (stable, de-duplicated catalogue) and an empty save is a no-op', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    // The read-through mirror reconcile must converge: repeated reads return the same set, no dupes.
    const first = (await getTypes(request, token)).items.map((item) => item.id).sort()
    const second = (await getTypes(request, token)).items.map((item) => item.id).sort()
    expect(second).toEqual(first)
    expect(new Set(second).size).toBe(second.length)

    // The client sends an empty diff when nothing changed — accepted, and writes no rows.
    const before = await getPreferences(request, token)
    expect(await putPreferences(request, token, [])).toBe(200)
    const after = await getPreferences(request, token)
    expect(after.length).toBe(before.length)
  })

  test('rejects unauthenticated preference writes', async ({ request }) => {
    const res = await apiRequest(request, 'PUT', PREFERENCES_PATH, {
      token: '',
      data: { preferences: [{ notificationTypeId: uniqueTypeId(), channel: 'push', enabled: false }] },
    })
    // No valid principal ⇒ rejected by the auth guard (401) or the feature gate (403).
    expect([401, 403]).toContain(res.status())
  })

  test('admin can read and edit another user\'s preferences, reflected in that user\'s self view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeUserId = getTokenScope(employeeToken).userId
    const typeId = uniqueTypeId()

    // Admin disables push for the employee for this type.
    const putRes = await apiRequest(request, 'PUT', ADMIN_PREFERENCES_PATH, {
      token: adminToken,
      data: { userId: employeeUserId, preferences: [{ notificationTypeId: typeId, channel: 'push', enabled: false }] },
    })
    expect(putRes.status()).toBe(200)

    // Admin reads it back for that user.
    const adminGet = await apiRequest(request, 'GET', `${ADMIN_PREFERENCES_PATH}?userId=${employeeUserId}`, { token: adminToken })
    expect(adminGet.status()).toBe(200)
    const adminItems = (await readJsonSafe<PreferencesResponse>(adminGet))?.items ?? []
    const adminRow = adminItems.find((p) => p.notificationTypeId === typeId && p.channel === 'push')
    expect(adminRow?.enabled).toBe(false)

    // The employee sees the admin-made change in their own self view.
    const selfRows = await getPreferences(request, employeeToken)
    const selfRow = selfRows.find((p) => p.notificationTypeId === typeId && p.channel === 'push')
    expect(selfRow?.enabled).toBe(false)
  })

  test('admin preferences API enforces the admin feature and tenant membership', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const adminToken = await getAuthToken(request, 'admin')
    const employeeUserId = getTokenScope(employeeToken).userId

    // Employee lacks notifications.manage_user_preferences ⇒ blocked.
    const blocked = await apiRequest(request, 'PUT', ADMIN_PREFERENCES_PATH, {
      token: employeeToken,
      data: { userId: employeeUserId, preferences: [{ notificationTypeId: uniqueTypeId(), channel: 'push', enabled: false }] },
    })
    expect([401, 403]).toContain(blocked.status())

    // Unknown user (not in tenant) ⇒ 404.
    const missing = await apiRequest(request, 'GET', `${ADMIN_PREFERENCES_PATH}?userId=00000000-0000-0000-0000-000000000000`, { token: adminToken })
    expect(missing.status()).toBe(404)
  })

  test('admin user-preferences page searches a user and saves a toggle', async ({ page }) => {
    await login(page, 'admin')
    await page.goto(ADMIN_PREFERENCES_PAGE)
    await expect(page.getByRole('heading', { name: /User Notification Preferences/i })).toBeVisible()

    // LookupSelect (defaultOpen) lists users on load; pick the first option.
    const firstUser = page.getByRole('option').first()
    await expect(firstUser).toBeVisible()
    await firstUser.click()

    const firstSwitch = page.getByRole('switch').first()
    await expect(firstSwitch).toBeVisible()
    await firstSwitch.click()

    const savePromise = page.waitForResponse(
      (res) => res.url().includes('/api/notifications/admin/preferences') && res.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: /Save preferences/i }).click()
    const saveRes = await savePromise
    expect(saveRes.status()).toBe(200)
  })

  test('preferences settings page renders and persists a toggle', async ({ page }) => {
    await login(page, 'employee')
    await page.goto(PREFERENCES_PAGE)

    await expect(page.getByRole('heading', { name: /Notification Preferences/i })).toBeVisible()

    const firstSwitch = page.getByRole('switch').first()
    await expect(firstSwitch).toBeVisible()

    const before = await firstSwitch.getAttribute('aria-checked')
    await firstSwitch.click()

    const savePromise = page.waitForResponse(
      (res) => res.url().includes('/api/notifications/preferences') && res.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: /Save preferences/i }).click()
    const saveRes = await savePromise
    expect(saveRes.status()).toBe(200)

    await page.reload()
    const reloaded = page.getByRole('switch').first()
    await expect(reloaded).toBeVisible()
    await expect(reloaded).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
  })

  test('admin delivery settings group registered types and persist a channel toggle', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `qa-notif-groups-${stamp}@test.invalid`
    const password = 'Valid1!Pass'
    let tenantId: string | null = null
    let organizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let actorToken: string | null = null
    let targetTypeId: string | null = null

    try {
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA notification groups ${stamp}` },
      })
      expect(tenantResponse.status()).toBe(201)
      tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'Tenant creation should return an id')
      organizationId = await createOrganizationFixture(request, superadminToken, { name: `QA notification groups ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-notif-groups-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: ['notifications.view', 'notifications.manage'], organizations: [organizationId] })
      userId = await createUserFixture(request, superadminToken, { email, password, organizationId, roles: [roleId] })

      await page.context().clearCookies()
      actorToken = await getAuthToken(page.request, email, password)
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId, url: baseUrl },
        { name: 'om_selected_org', value: organizationId, url: baseUrl },
        { name: 'locale', value: 'en', url: baseUrl },
        { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl },
        { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl },
        { name: 'om_feedback_suppress', value: '1', url: baseUrl },
      ])
      const { items } = await getTypes(request, actorToken, { locale: 'en' })
      const categories = [...new Set(items.map((item) => item.category).filter((category): category is string => Boolean(category)))].sort()
      expect(categories.length).toBeGreaterThanOrEqual(2)
      const target = items.find((item) => item.category === categories[0])!
      targetTypeId = target.id
      const channelsResponse = await apiRequest(request, 'GET', '/api/notifications/channels', { token: actorToken })
      expect(channelsResponse.status()).toBe(200)
      const channels = (await readJsonSafe<{ items: Array<{ id: string }> }>(channelsResponse))?.items ?? []
      expect(channels.length).toBeGreaterThanOrEqual(2)
      const setup = await apiRequest(request, 'PATCH', TYPES_PATH, {
        token: actorToken,
        data: { id: target.id, channels: channels.slice(0, 2).map((channel) => channel.id) },
      })
      expect(setup.status()).toBe(200)

      await page.goto('/backend/config/notifications', { waitUntil: 'domcontentloaded' })
      const table = page.getByRole('table')
      await expect(table.getByRole('rowheader')).toHaveText(categories.map((category) => {
        const item = items.find((entry) => entry.category === category)!
        return item.categoryLabel || category
      }))
      for (const category of categories) {
        const groupItems = items.filter((item) => item.category === category)
        const group = table.getByRole('rowgroup', { name: groupItems[0]!.categoryLabel || category, exact: true })
        await expect(group.getByRole('row')).toHaveCount(groupItems.length + 1)
        await expect(group.getByText(groupItems[0]!.label || groupItems[0]!.id, { exact: true })).toBeVisible()
      }
      await expect(table.getByRole('row')).toHaveCount(items.length + categories.length + 1)
      const targetGroup = table.getByRole('rowgroup', { name: target.categoryLabel || target.category!, exact: true })
      const targetRow = targetGroup.getByRole('row').filter({ has: page.getByText(target.label || target.id, { exact: true }) })
      const toggle = targetRow.getByRole('switch').first()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      const channelPath = `${TYPES_PATH}/${encodeURIComponent(target.id)}/channels/${encodeURIComponent(channels[0]!.id)}`
      const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === channelPath && response.request().method() === 'DELETE')
      await toggle.click()
      expect((await savedResponse).status()).toBe(200)
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      const saved = (await getTypes(request, actorToken)).items.find((item) => item.id === target.id)
      expect(saved?.channels).not.toContain(channels[0]!.id)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
    } finally {
      try {
        if (actorToken && targetTypeId) {
          const current = (await getTypes(request, actorToken)).items.find((item) => item.id === targetTypeId)
          const cleared = await apiRequest(request, 'PATCH', TYPES_PATH, {
            token: actorToken,
            data: { id: targetTypeId, channels: null, nonOptOut: null },
            headers: current?.updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': current.updatedAt } : undefined,
          })
          expect(cleared.status()).toBe(200)
        }
      } finally {
        await deleteUserIfExists(request, superadminToken, userId)
        await deleteRoleIfExists(request, superadminToken, roleId)
        await deleteOrganizationIfExists(request, superadminToken, organizationId)
        await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantId)
      }
    }
  })

})
