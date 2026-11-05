import { randomUUID } from 'node:crypto'
import { expect, test as base, type Page, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import english from '../../i18n/en.json' with { type: 'json' }
import polish from '../../i18n/pl.json' with { type: 'json' }

export const nativeKeys = ['Enter', 'Space'] as const
export const actionNames = ['Approve', 'Reject', 'Complete', 'View'] as const
export const notificationMessages = { en: english, pl: polish }

type KeyboardFixture = {
  id: string
  title: string
  origin: string
  parentHref: string
  actionHref: string
  before: Record<string, unknown>
  read: (status?: string) => Promise<Record<string, unknown>>
  expectUnrelatedNotificationUnchanged: () => Promise<void>
}

export const test = base.extend<{ keyboardFixture: KeyboardFixture }>({
  keyboardFixture: async ({ request, page, baseURL }, use) => {
    expect(baseURL, 'the native runner should provide the application URL').toBeTruthy()
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenScope(adminToken)
    const stamp = randomUUID()
    const type = `qa.notifications.keyboard.${stamp}`
    const email = `notification-keys-${stamp}@example.com`
    const password = `Keyboard-7-${randomUUID()}!`
    const title = `Native keyboard ${stamp}`
    const parentHref = `/backend?notificationCard=${stamp}`
    const actionHref = `/backend?notificationAction=${stamp}`
    let roleId: string | null = null
    let userId: string | null = null
    let token: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `notification-keys-${stamp}`, tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['notifications.view', 'notifications.create', 'dashboards.view'],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: `Notification keyboard ${stamp}`,
      })
      const actorToken = await getAuthToken(page.request, email, password)
      token = actorToken
      const notificationId = await createNotificationFixture(request, actorToken, {
        recipientUserId: userId,
        type,
        title,
        body: `Unchanged body ${stamp}`,
        severity: 'warning',
        icon: 'check',
        sourceModule: 'notifications',
        sourceEntityType: 'keyboard_fixture',
        sourceEntityId: randomUUID(),
        linkHref: parentHref,
        primaryActionId: 'approve',
        data: { marker: stamp },
        channels: ['in_app'],
        actions: actionNames.map((label) => ({
          id: label.toLowerCase(),
          label,
          ...(label === 'View' ? { href: actionHref } : {}),
        })),
      })
      const unrelatedId = await createNotificationFixture(request, actorToken, {
        recipientUserId: userId,
        type,
        title: `Untouched notification ${stamp}`,
        body: `Untouched body ${stamp}`,
        channels: ['in_app'],
      })
      const read = async (id: string, status?: string) => {
        const { items } = await listNotifications(request, actorToken, { type, status, pageSize: 100 })
        const notification = items.find((item) => item.id === id)
        expect(notification, `owned notification ${id} should be persisted`).toBeDefined()
        return notification!
      }
      const { items: initialNotifications } = await listNotifications(request, actorToken, { type, pageSize: 100 })
      const before = initialNotifications.find((notification) => notification.id === notificationId)
      const unrelatedBefore = initialNotifications.find((notification) => notification.id === unrelatedId)
      expect(before).toMatchObject({ status: 'unread', readAt: null, actionTaken: null })
      expect(unrelatedBefore, 'the unrelated fixture should be persisted').toBeDefined()
      await use({
        id: notificationId,
        title,
        origin: new URL(baseURL!).origin,
        parentHref,
        actionHref,
        before: before!,
        read: (status) => read(notificationId, status),
        expectUnrelatedNotificationUnchanged: async () => {
          expect(await read(unrelatedId)).toEqual(unrelatedBefore)
        },
      })
    } finally {
      const cleanupErrors: unknown[] = []
      if (token) {
        try {
          const { items } = await listNotifications(request, token, { pageSize: 100 })
          for (const notification of items) {
            if (typeof notification.id !== 'string') continue
            try {
              const response = await apiRequest(request, 'PUT', `/api/notifications/${notification.id}/dismiss`, { token })
              expect(response.ok(), 'owned notification cleanup should succeed').toBe(true)
            } catch (error) {
              cleanupErrors.push(error)
            }
          }
          expect((await listNotifications(request, token, { pageSize: 100 })).items).toEqual([])
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      for (const [path, id] of [['users', userId], ['roles', roleId]]) {
        if (!id) continue
        try {
          const response = await apiRequest(request, 'DELETE', `/api/auth/${path}?id=${id}`, { token: adminToken })
          expect(response.ok(), `owned ${path} cleanup should succeed`).toBe(true)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      expect(cleanupErrors, 'all owned API fixtures should be cleaned up').toEqual([])
    }
  },
})

export async function openKeyboardNotification(
  page: Page,
  fixture: KeyboardFixture,
  locale: keyof typeof notificationMessages = 'en',
) {
  await acknowledgeGlobalNotices(page)
  await page.context().addCookies([{ name: 'locale', value: locale, url: fixture.origin }])
  await page.goto('/backend')
  const messages = notificationMessages[locale]
  const unreadLabel = new RegExp(`^${messages['notifications.badge.unread'].replace('{count}', '\\d+')}$`)
  await page.getByRole('button', { name: unreadLabel }).click()
  const panel = page.getByRole('dialog', { name: messages['notifications.title'], exact: true })
  const card = panel.getByRole('button').filter({ has: page.getByText(fixture.title, { exact: true }) })
  await expect(card).toBeVisible()
  return card
}

export function actionWrite(fixture: KeyboardFixture, actionId: string) {
  return { method: 'POST', path: `/api/notifications/${fixture.id}/action`, body: { actionId } }
}

export function observeNotificationEffects(page: Page) {
  const writes: Array<{ method: string; path: string; body: unknown }> = []
  const navigations: string[] = []
  const pageErrors: string[] = []
  page.on('request', (request: Request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/notifications') && !['GET', 'HEAD'].includes(request.method())) {
      writes.push({ method: request.method(), path, body: request.postDataJSON() })
    }
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const url = new URL(frame.url())
      navigations.push(`${url.pathname}${url.search}`)
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return { writes, navigations, pageErrors }
}

export async function expectActionPersisted(fixture: KeyboardFixture, actionId: string) {
  const after = await fixture.read()
  expect(after).toEqual({
    ...fixture.before,
    status: 'actioned',
    actionTaken: actionId,
    readAt: expect.any(String),
  })
  expect(Number.isFinite(Date.parse(String(after.readAt)))).toBe(true)
  await fixture.expectUnrelatedNotificationUnchanged()
}
