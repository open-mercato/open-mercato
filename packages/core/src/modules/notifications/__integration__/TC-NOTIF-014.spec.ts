import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createNotificationFixture,
  listNotifications,
  dismissNotificationsByType,
} from '@open-mercato/core/modules/core/__integration__/helpers/notificationsFixtures'

/**
 * Phase 7 — channel-seam unification. Exercises the corrective enforcement that landed with the
 * unified delivery gate: per-channel opt-out and per-send channel targeting now actually govern
 * in-app visibility (previously ignored). Deliberately self-contained — every fixture uses a unique
 * type id and is asserted via type-scoped inbox reads (never the racy global unread counter).
 */
const PREFERENCES_PATH = '/api/notifications/preferences'

let counter = 0
function uniqueType(kind: string): string {
  counter += 1
  return `qa.notif.ch.${kind}.${Date.now()}.${counter}`
}

async function optOut(
  request: APIRequestContext,
  token: string,
  notificationTypeId: string,
  channel: string,
): Promise<void> {
  const res = await apiRequest(request, 'PUT', PREFERENCES_PATH, {
    token,
    data: { preferences: [{ notificationTypeId, channel, enabled: false }] },
  })
  expect(res.status(), `opt out of ${channel} for ${notificationTypeId}`).toBe(200)
}

async function findInInbox(
  request: APIRequestContext,
  token: string,
  type: string,
): Promise<Record<string, unknown> | undefined> {
  const list = await listNotifications(request, token, { type, pageSize: 100 })
  return list.items[0]
}

test.describe('TC-NOTIF-014: channel-seam enforcement (Phase 7)', () => {
  test('default send (no target, no opt-out) is delivered to in_app and lists all channels', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = uniqueType('default')
    try {
      const id = await createNotificationFixture(request, token, {
        type,
        title: 'Default channels',
        recipientUserId: scope.userId,
        body: 'BC: no channels specified → all registered channels',
      })
      const item = await findInInbox(request, token, type)
      expect(item, 'default notification is visible in the in-app inbox').toBeTruthy()
      expect(item?.id).toBe(id)
      // The resolved channel set is surfaced on the DTO; a default send resolves to every registered
      // channel, which always includes in_app (that is why it is visible here).
      const channels = item?.channels as string[] | null
      expect(Array.isArray(channels)).toBe(true)
      expect(channels).toContain('in_app')
    } finally {
      await dismissNotificationsByType(request, token, type)
    }
  })

  test('opting out of in_app hides the notification from the inbox (corrective enforcement)', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = uniqueType('inapp-optout')
    try {
      await optOut(request, token, type, 'in_app')
      // The create still succeeds (the row is a durable record) …
      await createNotificationFixture(request, token, {
        type,
        title: 'In-app opted out',
        recipientUserId: scope.userId,
        body: 'in_app disabled → suppressed from the bell/inbox',
      })
      // … but it is not visible in the in-app inbox.
      const item = await findInInbox(request, token, type)
      expect(item, 'in_app-opted-out notification must NOT appear in the inbox').toBeUndefined()
    } finally {
      await dismissNotificationsByType(request, token, type)
    }
  })

  test('opting out of email keeps in_app but drops email from the resolved channels', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = uniqueType('email-optout')
    try {
      await optOut(request, token, type, 'email')
      await createNotificationFixture(request, token, {
        type,
        title: 'Email opted out',
        recipientUserId: scope.userId,
        body: 'email disabled → excluded from resolved channels, in_app still on',
      })
      const item = await findInInbox(request, token, type)
      expect(item, 'email opt-out does not affect in-app visibility').toBeTruthy()
      const channels = item?.channels as string[] | null
      expect(channels).toContain('in_app')
      expect(channels).not.toContain('email')
    } finally {
      await dismissNotificationsByType(request, token, type)
    }
  })

  test('per-send channels target (push-only) suppresses the in-app row', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = uniqueType('push-only')
    try {
      await createNotificationFixture(request, token, {
        type,
        title: 'Push only',
        recipientUserId: scope.userId,
        body: 'channels: [push] → no in-app row visibility',
        channels: ['push'],
      })
      const item = await findInInbox(request, token, type)
      expect(item, 'a push-only targeted notification is not visible in-app').toBeUndefined()
    } finally {
      await dismissNotificationsByType(request, token, type)
    }
  })

  test('explicit in_app target keeps the notification visible', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = uniqueType('inapp-target')
    try {
      await createNotificationFixture(request, token, {
        type,
        title: 'In-app targeted',
        recipientUserId: scope.userId,
        body: 'channels: [in_app] → visible, and email/push excluded',
        channels: ['in_app'],
      })
      const item = await findInInbox(request, token, type)
      expect(item, 'an in_app-targeted notification is visible').toBeTruthy()
      const channels = item?.channels as string[] | null
      expect(channels).toEqual(['in_app'])
    } finally {
      await dismissNotificationsByType(request, token, type)
    }
  })
})
