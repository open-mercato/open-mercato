import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test as base, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { seedConnectedChannel } from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import {
  createOrganizationInDb,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['channel_gmail'],
  requiredEnvVars: ['OM_ENABLE_TEST_CHANNEL_SEEDING'],
}

const profilePath = '/backend/profile/communication-channels'
const channelsPath = '/api/communication_channels/me/channels'
const connectFeature = 'communication_channels.connect_user_channel'

type WatchCase = {
  displayName: string
  pushStatus: 'active' | 'failed'
  watchExpirationMs?: number
  pushExpired: boolean
  label: string
  canRegister: boolean
}

type WatchFixture = WatchCase & { id: string }

type Fixtures = {
  ownerToken: string
  sameOrgToken: string
  otherOrgToken: string
  noConnectToken: string
  channels: WatchFixture[]
}

const test = base.extend<object, { watches: Fixtures }>({
  watches: [async ({}, use, workerInfo) => {
    const request = await playwrightRequest.newContext({ baseURL: workerInfo.project.use.baseURL })
    const suffix = randomUUID()
    const organizationIds: string[] = []
    const roleIds: string[] = []
    const userIds: string[] = []
    const channels: WatchFixture[] = []
    let adminToken: string | null = null
    let ownerScope: ReturnType<typeof getTokenScope> | null = null
    try {
      const bootstrapToken = await getAuthToken(request, 'admin')
      adminToken = bootstrapToken
      const { tenantId } = getTokenScope(bootstrapToken)
      const ownerOrganization = await createOrganizationInDb({ tenantId, name: `Watch expiry owner ${suffix}` })
      organizationIds.push(ownerOrganization)
      const otherOrganization = await createOrganizationInDb({ tenantId, name: `Watch expiry other ${suffix}` })
      organizationIds.push(otherOrganization)

      const createRole = async (name: string, features: string[]) => {
        const roleId = await createRoleFixture(request, bootstrapToken, { tenantId, name: `watch-${name}-${suffix}` })
        roleIds.push(roleId)
        await setRoleAclFeatures(request, bootstrapToken, { roleId, features })
        return roleId
      }
      const connectRole = await createRole('connect', [connectFeature])
      const noConnectRole = await createRole('no-connect', [])
      const createUser = async (name: string, organizationId: string, roleId: string) => {
        const email = `watch-${name}-${suffix}@example.com`
        const password = `Watch-${suffix}!aA1`
        const userId = await createUserFixture(request, bootstrapToken, { email, password, organizationId, roles: [roleId] })
        userIds.push(userId)
        return getAuthToken(request, email, password)
      }
      const ownerToken = await createUser('owner', ownerOrganization, connectRole)
      const sameOrgToken = await createUser('peer', ownerOrganization, connectRole)
      const otherOrgToken = await createUser('other', otherOrganization, connectRole)
      const noConnectToken = await createUser('restricted', ownerOrganization, noConnectRole)
      const scope = getTokenScope(ownerToken)
      ownerScope = scope
      expect(scope.organizationId).toBe(ownerOrganization)
      expect(getTokenScope(sameOrgToken).organizationId).toBe(ownerOrganization)
      expect(getTokenScope(otherOrgToken).organizationId).toBe(otherOrganization)
      expect(getTokenScope(noConnectToken).organizationId).toBe(ownerOrganization)

      const day = 86_400_000
      const yesterday = Date.now() - day
      const cases: WatchCase[] = [
        {
          displayName: 'Expired Gmail watch with a long mailbox name for the mobile layout',
          pushStatus: 'active',
          watchExpirationMs: yesterday,
          pushExpired: true,
          label: 'Push expired — re-register to resume delivery',
          canRegister: true,
        },
        {
          displayName: 'Live Gmail watch',
          pushStatus: 'active',
          watchExpirationMs: yesterday + 8 * day,
          pushExpired: false,
          label: 'Push active',
          canRegister: false,
        },
        {
          displayName: 'Gmail watch without stored expiry',
          pushStatus: 'active',
          pushExpired: false,
          label: 'Push active',
          canRegister: false,
        },
        {
          displayName: 'Failed Gmail watch',
          pushStatus: 'failed',
          watchExpirationMs: yesterday,
          pushExpired: false,
          label: 'Push failed — using polling',
          canRegister: true,
        },
      ]
      for (const [index, watch] of cases.entries()) {
        const id = await seedConnectedChannel(request, ownerToken, {
          displayName: watch.displayName,
          externalIdentifier: `watch-${suffix}-${index}@example.com`,
        })
        channels.push({ ...watch, id })
      }
      await withClient(async (client) => {
        for (const watch of channels) {
          const state = { pushStatus: watch.pushStatus, watchExpirationMs: watch.watchExpirationMs }
          const result = await client.query(
            `update communication_channels
                set provider_key = 'gmail', channel_state = $1::jsonb, credentials_ref = null
              where id = $2 and tenant_id = $3 and organization_id = $4 and user_id = $5`,
            [JSON.stringify(state), watch.id, tenantId, ownerOrganization, scope.userId],
          )
          expect(result.rowCount).toBe(1)
        }
      })
      await use({ ownerToken, sameOrgToken, otherOrgToken, noConnectToken, channels })
    } finally {
      const cleanupErrors: unknown[] = []
      const cleanup = async (operation: () => Promise<unknown>) => {
        try {
          await operation()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      const token = adminToken
      await cleanup(async () => {
        if (ownerScope) {
          const { tenantId, organizationId, userId } = ownerScope
          await withClient((client) => client.query(
            `delete from communication_channels
              where id = any($1::uuid[]) and tenant_id = $2 and organization_id = $3 and user_id = $4`,
            [channels.map(({ id }) => id), tenantId, organizationId, userId],
          ))
        }
      })
      if (token) {
        for (const [resource, ids] of [['users', userIds], ['roles', roleIds]] as const) {
          for (const id of ids) {
            await cleanup(async () => {
              const response = await apiRequest(request, 'DELETE', `/api/auth/${resource}?id=${id}`, { token })
              expect(response.ok(), `Delete fixture ${resource}/${id} (HTTP ${response.status()})`).toBe(true)
            })
          }
        }
      }
      for (const id of organizationIds) {
        await cleanup(() => deleteIntegrationCredentialsInDb(id))
        await cleanup(() => deleteOrganizationInDb(id))
      }
      await cleanup(() => request.dispose())
      expect(cleanupErrors, 'Owned fixture cleanup').toEqual([])
    }
  }, { scope: 'worker', timeout: 60_000 }],
})

async function openProfile(page: Page, baseURL: string, token: string, locale: 'en' | 'pl' = 'en') {
  await page.context().addCookies([
    { name: 'auth_token', value: token, url: baseURL },
    { name: 'locale', value: locale, url: baseURL },
  ])
  await acknowledgeGlobalNotices(page)
  await page.goto(profilePath)
}

test.describe('TC-CHANNEL-EMAIL-033: Gmail watch expiry in the profile', () => {
  test('serializes each stored state and offers re-registration for expired or failed watches', async ({ page, baseURL, watches }) => {
    const list = page.waitForResponse((response) =>
      new URL(response.url()).pathname === channelsPath && response.request().method() === 'GET',
    )
    await openProfile(page, baseURL!, watches.ownerToken)
    const response = await list
    expect(response.status()).toBe(200)
    const body: { items: unknown[]; total: number } = await response.json()
    expect(body.total).toBe(watches.channels.length)

    for (const watch of watches.channels) {
      expect(body.items).toContainEqual(expect.objectContaining({
        id: watch.id,
        displayName: watch.displayName,
        providerKey: 'gmail',
        supportsPushRegistration: true,
        pushStatus: watch.pushStatus,
        pushExpired: watch.pushExpired,
        pushExpiresAt: watch.watchExpirationMs === undefined ? null : new Date(watch.watchExpirationMs).toISOString(),
      }))
      const row = page.getByRole('row').filter({ hasText: watch.displayName })
      await expect(row.getByText(watch.label, { exact: true })).toBeVisible()
      await row.getByRole('button', { name: 'Open actions' }).click()
      const menu = page.getByRole('menu')
      await expect(menu.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeVisible()
      await expect(menu.getByRole('menuitem', { name: 'Re-register push', exact: true })).toHaveCount(watch.canRegister ? 1 : 0)
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }
  })

  test('keeps the Polish expiry label and row action usable on mobile', async ({ page, baseURL, watches }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openProfile(page, baseURL!, watches.ownerToken, 'pl')
    const row = page.getByRole('row').filter({ hasText: watches.channels[0].displayName })
    const badge = row.getByText('Push wygasł — zarejestruj ponownie, aby wznowić dostarczanie', { exact: true })
    const documentOverflow = () => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    await badge.scrollIntoViewIfNeeded()
    await expect(badge).toBeInViewport({ ratio: 1 })
    await expect.poll(documentOverflow).toBeLessThanOrEqual(1)

    await row.getByRole('button', { name: 'Otwórz akcje' }).click()
    await expect(page.getByRole('menuitem', { name: 'Zarejestruj push ponownie', exact: true })).toBeInViewport({ ratio: 1 })
    await expect.poll(documentOverflow).toBeLessThanOrEqual(1)
  })

  test('keeps owner channels and their registration route private', async ({ page, baseURL, watches }) => {
    const registerPath = `/api/communication_channels/channels/${watches.channels[0].id}/push/register`
    expect((await page.request.get(channelsPath)).status()).toBe(401)

    for (const token of [watches.sameOrgToken, watches.otherOrgToken]) {
      const response = await apiRequest(page.request, 'GET', channelsPath, { token })
      expect(response.status()).toBe(200)
      expect(await readJsonSafe(response)).toMatchObject({ items: [], total: 0 })
      expect((await apiRequest(page.request, 'POST', registerPath, { token })).status()).toBe(404)
    }
    expect((await apiRequest(page.request, 'GET', channelsPath, { token: watches.noConnectToken })).status()).toBe(403)
    expect((await apiRequest(page.request, 'POST', registerPath, { token: watches.noConnectToken })).status()).toBe(403)

    await openProfile(page, baseURL!, watches.sameOrgToken)
    await expect(page.getByText('You have no connected channels yet.', { exact: false })).toBeVisible()
    await openProfile(page, baseURL!, watches.noConnectToken)
    await expect(page.getByText('Access Denied', { exact: true })).toBeVisible()
    await expect(page.getByText(watches.channels[0].displayName, { exact: true })).toHaveCount(0)
  })
})
