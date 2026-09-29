import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-NOTIF-017: per-channel eligibility toggles resolve against the CURRENT stored state.
 *
 * Regression for the QA finding on PR #4326 (verdict item 16): the admin type grid used to send
 * the whole `channels` array, computed client-side from whatever the tab had loaded. Two operators
 * editing the same type from stale views therefore clobbered each other — and while no override row
 * existed yet there was no `updated_at` to version-lock against, so the optimistic-lock guard could
 * not even detect it (`buildOptimisticLockHeader(null)` sends no header ⇒ documented no-op).
 *
 * The per-channel sub-resource derives the next set server-side under a row lock, so a concurrent
 * toggle of a different channel survives. These requests deliberately send NO optimistic-lock
 * header — that must not be a conflict.
 */

const TYPES_PATH = '/api/notifications/types'

type NotificationTypeItem = {
  id: string
  channels: string[] | null
  storedChannels: string[] | null
  storedNonOptOut: boolean | null
}
type TypesResponse = { items: NotificationTypeItem[] }
type ToggleResponse = { ok?: boolean; item?: NotificationTypeItem; error?: string }

function channelPath(typeId: string, channel: string): string {
  return `${TYPES_PATH}/${encodeURIComponent(typeId)}/channels/${encodeURIComponent(channel)}`
}

async function getTypes(request: APIRequestContext, token: string): Promise<NotificationTypeItem[]> {
  const res = await apiRequest(request, 'GET', TYPES_PATH, { token })
  expect(res.status()).toBe(200)
  return (await readJsonSafe<TypesResponse>(res))?.items ?? []
}

async function getType(
  request: APIRequestContext,
  token: string,
  typeId: string,
): Promise<NotificationTypeItem> {
  const items = await getTypes(request, token)
  const found = items.find((item) => item.id === typeId)
  expect(found, `type ${typeId} present in catalogue`).toBeTruthy()
  return found!
}

/** Restore the tenant's stored override so the run leaves no residue for other specs. */
async function restoreOverride(
  request: APIRequestContext,
  token: string,
  original: NotificationTypeItem,
): Promise<void> {
  await apiRequest(request, 'PATCH', TYPES_PATH, {
    token,
    data: {
      id: original.id,
      channels: original.storedChannels,
      nonOptOut: original.storedNonOptOut,
    },
  })
}

test.describe('TC-NOTIF-017: notification type channel add/remove', () => {
  test('a concurrent toggle of a different channel is not lost (QA #16 regression)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Pick a type whose effective set is a concrete array holding a non-push channel, so removing
    // one entry can never empty the set (an empty set clears the override by design).
    const candidates = await getTypes(request, token)
    const target = candidates.find(
      (item) => Array.isArray(item.channels) && item.channels.some((channel) => channel !== 'push'),
    )
    expect(target, 'a type with a concrete non-push channel declaration').toBeTruthy()
    const typeId = target!.id
    const original = await getType(request, token, typeId)
    const otherChannel = original.channels!.find((channel) => channel !== 'push')!

    try {
      // Operator A enables `push`. Both tabs loaded before any override existed, so neither holds
      // a version token and neither request carries the optimistic-lock header.
      const enableRes = await apiRequest(request, 'PUT', channelPath(typeId, 'push'), { token })
      expect(enableRes.status()).toBe(200)
      const afterA = (await readJsonSafe<ToggleResponse>(enableRes))?.item
      expect(afterA?.channels).toContain('push')

      // Operator B — still on the stale view — turns a DIFFERENT channel off. Before the fix this
      // sent a whole array computed from the pre-A state and silently reverted A's `push`.
      const disableRes = await apiRequest(request, 'DELETE', channelPath(typeId, otherChannel), { token })
      expect(disableRes.status()).toBe(200)
      const afterB = (await readJsonSafe<ToggleResponse>(disableRes))?.item
      expect(afterB?.channels).not.toContain(otherChannel)
      // The whole point: A's edit survived B's write.
      expect(afterB?.channels).toContain('push')

      // And it is durable, not just echoed in the response.
      const reloaded = await getType(request, token, typeId)
      expect(reloaded.channels).toContain('push')
      expect(reloaded.channels).not.toContain(otherChannel)
    } finally {
      await restoreOverride(request, token, original)
    }
  })

  test('toggles are idempotent and never store an empty eligibility set', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const candidates = await getTypes(request, token)
    const target = candidates.find((item) => Array.isArray(item.channels) && item.channels.length > 0)
    expect(target).toBeTruthy()
    const typeId = target!.id
    const original = await getType(request, token, typeId)

    try {
      // Enabling twice keeps a single entry.
      expect((await apiRequest(request, 'PUT', channelPath(typeId, 'push'), { token })).status()).toBe(200)
      const second = await apiRequest(request, 'PUT', channelPath(typeId, 'push'), { token })
      expect(second.status()).toBe(200)
      const item = (await readJsonSafe<ToggleResponse>(second))?.item
      expect(item?.channels?.filter((channel) => channel === 'push')).toHaveLength(1)

      // Disabling every remaining channel clears the override rather than persisting `[]`, so the
      // code-declared default reapplies instead of the type becoming undeliverable.
      for (const channel of [...(item?.channels ?? [])]) {
        expect((await apiRequest(request, 'DELETE', channelPath(typeId, channel), { token })).status()).toBe(200)
      }
      const cleared = await getType(request, token, typeId)
      expect(cleared.storedChannels).toBeNull()
    } finally {
      await restoreOverride(request, token, original)
    }
  })

  test('rejects an unregistered channel and an unknown type', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const target = (await getTypes(request, token))[0]!

    const badChannel = await apiRequest(request, 'PUT', channelPath(target.id, 'qa-not-a-channel'), { token })
    expect(badChannel.status()).toBe(404)

    const badType = await apiRequest(request, 'PUT', channelPath('qa.nonexistent.type', 'push'), { token })
    expect(badType.status()).toBe(404)
  })

  test('requires notifications.manage', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const adminToken = await getAuthToken(request, 'admin')
    const target = (await getTypes(request, adminToken))[0]!

    const blocked = await apiRequest(request, 'PUT', channelPath(target.id, 'push'), { token: employeeToken })
    expect([401, 403]).toContain(blocked.status())

    const anonymous = await apiRequest(request, 'PUT', channelPath(target.id, 'push'), { token: '' })
    expect([401, 403]).toContain(anonymous.status())
  })
})
