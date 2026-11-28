import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

/**
 * TC-INT-013 (#9621): follow-up from #9601 (fixes #9108). The live QA scenario
 * already passed manually — this automates it so the credential destination
 * editor's refusal/recovery UX stays proven on every run, not just once.
 *
 * Covers, through the real `/backend/integrations/<id>` editor (not mocked
 * routes): masked-secret destination retargeting is refused (422, translated
 * inline feedback, unchanged persisted record/version) across SMTP/IMAP/Akeneo;
 * an explicit replacement clears the refusal and a reload retains it; a
 * distinct actor's concurrent save is preserved when a stale save conflicts
 * (409 → conflict bar → refresh → retry); English/Polish locale coverage; a
 * narrow viewport; and a Viewer without `integrations.credentials.manage`
 * gets 403 on a direct write. Live SMTP/IMAP/Akeneo transport probing
 * (health checks) is out of scope here — no owned transport-fixture
 * infrastructure exists yet for that, and this follow-up amends the existing
 * secret-editing spec rather than building it.
 *
 * API-level coverage for the underlying refusal across provider/secret pairs
 * already exists at `TC-INT-012-masked-secret-destinations.spec.ts`; this spec
 * proves the same contract through the actual editor UI.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const SAVE_LABEL = { en: 'Save Credentials', pl: 'Zapisz dane' } as const
const SAVED_FLASH = { en: 'Credentials saved', pl: 'Dane zapisane' } as const
const DESTINATION_CHANGED_MESSAGE = {
  en: 'Re-enter stored secrets after changing the connection destination.',
  pl: 'Po zmianie adresu docelowego połączenia wprowadź ponownie zapisane dane tajne.',
} as const
const CONFLICT_BANNER_TESTID = 'record-conflict-banner'

type Actor = { email: string; password: string; userId: string; token: string }

type ProviderCase = {
  id: string
  destination: string
  secret: string
  baseCredentials: Record<string, unknown>
  replacement: string
}

const PROVIDER_CASES: ProviderCase[] = [
  {
    id: 'channel_smtp',
    destination: 'host',
    secret: 'password',
    baseCredentials: {
      host: 'smtp.example.com',
      port: '587',
      tls: 'starttls',
      user: 'smtp-fixture-user',
      fromAddress: 'no-reply@example.com',
    },
    replacement: 'other.example.com',
  },
  {
    id: 'channel_imap',
    destination: 'imapHost',
    secret: 'imapPassword',
    baseCredentials: {
      imapHost: 'imap.example.com',
      imapPort: '993',
      imapTls: 'tls',
      imapUser: 'imap-fixture-user',
      smtpHost: 'smtp.example.com',
      smtpPort: '465',
      smtpTls: 'tls',
      smtpUser: 'smtp-fixture-user',
      smtpPassword: `fixture-${randomUUID()}`,
      fromAddress: 'no-reply@example.com',
    },
    replacement: 'other.example.com',
  },
  {
    id: 'sync_akeneo',
    destination: 'apiUrl',
    secret: 'clientSecret',
    baseCredentials: {
      apiUrl: 'https://akeneo.example.com',
      clientId: 'akeneo-fixture-client',
      username: 'akeneo-fixture-user',
      password: `fixture-${randomUUID()}`,
    },
    replacement: 'https://other.example.com',
  },
]

async function createActorFixture(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Actor> {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const email = `tc-int-013-${label}-${stamp}@example.com`
  const password = 'Str0ng-Test-Pass!'
  const userId = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId,
    roles: [roleId],
  })
  const token = await getAuthToken(request, email, password)
  return { email, password, userId, token }
}

async function signInWithToken(page: Page, token: string, locale?: 'en' | 'pl'): Promise<void> {
  const scope = getTokenScope(token)
  const cookies = [
    { name: 'auth_token', value: token, url: BASE_URL, sameSite: 'Lax' as const },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' as const },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' as const },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' as const },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL, sameSite: 'Lax' as const },
  ]
  if (locale === 'pl') cookies.push({ name: 'locale', value: 'pl', url: BASE_URL, sameSite: 'Lax' as const })
  await page.context().addCookies(cookies)
}

async function openIntegrationCredentials(page: Page, integrationId: string): Promise<void> {
  await page.goto(`/backend/integrations/${integrationId}`, { waitUntil: 'domcontentloaded' })
}

function fieldInput(page: Page, fieldKey: string) {
  return page.locator(`[data-crud-field-id="${fieldKey}"] input`).first()
}

async function seedCredentials(
  request: APIRequestContext,
  token: string,
  integrationId: string,
  credentials: Record<string, unknown>,
  unchangedSecretFields?: string[],
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/credentials`, {
    token,
    data: { credentials, unchangedSecretFields },
  })
  expect(response.status(), `seed PUT /api/integrations/${integrationId}/credentials should be 200`).toBe(200)
}

async function readCredentials(
  request: APIRequestContext,
  token: string,
  integrationId: string,
): Promise<{ credentials: Record<string, unknown>; secretFieldsConfigured: Record<string, boolean>; updatedAt: string | null }> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${integrationId}/credentials`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{
    credentials: Record<string, unknown>
    secretFieldsConfigured: Record<string, boolean>
    updatedAt: string | null
  }>(response)
  expect(body, `GET /api/integrations/${integrationId}/credentials should return a body`).toBeTruthy()
  return body!
}

test.describe('TC-INT-013: credential destination editor refusal and recovery (#9621)', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 })

  let adminToken = ''
  let organizationId = ''
  let managerRoleId: string | null = null
  let viewerRoleId: string | null = null
  let managerA: Actor | null = null
  let managerB: Actor | null = null
  let viewer: Actor | null = null

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    organizationId = await createOrganizationFixture(request, adminToken, {
      name: `issue-9621-${randomUUID()}`,
      tenantId,
    })

    managerRoleId = await createRoleFixture(request, adminToken, { name: `tc-int-013-manager-${Date.now()}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: managerRoleId,
      features: ['integrations.view', 'integrations.credentials.manage'],
    })
    viewerRoleId = await createRoleFixture(request, adminToken, { name: `tc-int-013-viewer-${Date.now()}` })
    await setRoleAclFeatures(request, adminToken, { roleId: viewerRoleId, features: ['integrations.view'] })

    managerA = await createActorFixture(request, adminToken, organizationId, managerRoleId, 'manager-a')
    managerB = await createActorFixture(request, adminToken, organizationId, managerRoleId, 'manager-b')
    viewer = await createActorFixture(request, adminToken, organizationId, viewerRoleId, 'viewer')
  })

  test.afterAll(async ({ request }) => {
    for (const integrationId of ['channel_smtp', 'channel_imap', 'sync_akeneo']) {
      if (!managerA) continue
      await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/credentials`, {
        token: managerA.token,
        data: { credentials: {} },
      }).catch(() => undefined)
    }
    await deleteUserIfExists(request, adminToken, managerA?.userId ?? null)
    await deleteUserIfExists(request, adminToken, managerB?.userId ?? null)
    await deleteUserIfExists(request, adminToken, viewer?.userId ?? null)
    await deleteRoleIfExists(request, adminToken, managerRoleId)
    await deleteRoleIfExists(request, adminToken, viewerRoleId)
    await deleteOrganizationIfExists(request, adminToken, organizationId)
  })

  for (const providerCase of PROVIDER_CASES) {
    test(`${providerCase.id}/${providerCase.secret}: the real credential editor refuses a masked-secret destination change (422, translated feedback, unchanged record)`, async ({ page, request }) => {
      const probe = await apiRequest(request, 'GET', `/api/integrations/${providerCase.id}/credentials`, { token: managerA!.token })
      test.skip(probe.status() === 404, `${providerCase.id} is not enabled in this build`)
      expect(probe.status()).toBe(200)

      const secretValue = `fixture-${randomUUID()}`
      await seedCredentials(request, managerA!.token, providerCase.id, {
        ...providerCase.baseCredentials,
        [providerCase.secret]: secretValue,
      })
      const before = await readCredentials(request, managerA!.token, providerCase.id)

      await signInWithToken(page, managerA!.token)
      await openIntegrationCredentials(page, providerCase.id)

      const destinationInput = fieldInput(page, providerCase.destination)
      await expect(destinationInput).toHaveValue(String(providerCase.baseCredentials[providerCase.destination]), { timeout: 15_000 })
      await fillControlledInput(destinationInput, providerCase.replacement)
      await page.getByRole('button', { name: SAVE_LABEL.en }).click()

      await expect(page.getByText(DESTINATION_CHANGED_MESSAGE.en, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(SAVED_FLASH.en, { exact: false })).toHaveCount(0)

      const after = await readCredentials(request, managerA!.token, providerCase.id)
      expect(after.credentials[providerCase.destination], 'destination must stay unchanged after a refused retarget').toBe(
        providerCase.baseCredentials[providerCase.destination],
      )
      expect(after.secretFieldsConfigured[providerCase.secret], 'the secret must remain configured').toBe(true)
      expect(after.updatedAt, 'a refused write must not bump the persisted version').toBe(before.updatedAt)
    })
  }

  test('channel_smtp: an explicit replacement clears the refusal, a same-click double submit is not duplicated, and a reload retains the saved data', async ({ page, request }) => {
    const probe = await apiRequest(request, 'GET', '/api/integrations/channel_smtp/credentials', { token: managerA!.token })
    test.skip(probe.status() === 404, 'channel_smtp is not enabled in this build')

    const baseFields = {
      host: 'recovery-smtp.example.com',
      port: '587',
      tls: 'starttls',
      user: 'smtp-fixture-user',
      fromAddress: 'no-reply@example.com',
    }
    const originalSecret = `fixture-${randomUUID()}`
    await seedCredentials(request, managerA!.token, 'channel_smtp', { ...baseFields, password: originalSecret })

    await signInWithToken(page, managerA!.token)
    await openIntegrationCredentials(page, 'channel_smtp')

    const hostInput = fieldInput(page, 'host')
    await expect(hostInput).toHaveValue(baseFields.host, { timeout: 15_000 })
    await fillControlledInput(hostInput, 'recovery-smtp-retarget.example.com')
    const saveButton = page.getByRole('button', { name: SAVE_LABEL.en })
    await saveButton.click()
    await expect(page.getByText(DESTINATION_CHANGED_MESSAGE.en, { exact: false }).first()).toBeVisible({ timeout: 10_000 })

    // Explicit replacement: also re-enter the secret so the destination change is intentional.
    const rotatedSecret = `rotated-${randomUUID()}`
    await fillControlledInput(fieldInput(page, 'password'), rotatedSecret)

    let saveRequestCount = 0
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/api/integrations/channel_smtp/credentials')) saveRequestCount += 1
    })

    // Fire a rapid double submit (click + Ctrl+Enter) without waiting between them.
    await saveButton.click()
    await fieldInput(page, 'password').press('Control+Enter').catch(() => {})

    await expect(page.getByText(SAVED_FLASH.en, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(DESTINATION_CHANGED_MESSAGE.en, { exact: false })).toHaveCount(0)
    await expect.poll(() => saveRequestCount, 'the in-flight-submit guard must not let a double trigger reach the server twice').toBe(1)

    const afterReplacement = await readCredentials(request, managerA!.token, 'channel_smtp')
    expect(afterReplacement.credentials.host).toBe('recovery-smtp-retarget.example.com')
    expect(afterReplacement.secretFieldsConfigured.password).toBe(true)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(DESTINATION_CHANGED_MESSAGE.en, { exact: false })).toHaveCount(0)
    await expect(fieldInput(page, 'host')).toHaveValue('recovery-smtp-retarget.example.com', { timeout: 15_000 })
  })

  test("channel_smtp: a distinct actor B's save is preserved when actor A's stale save conflicts, then refresh and retry recover", async ({ page, request }) => {
    const probe = await apiRequest(request, 'GET', '/api/integrations/channel_smtp/credentials', { token: managerA!.token })
    test.skip(probe.status() === 404, 'channel_smtp is not enabled in this build')

    const baseFields = {
      host: 'conflict-smtp.example.com',
      port: '587',
      tls: 'starttls',
      user: 'smtp-fixture-user',
      fromAddress: 'original@example.com',
    }
    const secretValue = `fixture-${randomUUID()}`
    await seedCredentials(request, managerA!.token, 'channel_smtp', { ...baseFields, password: secretValue })

    await signInWithToken(page, managerA!.token)
    await openIntegrationCredentials(page, 'channel_smtp')
    // Actor A edits a plain field (not the masked-secret-guarded destination),
    // so this isolates the optimistic-lock conflict from the separate
    // destination-changed refusal covered by the earlier tests.
    const userInput = fieldInput(page, 'user')
    await expect(userInput).toHaveValue(baseFields.user, { timeout: 15_000 })

    // Distinct actor B advances the record out-of-band (header-less PUT always
    // succeeds), making manager A's in-browser lock token stale.
    await seedCredentials(
      request,
      managerB!.token,
      'channel_smtp',
      { ...baseFields, fromAddress: 'bumped-by-manager-b@example.com' },
      ['password'],
    )

    await fillControlledInput(userInput, 'actor-a-stale-user')
    await page.getByRole('button', { name: SAVE_LABEL.en }).click()
    await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toBeVisible({ timeout: 10_000 })

    const afterConflict = await readCredentials(request, managerA!.token, 'channel_smtp')
    expect(afterConflict.credentials.fromAddress, "actor B's concurrent save must survive actor A's refused stale write").toBe(
      'bumped-by-manager-b@example.com',
    )
    expect(afterConflict.credentials.user, "actor A's stale write must never land").toBe(baseFields.user)

    await page.getByTestId(CONFLICT_BANNER_TESTID).getByRole('button', { name: /refresh/i }).click()
    await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0)
    await expect(userInput).toHaveValue(baseFields.user, { timeout: 15_000 })

    await fillControlledInput(userInput, 'actor-a-retry-user')
    await page.getByRole('button', { name: SAVE_LABEL.en }).click()
    await expect(page.getByText(SAVED_FLASH.en, { exact: false }).first()).toBeVisible({ timeout: 10_000 })

    const afterRetry = await readCredentials(request, managerA!.token, 'channel_smtp')
    expect(afterRetry.credentials.user).toBe('actor-a-retry-user')
  })

  test('sync_akeneo: the destination-change refusal shows the Polish translated feedback under the pl locale', async ({ page, request }) => {
    const probe = await apiRequest(request, 'GET', '/api/integrations/sync_akeneo/credentials', { token: managerA!.token })
    test.skip(probe.status() === 404, 'sync_akeneo is not enabled in this build')

    const baseFields = {
      apiUrl: 'https://akeneo-pl.example.com',
      clientId: 'akeneo-fixture-client',
      username: 'akeneo-fixture-user',
    }
    const secretValue = `fixture-${randomUUID()}`
    await seedCredentials(request, managerA!.token, 'sync_akeneo', { ...baseFields, clientSecret: secretValue, password: secretValue })

    await signInWithToken(page, managerA!.token, 'pl')
    await openIntegrationCredentials(page, 'sync_akeneo')

    const apiUrlInput = fieldInput(page, 'apiUrl')
    await expect(apiUrlInput).toHaveValue(baseFields.apiUrl, { timeout: 15_000 })
    await fillControlledInput(apiUrlInput, 'https://other-akeneo.example.com')
    await page.getByRole('button', { name: SAVE_LABEL.pl }).click()

    await expect(page.getByText(DESTINATION_CHANGED_MESSAGE.pl, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(SAVED_FLASH.pl, { exact: false })).toHaveCount(0)

    const after = await readCredentials(request, managerA!.token, 'sync_akeneo')
    expect(after.credentials.apiUrl).toBe(baseFields.apiUrl)
  })

  test('channel_smtp: the destination-change refusal remains usable at a narrow (390px) viewport', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const probe = await apiRequest(request, 'GET', '/api/integrations/channel_smtp/credentials', { token: managerA!.token })
    test.skip(probe.status() === 404, 'channel_smtp is not enabled in this build')

    const baseFields = {
      host: 'narrow-smtp.example.com',
      port: '587',
      tls: 'starttls',
      user: 'smtp-fixture-user',
      fromAddress: 'no-reply@example.com',
    }
    const secretValue = `fixture-${randomUUID()}`
    await seedCredentials(request, managerA!.token, 'channel_smtp', { ...baseFields, password: secretValue })

    await signInWithToken(page, managerA!.token)
    await openIntegrationCredentials(page, 'channel_smtp')

    const hostInput = fieldInput(page, 'host')
    await expect(hostInput).toHaveValue(baseFields.host, { timeout: 15_000 })
    await fillControlledInput(hostInput, 'narrow-smtp-retarget.example.com')
    await page.getByRole('button', { name: SAVE_LABEL.en }).click()

    await expect(page.getByText(DESTINATION_CHANGED_MESSAGE.en, { exact: false }).first()).toBeVisible({ timeout: 10_000 })

    const after = await readCredentials(request, managerA!.token, 'channel_smtp')
    expect(after.credentials.host).toBe(baseFields.host)
  })

  test('a Viewer without integrations.credentials.manage gets 403 on a direct credentials write', async ({ request }) => {
    const response = await apiRequest(request, 'PUT', '/api/integrations/channel_smtp/credentials', {
      token: viewer!.token,
      data: { credentials: { host: 'viewer-should-not-write.example.com' } },
    })
    expect(response.status(), 'a Viewer must be refused a direct credentials write').toBe(403)
  })
})
