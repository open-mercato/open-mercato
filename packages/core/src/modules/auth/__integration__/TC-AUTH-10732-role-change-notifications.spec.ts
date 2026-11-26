import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi'

export const integrationMeta = { dependsOnModules: ['notifications'] }

const USERS = '/api/auth/users'
const messages = {
  en: {
    create: 'Create', save: 'Save', remove: 'Remove', bell: /\d+ unread notifications/,
    panel: 'Notifications', assigned: 'Roles assigned to your account:', revoked: 'Roles removed from your account:',
  },
  pl: {
    create: 'Utwórz', save: 'Zapisz', remove: 'Usuń', bell: /\d+ nieprzeczytanych powiadomień/,
    panel: 'Powiadomienia', assigned: 'Role przypisane do Twojego konta:', revoked: 'Role usunięte z Twojego konta:',
  },
}

type Locale = keyof typeof messages

async function signIn(page: Page, email: string, password: string, origin: string, locale: Locale): Promise<string> {
  const token = await getAuthToken(page.request, email, password)
  await acknowledgeGlobalNotices(page)
  await page.context().addCookies([{ name: 'locale', value: locale, url: origin }])
  return token
}

async function chooseRole(page: Page, roleName: string): Promise<void> {
  const roles = page.locator('[data-crud-field-id="roles"]')
  await roles.getByRole('textbox').fill(roleName)
  await roles.getByRole('button', { name: roleName, exact: true }).click()
}

async function submitUser(page: Page, button: string, method: 'POST' | 'PUT') {
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === method && new URL(candidate.url()).pathname === USERS)
  await page.getByRole('button', { name: button, exact: true }).first().click()
  return response
}

async function readUser(request: APIRequestContext, token: string, id: string) {
  const response = await apiRequest(request, 'GET', `${USERS}?id=${id}&pageSize=1`, { token })
  expect(response.ok(), 'read the owned user').toBe(true)
  const body = await readJsonSafe<{ items?: Array<{ name: string | null; roleIds: string[] }> }>(response)
  expect(body?.items).toHaveLength(1)
  return body?.items?.[0]
}

async function openNotifications(page: Page, locale: Locale) {
  await page.goto('/backend')
  await page.getByRole('button', { name: messages[locale].bell }).click()
  return page.getByRole('dialog', { name: messages[locale].panel, exact: true })
}

type UserFixture = { id: string; token?: string }
type Scenario = {
  adminToken: string
  editorToken: string
  recipientPage: Page
  recipientEmail: string
  password: string
  organizationId: string
  firstRole: { id: string; name: string }
  nextRole: { id: string; name: string }
  registerRecipient: (id: string) => Promise<{ id: string; token: string }>
  createRecipient: () => Promise<{ id: string; token: string }>
}

const test = base.extend<{ testLocale: Locale; scenario: Scenario }>({
  testLocale: ['en', { option: true }],
  scenario: [async ({ page, browser, request, baseURL, testLocale }, use) => {
    const origin = new URL(baseURL!).origin
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const stamp = randomUUID().slice(0, 12)
    const recipientEmail = `role-recipient-${stamp}@example.com`
    const editorEmail = `role-editor-${stamp}@example.com`
    const password = `Role-change-7-${randomUUID()}!`
    const roleIds: string[] = []
    const users: UserFixture[] = []
    const recipientContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })

    try {
      const setupRole = async (name: string) => {
        const id = await createRoleFixture(request, adminToken, { name, tenantId })
        roleIds.push(id)
        await setRoleAclFeatures(request, adminToken, {
          roleId: id, features: ['dashboards.view', 'notifications.view'], organizations: [organizationId],
        })
        return { id, name }
      }
      const firstRole = await setupRole(`Alpha warehouse team ${stamp}`)
      const nextRole = await setupRole(`Beta warehouse team ${stamp}`)
      const editor: UserFixture = {
        id: await createUserFixture(request, adminToken, {
          email: editorEmail, password, organizationId, roles: ['admin'],
        }),
      }
      users.push(editor)
      const editorToken = await signIn(page, editorEmail, password, origin, testLocale)
      editor.token = editorToken
      const recipientPage = await recipientContext.newPage()

      const registerRecipient = async (id: string) => {
        const recipient: UserFixture = { id }
        users.push(recipient)
        const token = await signIn(recipientPage, recipientEmail, password, origin, testLocale)
        recipient.token = token
        return { id, token }
      }
      const createRecipient = async () => registerRecipient(await createUserFixture(request, adminToken, {
        email: recipientEmail, password, organizationId, roles: [firstRole.id],
      }))

      await use({
        adminToken, editorToken, recipientPage, recipientEmail, password, organizationId,
        firstRole, nextRole, registerRecipient, createRecipient,
      })
    } finally {
      const cleanupFailures: unknown[] = []
      for (const user of users) {
        if (!user.token) continue
        try {
          const query = noticeQuery(user.id)
          const notices = await listNotifications(request, user.token, query)
          for (const { id } of notices.items) {
            const response = await apiRequest(request, 'PUT', `/api/notifications/${String(id)}/dismiss`, { token: user.token })
            expect(response.ok(), 'dismiss an owned role-change notice').toBe(true)
          }
          expect((await listNotifications(request, user.token, query)).total).toBe(0)
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      const fixtures = [
        ...users.map(({ id }) => ({ path: USERS, id })),
        ...roleIds.map((id) => ({ path: '/api/auth/roles', id })),
      ]
      for (const { path, id } of fixtures) {
        try {
          const response = await apiRequest(request, 'DELETE', `${path}?id=${id}`, { token: adminToken })
          expect(response.ok(), `delete owned fixture from ${path}`).toBe(true)
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      await recipientContext.close()
      expect(cleanupFailures, 'all owned notices, users and roles should be cleaned up').toEqual([])
    }
  }, { timeout: 60_000 }],
})

function noticeQuery(id: string) {
  return { sourceEntityType: 'auth:user', sourceEntityId: id, pageSize: 100 }
}

function roleTag(page: Page, locale: Locale, name: string) {
  return page.getByRole('button', { name: `${messages[locale].remove} ${name}`, exact: true })
}

async function changeRoles(page: Page, locale: Locale, scenario: Scenario) {
  await roleTag(page, locale, scenario.firstRole.name).click()
  await chooseRole(page, scenario.nextRole.name)
}

for (const locale of ['en', 'pl'] as const) {
  test.describe(`TC-AUTH-10732: named role-change notifications (${locale})`, () => {
    test.use({ testLocale: locale, viewport: { width: 390, height: 844 } })

    test('shows the assigned role on user creation only to the recipient', async ({ page, request, scenario }) => {
      await page.goto('/backend/users/create')
      await page.locator('[data-crud-field-id="organizationId"] select').selectOption(scenario.organizationId)
      await page.locator('[data-crud-field-id="email"] input').fill(scenario.recipientEmail)
      await page.locator('[data-crud-field-id="password"] input').fill(scenario.password)
      await chooseRole(page, scenario.firstRole.name)
      const created = await submitUser(page, messages[locale].create, 'POST')
      expect(created.status()).toBe(201)
      const record = (await created.json()) as { id?: string }
      const recipient = await scenario.registerRecipient(expectId(record.id, 'recipient id'))

      const panel = await openNotifications(scenario.recipientPage, locale)
      await expect(panel.getByText(`${messages[locale].assigned} ${scenario.firstRole.name}`, { exact: true })).toBeVisible()
      const query = noticeQuery(recipient.id)
      expect((await listNotifications(request, recipient.token, query)).total).toBe(1)
      expect((await listNotifications(request, scenario.editorToken, query)).total).toBe(0)
    })

    test('shows named assignment and revocation after replacement without duplicates on unchanged saves', async ({ page, request, scenario }) => {
      const recipient = await scenario.createRecipient()
      const editUrl = `/backend/users/${recipient.id}/edit`
      await page.goto(editUrl)
      await changeRoles(page, locale, scenario)
      expect((await submitUser(page, messages[locale].save, 'PUT')).status()).toBe(200)
      await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/)

      const panel = await openNotifications(scenario.recipientPage, locale)
      for (const text of [
        `${messages[locale].assigned} ${scenario.firstRole.name}`,
        `${messages[locale].assigned} ${scenario.nextRole.name}`,
        `${messages[locale].revoked} ${scenario.firstRole.name}`,
      ]) {
        await expect(panel.getByText(text, { exact: true })).toBeVisible()
      }
      const query = noticeQuery(recipient.id)
      const afterReplacement = await listNotifications(request, recipient.token, query)
      expect(afterReplacement.total).toBe(3)
      expect((await listNotifications(request, scenario.editorToken, query)).total).toBe(0)

      for (let save = 0; save < 2; save += 1) {
        await page.goto(editUrl)
        await expect(roleTag(page, locale, scenario.nextRole.name)).toBeVisible()
        expect((await submitUser(page, messages[locale].save, 'PUT')).status()).toBe(200)
        await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/)
      }
      const afterRepeatedSaves = await listNotifications(request, recipient.token, query)
      expect(afterRepeatedSaves.total).toBe(3)
      expect(afterRepeatedSaves.items.map(({ id }) => id)).toEqual(afterReplacement.items.map(({ id }) => id))
    })

    test('refuses a stale role edit without clobbering a concurrent display-name change or sending a notice', async ({ page, request, scenario }) => {
      const recipient = await scenario.createRecipient()
      const query = noticeQuery(recipient.id)
      const before = await listNotifications(request, recipient.token, query)
      expect(before.total).toBe(1)
      await page.goto(`/backend/users/${recipient.id}/edit`)
      await expect(roleTag(page, locale, scenario.firstRole.name)).toBeVisible()

      const concurrentName = `Concurrent update ${recipient.id}`
      const concurrent = await apiRequest(request, 'PUT', USERS, {
        token: scenario.adminToken, data: { id: recipient.id, name: concurrentName },
      })
      expect(concurrent.status()).toBe(200)
      await changeRoles(page, locale, scenario)
      expect((await submitUser(page, messages[locale].save, 'PUT')).status()).toBe(409)
      await expectConflictBanner(page)
      expect(await readUser(request, scenario.adminToken, recipient.id)).toMatchObject({
        name: concurrentName, roleIds: [scenario.firstRole.id],
      })
      expect(await listNotifications(request, recipient.token, query)).toEqual(before)
    })
  })
}
