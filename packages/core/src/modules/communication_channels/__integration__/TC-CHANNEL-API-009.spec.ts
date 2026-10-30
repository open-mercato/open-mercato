import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-009 — reaction routes do not reveal messages in another user's
 * personal mailbox.
 * Source: https://github.com/open-mercato/open-mercato/issues/3833
 *
 * A message linked to someone else's personal mailbox, and a reaction on it, must
 * answer exactly like an unknown message or reaction: 404 with one localized body.
 * The mailbox owner keeps add (201) and remove (204), and sees the localized
 * refusal in the reaction bar.
 */

async function seedPersonalMailboxMessage(request: APIRequestContext, ownerToken: string, label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const address = `api-009-${label}-${stamp}@test-seed.local`
  const channelId = await seedConnectedChannel(request, ownerToken, {
    displayName: `TC-CHANNEL-API-009 ${label} ${stamp}`,
    externalIdentifier: address,
  })
  const seeded = await seedInboundMessage(request, ownerToken, {
    channelId,
    from: `sender-${stamp}@example.com`,
    to: [address],
    subject: `TC-CHANNEL-API-009 ${label} ${stamp}`,
    bodyText: 'personal mailbox message',
    createThreadMapping: true,
  })
  return { channelId, messageId: seeded.messageId }
}

async function addReaction(request: APIRequestContext, token: string, messageId: string) {
  const added = await apiRequest(
    request,
    'POST',
    `/api/communication_channels/messages/${messageId}/reactions`,
    { token, data: { emoji: '👍' } },
  )
  expect(added.status(), 'the mailbox owner can react').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(added)
  return expectId(body?.id, 'reaction response should include the new reaction id')
}

test.describe('TC-CHANNEL-API-009: reaction routes mask other users\' personal mailboxes', () => {
  test('a non-owner gets the same 404 as for an unknown message or reaction', async ({ request }) => {
    test.slow()
    let ownerToken: string | null = null
    let channelId: string | null = null
    try {
      ownerToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, ownerToken)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment.')
      const otherToken = await getAuthToken(request, 'employee')

      const seeded = await seedPersonalMailboxMessage(request, ownerToken, 'api')
      channelId = seeded.channelId

      const post = (messageId: string, headers?: Record<string, string>) =>
        apiRequest(request, 'POST', `/api/communication_channels/messages/${messageId}/reactions`, {
          token: otherToken,
          data: { emoji: '👍' },
          headers,
        })

      const foreign = await post(seeded.messageId)
      const unknown = await post(randomUUID())
      expect(foreign.status(), 'another user\'s personal-mailbox message reads as not found').toBe(404)
      expect(unknown.status(), 'an unknown message reads as not found').toBe(404)
      const unknownBody = await readJsonSafe<{ error?: string }>(unknown)
      expect(unknownBody?.error, 'the refusal carries a message').toBeTruthy()
      expect(await readJsonSafe(foreign), 'both refusals have the same body').toEqual(unknownBody)

      const foreignPolish = await post(seeded.messageId, { 'Accept-Language': 'pl' })
      const unknownPolish = await post(randomUUID(), { 'Accept-Language': 'pl' })
      expect(foreignPolish.status()).toBe(404)
      const polishBody = await readJsonSafe<{ error?: string }>(foreignPolish)
      expect(polishBody?.error, 'the refusal is localized').toBe('Nie znaleziono wiadomości')
      expect(await readJsonSafe(unknownPolish)).toEqual(polishBody)

      const reactionId = await addReaction(request, ownerToken, seeded.messageId)

      const remove = (messageId: string, targetReactionId: string, token: string) =>
        apiRequest(
          request,
          'DELETE',
          `/api/communication_channels/messages/${messageId}/reactions/${targetReactionId}`,
          { token },
        )

      const foreignRemove = await remove(seeded.messageId, reactionId, otherToken)
      const unknownRemove = await remove(seeded.messageId, randomUUID(), otherToken)
      expect(foreignRemove.status(), 'a non-owner cannot tell the reaction exists').toBe(404)
      expect(unknownRemove.status()).toBe(404)
      expect(await readJsonSafe(foreignRemove)).toEqual(await readJsonSafe(unknownRemove))

      const removed = await remove(seeded.messageId, reactionId, ownerToken)
      expect(removed.status(), 'the owner can still remove the reaction').toBe(204)
    } finally {
      await deleteChannelIfExists(request, ownerToken, channelId)
    }
  })

  test('the reaction bar shows the localized refusal to the mailbox owner', async ({ page, request, baseURL }) => {
    test.slow()
    let ownerToken: string | null = null
    let channelId: string | null = null
    try {
      ownerToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, ownerToken)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment.')

      const seeded = await seedPersonalMailboxMessage(request, ownerToken, 'ui')
      channelId = seeded.channelId
      const reactionId = await addReaction(request, ownerToken, seeded.messageId)

      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL ?? 'http://localhost:3000' }])
      await page.goto(`/backend/messages/${seeded.messageId}`)
      const reactionButton = page.getByRole('button', { name: /👍/ })
      await expect(reactionButton).toBeVisible()

      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/communication_channels/messages/${seeded.messageId}/reactions/${reactionId}`,
        { token: ownerToken },
      )
      expect(removed.status()).toBe(204)

      await reactionButton.click()
      await expect(page.getByText('Nie znaleziono reakcji')).toBeVisible()
    } finally {
      await deleteChannelIfExists(request, ownerToken, channelId)
    }
  })
})
