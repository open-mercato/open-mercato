import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, type APIRequestContext } from '@playwright/test'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { seedConnectedChannel } from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  if (!process.env.QUEUE_BASE_DIR?.trim()) {
    process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
  }
}

export type DeliveryParticipant = {
  id: string
  role: string
  email: string
  deliveryStatus: 'pending' | 'sent' | 'failed' | null
  deliveryError: string | null
}

export async function drainDeliveryUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const shouldDrainQueues = parseBooleanToken(process.env.AUTO_SPAWN_WORKERS) !== true
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (shouldDrainQueues) {
      await drainIntegrationQueue('communication-channels-outbound', { appRoot: APP_ROOT })
      await drainIntegrationQueue('events', { appRoot: APP_ROOT })
    }
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

export async function readMessageParticipants(
  request: APIRequestContext,
  token: string,
  messageId: string,
): Promise<DeliveryParticipant[]> {
  const response = await apiRequest(request, 'GET', `/api/messages/${encodeURIComponent(messageId)}`, { token })
  expect(response.ok(), 'message detail is readable').toBeTruthy()
  const detail = await readJsonSafe<{ externalParticipants?: DeliveryParticipant[] }>(response)
  return detail?.externalParticipants ?? []
}

/**
 * Sends through a seeded `__test_seed__` mailbox. Its adapter rejects any
 * `+reject@` recipient and answers a `+ratelimit@` recipient with a transient 429.
 */
export async function sendThroughSeededMailbox(
  request: APIRequestContext,
  token: string,
  input: { stamp: number; to: string[]; subject: string; sendSeparately?: boolean },
): Promise<{ channelId: string; messageId: string; threadId: string }> {
  const channelId = await seedConnectedChannel(request, token, {
    displayName: `Delivery mailbox ${input.stamp}`,
    externalIdentifier: `delivery-${input.stamp}@example.com`,
  })
  const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
    token,
    data: {
      userChannelId: channelId,
      to: input.to,
      subject: input.subject,
      body: { plain: 'Delivery status coverage.' },
      ...(input.sendSeparately ? { sendSeparately: true } : {}),
    },
  })
  expect(response.status(), 'the mailbox send is accepted').toBe(202)
  const sent = await readJsonSafe<{ messageId?: string; threadId?: string }>(response)
  expect(sent?.messageId).toBeTruthy()
  return { channelId, messageId: sent?.messageId as string, threadId: sent?.threadId as string }
}
