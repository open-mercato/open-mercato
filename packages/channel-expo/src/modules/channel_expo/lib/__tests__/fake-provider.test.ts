import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  clearFakePushLog,
  findFakePush,
} from '@open-mercato/core/modules/push_notifications/lib/fake-provider-recorder'
import { getExpoChannelAdapter, setExpoClientFactory } from '../adapter'
import { ensureExpoFakeProviderInstalled } from '../fake-provider'

/**
 * Drives the REAL Expo adapter against the fake client, the same way `di.ts` installs it.
 *
 * Expo is the only two-phase provider: an `unregistered` token is ACCEPTED at send time and only
 * reported dead later, by the receipt. That asymmetry is what TC-PUSH-008 exercises end-to-end, and what
 * the ticket-id encoding below makes work across processes.
 */
function buildInput(pushToken: string): SendMessageInput {
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped' }, options: { sound: 'chime.caf' } },
    },
    credentials: { accessToken: 'om-fake-expo-token' },
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken, platform: 'android' },
  }
}

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-expo-fake-'))
  process.env.QUEUE_BASE_DIR = tempDir
  process.env.OM_PUSH_FAKE_PROVIDERS = '1'
  ensureExpoFakeProviderInstalled()
})

afterAll(() => {
  setExpoClientFactory(null)
  delete process.env.OM_PUSH_FAKE_PROVIDERS
  delete process.env.QUEUE_BASE_DIR
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  clearFakePushLog()
})

describe('Expo fake provider', () => {
  it('sends through the real adapter and records the native message', async () => {
    const result = await getExpoChannelAdapter().sendMessage(buildInput('expo-token-ABCDEF12'))
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBeTruthy()

    const recorded = findFakePush('expo', 'ABCDEF12')
    expect(recorded?.native).toMatchObject({
      to: 'expo-token-ABCDEF12',
      title: 'Hello',
      body: 'Body text',
      sound: 'chime.caf',
    })
  })

  it('accepts an unregistered token at send time — Expo only reports it in the receipt', async () => {
    const result = await getExpoChannelAdapter().sendMessage(buildInput('expo-unregistered-token-99'))
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBeTruthy()
  })

  it('reports DeviceNotRegistered for that ticket when the receipt is polled', async () => {
    const sent = await getExpoChannelAdapter().sendMessage(buildInput('expo-unregistered-token-99'))
    const outcomes = await getExpoChannelAdapter().checkReceipts!([sent.externalMessageId], {
      accessToken: 'om-fake-expo-token',
    })
    expect(outcomes).toEqual([{ ticketId: sent.externalMessageId, unregistered: true }])
  })

  it('reports a healthy ticket as still registered', async () => {
    const sent = await getExpoChannelAdapter().sendMessage(buildInput('expo-token-ABCDEF12'))
    const outcomes = await getExpoChannelAdapter().checkReceipts!([sent.externalMessageId], {
      accessToken: 'om-fake-expo-token',
    })
    expect(outcomes).toEqual([{ ticketId: sent.externalMessageId, unregistered: false }])
  })

  it('treats a fail token as a retryable error, not a token verdict', async () => {
    const result = await getExpoChannelAdapter().sendMessage(buildInput('expo-fail-token-77'))
    expect(result.status).toBe('failed')
    expect(result.error).not.toBe('device_unregistered')
  })
})
