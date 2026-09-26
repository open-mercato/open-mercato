import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

// TC-DEV-010: browser-level coverage for the device owner picker and owner column (#5633).
// TC-DEV-009 covers the underlying `/api/auth/users` batch lookup at the API level only; this spec
// drives the two UI surfaces #5617 actually shipped on top of it: the `combobox` owner field on
// Register device, and the batched owner-column resolution on the devices list/detail pages.
// It also pins the contract that changed late in #5617: `allowCustomValues: false` — an id that
// never came back from a search is rejected, not accepted as a raw UUID — and the ACL degradation
// when a role holds `devices.admin` without `auth.users.list`.

const ADMIN_DEVICES_PATH = '/api/devices/admin/devices'
const RAW_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-/i
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function registerDeviceForUser(
  request: APIRequestContext,
  token: string,
  input: { userId: string; deviceId: string },
): Promise<string> {
  const res = await apiRequest(request, 'POST', ADMIN_DEVICES_PATH, {
    token,
    data: { userId: input.userId, deviceId: input.deviceId, platform: 'ios' },
  })
  expect(res.status(), 'admin device registration should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(res)
  const id = body?.id
  if (!id) throw new Error('admin device registration did not return an id')
  return id
}

async function deleteDeviceIfExists(request: APIRequestContext, token: string, id: string | null): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${ADMIN_DEVICES_PATH}/${id}`, { token }).catch(() => undefined)
}

// `ComboboxInput` re-syncs its displayed text from an async label/suggestion resolution effect
// (debounced search, eager label lookup) any time that effect resolves while the field is focused
// and not yet marked as user-typed. Typing character-by-character with `pressSequentially` can race
// that resolution and have its leading keystrokes silently overwritten. `fill()` sets the value in
// one atomic operation, so it isn't vulnerable to the same mid-typing reset — retrying absorbs a
// reset that happens to land immediately after the fill. Mirrors `safeFill` in
// `packages/core/src/modules/customers/__integration__/TC-CRM-002.spec.ts`.
async function typeIntoCombobox(page: Page, input: import('@playwright/test').Locator, text: string): Promise<void> {
  await expect(input).toBeVisible({ timeout: 15_000 })
  await expect(input).toBeEnabled({ timeout: 15_000 })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await input.click()
    await input.fill('')
    await input.fill(text)
    if ((await input.inputValue().catch(() => '')) === text) return
    await page.waitForTimeout(250)
  }
  await expect(input).toHaveValue(text, { timeout: 5_000 })
}

// Logs a non-seeded user in via the `page` fixture: `login()` only knows the three built-in roles,
// so a custom-role user authenticates directly against /api/auth/login and the tenant/org cookies
// are decoded from the returned JWT, matching the pattern used elsewhere for custom-ACL fixtures.
async function loginAsCustomUser(page: Page, email: string, password: string): Promise<void> {
  const loginForm = new URLSearchParams()
  loginForm.set('email', email)
  loginForm.set('password', password)
  const loginResp = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: loginForm.toString(),
  })
  expect(loginResp.ok(), 'login as custom-role user should succeed').toBeTruthy()
  const loginBody = (await loginResp.json().catch(() => null)) as { token?: string } | null
  const tokenParts = typeof loginBody?.token === 'string' ? loginBody.token.split('.') : []
  if (tokenParts.length >= 2) {
    const normalized = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      tenantId?: string
      orgId?: string | null
    }
    const cookies = []
    if (claims.tenantId) cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: BASE_URL, sameSite: 'Lax' as const })
    if (claims.orgId) cookies.push({ name: 'om_selected_org', value: claims.orgId, url: BASE_URL, sameSite: 'Lax' as const })
    if (cookies.length > 0) await page.context().addCookies(cookies)
  }
}

test.describe('TC-DEV-010: device owner picker and owner column render names, not raw ids', () => {
  test.slow()

  test('picker resolves search results, rejects out-of-list values, and the owner column never shows a raw id', async ({ page, request }) => {
    const suffix = uniqueSuffix()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)

    let aliceId: string | null = null
    let bobId: string | null = null
    let degradedRoleUserId: string | null = null
    let degradedRoleId: string | null = null
    let createdDeviceId: string | null = null
    let apiRegisteredDeviceId: string | null = null
    const paginationDeviceIds: string[] = []

    try {
      // -- Setup ---------------------------------------------------------------
      const alicePassword = 'Sup3rSecret!pass'
      aliceId = await createUserFixture(request, adminToken, {
        email: `tc-dev-010-alice-${suffix}@example.test`,
        password: alicePassword,
        organizationId: scope.organizationId,
        roles: [],
        name: `TC DEV 010 Alice ${suffix}`,
      })
      bobId = await createUserFixture(request, adminToken, {
        email: `tc-dev-010-bob-${suffix}@example.test`,
        password: 'Sup3rSecret!pass',
        organizationId: scope.organizationId,
        roles: [],
        name: `TC DEV 010 Bob ${suffix}`,
      })

      const degradedRoleName = `qa_tc_dev_010_${suffix}`
      degradedRoleId = await createRoleFixture(request, adminToken, { name: degradedRoleName, tenantId: scope.tenantId })
      // Deliberately omit `auth.users.list`: `devices.admin`'s `dependsOn` is declarative-only (it
      // feeds ACL-editor diagnostics, never an implicit grant), so this role genuinely lacks it.
      await setRoleAclFeatures(request, adminToken, { roleId: degradedRoleId, features: ['devices.admin'] })
      const degradedPassword = 'Sup3rSecret!pass'
      degradedRoleUserId = await createUserFixture(request, adminToken, {
        email: `tc-dev-010-degraded-${suffix}@example.test`,
        password: degradedPassword,
        organizationId: scope.organizationId,
        roles: [degradedRoleName],
        name: `TC DEV 010 Degraded ${suffix}`,
      })

      // -- Picker (full admin) --------------------------------------------------
      await login(page, 'admin')
      await page.goto('/backend/devices/create', { waitUntil: 'domcontentloaded' })

      const userField = page.locator('[data-crud-field-id="userId"]').first()
      const userInput = userField.getByRole('combobox').first()
      const aliceName = `TC DEV 010 Alice ${suffix}`
      await typeIntoCombobox(page, userInput, aliceName)

      const options = page.getByRole('option')
      await expect(options).toHaveCount(1, { timeout: 10_000 })
      await expect(options.first()).toContainText(aliceName)
      await expect(options.first()).toContainText(`tc-dev-010-alice-${suffix}@example.test`)
      await options.first().click()

      const deviceIdValue = `qa-tc-dev-010-${suffix}`
      await page.locator('[data-crud-field-id="deviceId"]').first().getByRole('textbox').fill(deviceIdValue)

      const submitButton = page.getByRole('button', { name: /Create|Save/i }).last()
      await expect(submitButton).toBeEnabled({ timeout: 15_000 })
      await submitButton.click()

      await page.waitForURL(/\/backend\/devices$/, { timeout: 15_000 })
      await expect(page.getByText('Device registered', { exact: true })).toBeVisible({ timeout: 10_000 })

      const created = await apiRequest(request, 'GET', `${ADMIN_DEVICES_PATH}?userId=${aliceId}`, { token: adminToken })
      const createdItems = (await readJsonSafe<{ items?: Array<{ id: string; deviceId: string }> }>(created))?.items ?? []
      createdDeviceId = createdItems.find((item) => item.deviceId === deviceIdValue)?.id ?? null
      expect(createdDeviceId, 'the device just registered through the form should exist').toBeTruthy()

      // -- Out-of-list values are rejected ---------------------------------------
      await page.goto('/backend/devices/create', { waitUntil: 'domcontentloaded' })
      const userField2 = page.locator('[data-crud-field-id="userId"]').first()
      const userInput2 = userField2.getByRole('combobox').first()
      const bogusUuid = '00000000-0000-4000-8000-000000000000'
      await typeIntoCombobox(page, userInput2, bogusUuid)
      // No search result matches this value, so no option ever appears to select.
      await expect(page.getByRole('option')).toHaveCount(0, { timeout: 5_000 })
      await userInput2.blur()
      // `ComboboxInput.confirmSelection` reverts the input when `allowCustomValues` is false and the
      // typed text does not match a known option.
      await expect(userInput2).not.toHaveValue(bogusUuid, { timeout: 5_000 })
      // `CrudForm` never disables the submit button for validation state — it stays clickable and
      // `handleSubmit` blocks an empty required field with an inline error instead. So the pin here
      // is behavioral: clicking submit must not register a device or navigate away from the form.
      const deviceIdValue2 = `qa-tc-dev-010-rejected-${suffix}`
      await page.locator('[data-crud-field-id="deviceId"]').first().getByRole('textbox').fill(deviceIdValue2)
      const submitButton2 = page.getByRole('button', { name: /Create|Save/i }).last()
      await submitButton2.click()
      await page.waitForTimeout(1_000)
      await expect(page).toHaveURL(/\/backend\/devices\/create$/)
      const rejectedAttempt = await apiRequest(request, 'GET', `${ADMIN_DEVICES_PATH}?deviceId=${deviceIdValue2}`, { token: adminToken })
      const rejectedItems = (await readJsonSafe<{ items?: Array<{ deviceId: string }> }>(rejectedAttempt))?.items ?? []
      expect(
        rejectedItems.some((item) => item.deviceId === deviceIdValue2),
        'submitting with an out-of-list owner value must not register a device',
      ).toBe(false)

      // -- Owner column: a device whose owner never appeared in a picker search ---
      const bobDeviceId = `qa-tc-dev-010-bob-${suffix}`
      apiRegisteredDeviceId = await registerDeviceForUser(request, adminToken, { userId: bobId, deviceId: bobDeviceId })

      await page.goto('/backend/devices', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(deviceIdValue)).toBeVisible({ timeout: 15_000 })

      const bobName = `TC DEV 010 Bob ${suffix}`
      await expect
        .poll(async () => (await page.getByText(bobName).count()) > 0, { timeout: 15_000 })
        .toBe(true)

      const userCells = page.locator('table tbody tr td:nth-child(2)')
      const cellCount = await userCells.count()
      for (let i = 0; i < cellCount; i += 1) {
        const text = (await userCells.nth(i).innerText()).trim()
        expect(RAW_UUID_PATTERN.test(text), `owner cell "${text}" should not be a raw UUID`).toBe(false)
      }

      // -- Owner column across pagination: register enough devices for one owner
      //    to push a second page, then confirm the batched lookup still resolves it there.
      //    This is the assertion that actually fails if `resolveDeviceUserOptions` regresses to
      //    resolving only the page it happened to prefetch options for.
      const paginationOwnerId = bobId
      for (let i = 0; i < 50; i += 1) {
        paginationDeviceIds.push(
          await registerDeviceForUser(request, adminToken, {
            userId: paginationOwnerId,
            deviceId: `qa-tc-dev-010-page-${suffix}-${i}`,
          }),
        )
      }

      await page.goto('/backend/devices', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /Filters/i }).click()
      const filterPanel = page.locator('.fixed.inset-0')
      await expect(filterPanel).toBeVisible()
      const filterUserInput = filterPanel.getByRole('combobox').first()
      await typeIntoCombobox(page, filterUserInput, bobName)
      await expect(filterPanel.getByRole('option', { name: new RegExp(bobName) })).toBeVisible({ timeout: 10_000 })
      await filterPanel.getByRole('option', { name: new RegExp(bobName) }).first().click()
      await filterPanel.getByRole('button', { name: /Apply/i }).first().click()
      await expect(filterPanel).toBeHidden()

      await expect
        .poll(async () => (await page.getByText(bobName).count()) > 0, { timeout: 15_000 })
        .toBe(true)
      const page1Cells = page.locator('table tbody tr td:nth-child(2)')
      const page1Count = await page1Cells.count()
      for (let i = 0; i < page1Count; i += 1) {
        const text = (await page1Cells.nth(i).innerText()).trim()
        expect(RAW_UUID_PATTERN.test(text), `page 1 owner cell "${text}" should not be a raw UUID`).toBe(false)
      }

      const nextPageButton = page.getByRole('button', { name: 'Next page' })
      await expect(nextPageButton).toBeEnabled({ timeout: 10_000 })
      await nextPageButton.click()
      await expect
        .poll(async () => (await page.getByText(bobName).count()) > 0, { timeout: 15_000 })
        .toBe(true)
      const page2Cells = page.locator('table tbody tr td:nth-child(2)')
      const page2Count = await page2Cells.count()
      for (let i = 0; i < page2Count; i += 1) {
        const text = (await page2Cells.nth(i).innerText()).trim()
        expect(RAW_UUID_PATTERN.test(text), `page 2 owner cell "${text}" should not be a raw UUID`).toBe(false)
      }

      // Detail page shows the display name, not the raw id.
      await page.goto(`/backend/devices/${apiRegisteredDeviceId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(bobName)).toBeVisible({ timeout: 15_000 })

      // -- Degradation (devices.admin without auth.users.list) --------------------
      await loginAsCustomUser(page, `tc-dev-010-degraded-${suffix}@example.test`, degradedPassword)
      await page.goto('/backend/devices', { waitUntil: 'domcontentloaded' })
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.getByText(deviceIdValue)).toBeVisible({ timeout: 15_000 })
      // Without `auth.users.list` the batched lookup cannot resolve names, so cells fall back to ids.
      const degradedCells = page.locator('table tbody tr td:nth-child(2)')
      const degradedCount = await degradedCells.count()
      let sawRawId = false
      for (let i = 0; i < degradedCount; i += 1) {
        const text = (await degradedCells.nth(i).innerText()).trim()
        if (RAW_UUID_PATTERN.test(text)) sawRawId = true
      }
      expect(sawRawId, 'at least one owner cell should fall back to a bare id without auth.users.list').toBe(true)

      await page.goto('/backend/devices/create', { waitUntil: 'domcontentloaded' })
      const degradedUserField = page.locator('[data-crud-field-id="userId"]').first()
      const degradedUserInput = degradedUserField.getByRole('combobox').first()
      await typeIntoCombobox(page, degradedUserInput, aliceName)
      await expect(page.getByRole('option')).toHaveCount(0, { timeout: 5_000 })
    } finally {
      await deleteDeviceIfExists(request, adminToken, createdDeviceId)
      await deleteDeviceIfExists(request, adminToken, apiRegisteredDeviceId)
      for (const id of paginationDeviceIds) {
        await deleteDeviceIfExists(request, adminToken, id)
      }
      await deleteUserIfExists(request, adminToken, aliceId)
      await deleteUserIfExists(request, adminToken, bobId)
      await deleteUserIfExists(request, adminToken, degradedRoleUserId)
      await deleteRoleIfExists(request, adminToken, degradedRoleId)
    }
  })
})
