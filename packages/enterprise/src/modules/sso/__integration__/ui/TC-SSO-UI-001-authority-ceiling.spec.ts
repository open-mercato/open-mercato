import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-SSO-UI-001: SSO config page surfaces authority-ceiling refusals
 * Source: QA evidence on PR #10070 (silent 403 on the SSO config page).
 * Also covers D1: 404s on a config deleted elsewhere render in the user's locale.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))

function loadDictionary(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(integrationDirectory, `../../i18n/${locale}.json`), 'utf8')) as Record<string, string>
}

type CeilingFixture = {
  adminToken: string
  managerEmail: string
  managerPassword: string
  managerToken: string
  managerRoleName: string
  privilegedRoleName: string
  organizationId: string
  tenantId: string
  configId: string
}

async function withCeilingFixture(
  request: APIRequestContext,
  run: (fixture: CeilingFixture) => Promise<void>,
): Promise<void> {
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenScope(adminToken)
  expect(tenantId).toBeTruthy()
  const stamp = randomUUID()
  const roleIds: string[] = []
  const userIds: string[] = []
  let organizationId: string | null = null
  let configId: string | null = null
  try {
    organizationId = await createOrganizationFixture(request, adminToken, { name: `SSO UI ceiling ${stamp}`, tenantId })
    const managerRoleName = `sso-ui-manager-${stamp}`
    const managerRoleId = await createRoleFixture(request, adminToken, { name: managerRoleName, tenantId })
    roleIds.push(managerRoleId)
    await setRoleAclFeatures(request, adminToken, {
      roleId: managerRoleId,
      features: ['sso.config.view', 'sso.config.manage', 'sso.scim.manage', 'auth.roles.list'],
      organizations: null,
    })
    const privilegedRoleName = `sso-ui-privileged-${stamp}`
    const privilegedRoleId = await createRoleFixture(request, adminToken, { name: privilegedRoleName, tenantId })
    roleIds.push(privilegedRoleId)
    await setRoleAclFeatures(request, adminToken, {
      roleId: privilegedRoleId,
      features: ['auth.users.manage', 'auth.roles.manage'],
      organizations: null,
    })
    const managerEmail = `sso-ui-manager-${stamp}@example.com`
    const managerPassword = `Test-${randomUUID()}!`
    userIds.push(await createUserFixture(request, adminToken, {
      email: managerEmail,
      password: managerPassword,
      organizationId,
      roles: [managerRoleId],
      name: 'SSO UI ceiling manager',
    }))
    const managerToken = await getAuthToken(request, managerEmail, managerPassword)
    const created = await apiRequest(request, 'POST', '/api/sso/config', {
      token: managerToken,
      data: {
        name: `SSO UI ceiling ${stamp}`,
        organizationId,
        tenantId,
        protocol: 'oidc',
        issuer: 'https://idp.example.com',
        clientId: `sso-ui-${stamp}`,
        clientSecret: randomUUID(),
        allowedDomains: [`sso-ui-${stamp.slice(0, 8)}.example.com`],
        jitEnabled: false,
        autoLinkByEmail: true,
        appRoleMappings: {},
      },
    })
    expect(created.status()).toBe(201)
    configId = (await readJsonSafe<{ id: string }>(created))?.id ?? null
    expect(configId).toBeTruthy()
    await run({
      adminToken,
      managerEmail,
      managerPassword,
      managerToken,
      managerRoleName,
      privilegedRoleName,
      organizationId,
      tenantId,
      configId: configId!,
    })
  } finally {
    if (configId) {
      await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
        token: adminToken, data: { active: false },
      }).catch(() => undefined)
      await apiRequest(request, 'DELETE', `/api/sso/config/${configId}`, { token: adminToken }).catch(() => undefined)
      const cleanupConfigId = configId
      await withClient(async (client) => {
        await client.query('delete from scim_tokens where sso_config_id = $1', [cleanupConfigId])
        await client.query('delete from sso_configs where id = $1', [cleanupConfigId])
      })
    }
    for (const userId of userIds) await deleteUserIfExists(request, adminToken, userId)
    for (const roleId of [...roleIds].reverse()) await deleteRoleIfExists(request, adminToken, roleId)
    await deleteOrganizationIfExists(request, adminToken, organizationId)
  }
}

async function signInAsManager(page: Page, fixture: CeilingFixture, locale: string): Promise<void> {
  await acknowledgeGlobalNotices(page)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'locale', value: locale, url: baseUrl, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: fixture.tenantId, url: baseUrl, sameSite: 'Lax' },
    { name: 'om_selected_org', value: fixture.organizationId, url: baseUrl, sameSite: 'Lax' },
  ])
  const form = new URLSearchParams()
  form.set('email', fixture.managerEmail)
  form.set('password', fixture.managerPassword)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok()).toBeTruthy()
}

async function openConfig(page: Page, fixture: CeilingFixture, dict: Record<string, string>): Promise<void> {
  await page.goto(`/backend/sso/config/${fixture.configId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: dict['sso.admin.tab.roles'], exact: true })).toBeVisible({ timeout: 20_000 })
}

function waitForConfigWrite(page: Page, fixture: CeilingFixture, suffix = '', method = 'PUT') {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === `/api/sso/config/${fixture.configId}${suffix}` && response.request().method() === method
  })
}

async function addRoleMapping(page: Page, dict: Record<string, string>, idpRole: string, localRole: string): Promise<void> {
  const localRoleSelect = page.getByRole('combobox')
  await expect(localRoleSelect.locator('option', { hasText: localRole })).toHaveCount(1, { timeout: 15_000 })
  await page.getByPlaceholder(dict['sso.admin.roles.idpRolePlaceholder']).fill(idpRole)
  await localRoleSelect.selectOption(localRole)
  await page.getByRole('button', { name: dict['common.add'], exact: true }).click()
}

test('TC-SSO-UI-002: rejects a stale General save and uses the refreshed configuration on retry', async ({ page, request }) => {
  test.setTimeout(120_000)
  const dict = loadDictionary('en')
  await withCeilingFixture(request, async (fixture) => {
    await signInAsManager(page, fixture, 'en')
    const configPath = `/api/sso/config/${fixture.configId}`
    const loadedConfigResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === configPath && response.request().method() === 'GET' && response.ok(),
    )
    await openConfig(page, fixture, dict)
    const loadedConfig = await (await loadedConfigResponse).json() as { name: string; updatedAt: string }
    expect(loadedConfig.updatedAt).toBeTruthy()
    const expected = loadedConfig.updatedAt
    const nameInput = page.getByLabel(dict['sso.admin.field.name'], { exact: true })
    const clientIdInput = page.getByLabel(dict['sso.admin.field.clientId'], { exact: true })
    const save = page.getByRole('button', { name: dict['common.save'], exact: true })
    await nameInput.fill('Renamed by manager')

    const writes = await Promise.all(['concurrent-client-first', 'concurrent-client-second'].map((clientId) =>
      apiRequest(request, 'PUT', configPath, {
        token: fixture.adminToken,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: expected },
        data: { clientId, autoLinkByEmail: false },
      }),
    ))
    expect(writes.map((response) => response.status()).sort()).toEqual([200, 409])
    const winner = await writes.find((response) => response.ok())!.json() as { clientId: string; updatedAt: string }
    expect(winner.updatedAt).toBeTruthy()
    expect(winner.updatedAt).not.toBe(expected)

    const staleSave = waitForConfigWrite(page, fixture)
    await save.click()
    const conflict = await staleSave
    expect(conflict.status()).toBe(409)
    expect(await conflict.json()).toMatchObject({
      code: 'optimistic_lock_conflict',
      expectedUpdatedAt: expected,
      currentUpdatedAt: winner.updatedAt,
    })
    await expect(nameInput).toHaveValue('Renamed by manager')

    const banner = page.getByTestId('record-conflict-banner')
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(clientIdInput).toHaveValue(winner.clientId)
    await expect(nameInput).toHaveValue(loadedConfig.name)

    await nameInput.fill('Renamed after refresh')
    const retry = waitForConfigWrite(page, fixture)
    await save.click()
    const saved = await retry
    expect(saved.status()).toBe(200)
    expect(await saved.json()).toMatchObject({
      name: 'Renamed after refresh', clientId: winner.clientId, autoLinkByEmail: false,
    })
    await expect(page.getByTestId('sso-general-unsaved')).toHaveCount(0)

    await nameInput.fill('Renamed again')
    const nextSave = waitForConfigWrite(page, fixture)
    await save.click()
    expect((await nextSave).status()).toBe(200)
  })
})

for (const locale of ['en', 'pl']) {
  test.describe(`TC-SSO-UI-001: SSO authority ceiling refusals are visible (${locale})`, () => {
    test('shows the translated refusal for an over-privileged role mapping and keeps it unsaved', async ({ page, request }) => {
      test.setTimeout(120_000)
      const dict = loadDictionary(locale)
      const ceilingMessage = dict['sso.errors.authorityCeilingExceeded']
      expect(ceilingMessage).toBeTruthy()
      await withCeilingFixture(request, async (fixture) => {
        await signInAsManager(page, fixture, locale)
        await openConfig(page, fixture, dict)
        await page.getByRole('button', { name: dict['sso.admin.tab.roles'], exact: true }).click()

        await addRoleMapping(page, dict, 'idp-admins', fixture.privilegedRoleName)
        await expect(page.getByTestId('sso-role-mappings-unsaved')).toBeVisible()
        const refused = waitForConfigWrite(page, fixture)
        await page.getByRole('button', { name: dict['common.save'], exact: true }).click()
        expect((await refused).status()).toBe(403)
        await expect(page.getByTestId('sso-role-mappings-save-error')).toHaveText(ceilingMessage)
        await expect(page.getByTestId('sso-role-mappings-unsaved')).toBeVisible()

        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: dict['sso.admin.tab.roles'], exact: true }).click()
        await expect(page.getByText(dict['sso.admin.roles.empty'])).toBeVisible()
        await expect(page.getByText('idp-admins', { exact: true })).toHaveCount(0)

        await addRoleMapping(page, dict, 'idp-staff', fixture.managerRoleName)
        const accepted = waitForConfigWrite(page, fixture)
        await page.getByRole('button', { name: dict['common.save'], exact: true }).click()
        expect((await accepted).status()).toBe(200)
        await expect(page.getByText(dict['sso.admin.roles.saved']).first()).toBeVisible()

        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: dict['sso.admin.tab.roles'], exact: true }).click()
        await expect(page.getByText('idp-staff', { exact: true })).toBeVisible()
      })
    })

    test('shows the translated refusal for General save and Activate on an over-privileged config', async ({ page, request }) => {
      test.setTimeout(120_000)
      const dict = loadDictionary(locale)
      const ceilingMessage = dict['sso.errors.authorityCeilingExceeded']
      await withCeilingFixture(request, async (fixture) => {
        const elevated = await apiRequest(request, 'PUT', `/api/sso/config/${fixture.configId}`, {
          token: fixture.adminToken,
          data: { appRoleMappings: { 'idp-admins': fixture.privilegedRoleName } },
        })
        expect(elevated.status()).toBe(200)

        await signInAsManager(page, fixture, locale)
        await openConfig(page, fixture, dict)

        const nameInput = page.getByLabel(dict['sso.admin.field.name'], { exact: true })
        await nameInput.fill(`Renamed ${randomUUID()}`)
        await expect(page.getByTestId('sso-general-unsaved')).toBeVisible()
        const refusedSave = waitForConfigWrite(page, fixture)
        await page.getByRole('button', { name: dict['common.save'], exact: true }).click()
        expect((await refusedSave).status()).toBe(403)
        await expect(page.getByTestId('sso-general-save-error')).toHaveText(ceilingMessage)
        await expect(page.getByTestId('sso-general-unsaved')).toBeVisible()

        const refusedActivation = waitForConfigWrite(page, fixture, '/activate', 'POST')
        await page.getByRole('button', { name: dict['sso.admin.action.activate'], exact: true }).click()
        expect((await refusedActivation).status()).toBe(403)
        await expect(page.getByTestId('sso-activation-error')).toHaveText(ceilingMessage)
      })
    })

    test('shows the translated not-found error for domain and delete actions on a config deleted elsewhere', async ({ page, request }) => {
      test.setTimeout(120_000)
      const dict = loadDictionary(locale)
      const notFoundMessage = dict['sso.admin.error.notFound']
      expect(notFoundMessage).toBeTruthy()
      await withCeilingFixture(request, async (fixture) => {
        await signInAsManager(page, fixture, locale)
        await openConfig(page, fixture, dict)
        await page.getByRole('button', { name: dict['sso.admin.tab.domains'], exact: true }).click()
        const existingDomain = (await page.locator('code').first().textContent())?.trim() ?? ''
        expect(existingDomain).toBeTruthy()

        const deletedElsewhere = await apiRequest(request, 'DELETE', `/api/sso/config/${fixture.configId}`, { token: fixture.adminToken })
        expect(deletedElsewhere.status()).toBe(200)

        await page.getByPlaceholder(dict['sso.admin.wizard.domains.placeholder']).fill(`added-${randomUUID().slice(0, 8)}.example.com`)
        const refusedAdd = waitForConfigWrite(page, fixture, '/domains', 'POST')
        await page.getByRole('button', { name: dict['common.add'], exact: true }).click()
        const addResponse = await refusedAdd
        expect(addResponse.status()).toBe(404)
        expect((await addResponse.json()).error).toBe(notFoundMessage)
        await expect(page.getByText(notFoundMessage).first()).toBeVisible()

        const domainRow = page.locator('div', { has: page.getByText(existingDomain, { exact: true }) }).last()
        const refusedRemove = waitForConfigWrite(page, fixture, '/domains', 'DELETE')
        await domainRow.getByRole('button', { name: dict['common.remove'], exact: true }).click()
        const removeResponse = await refusedRemove
        expect(removeResponse.status()).toBe(404)
        expect((await removeResponse.json()).error).toBe(notFoundMessage)

        await page.getByRole('button', { name: dict['common.delete'], exact: true }).first().click()
        const refusedDelete = waitForConfigWrite(page, fixture, '', 'DELETE')
        await page.getByRole('alertdialog').getByRole('button', { name: dict['common.delete'], exact: true }).click()
        const deleteResponse = await refusedDelete
        expect(deleteResponse.status()).toBe(404)
        expect((await deleteResponse.json()).error).toBe(notFoundMessage)
        await expect(page.getByText(notFoundMessage).first()).toBeVisible()
        if (locale !== 'en') {
          await expect(page.getByText(loadDictionary('en')['sso.admin.error.notFound'])).toHaveCount(0)
        }
      })
    })
  })
}
