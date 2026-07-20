import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  clearFakePushLog,
  findFakePush,
} from '@open-mercato/core/modules/push_notifications/lib/fake-provider-recorder'
import { getApnsChannelAdapter, setApnsSenderFactory } from '../adapter'
import { ensureApnsFakeProviderInstalled } from '../fake-provider'

/**
 * Drives the REAL APNs adapter against the fake sender, the same way `di.ts` installs it. The APNs seam
 * sits above the message builder (the sender receives the raw envelope), so this also pins that the fake
 * records the notification production would have sent.
 */
const credentials = {
  p8Key: '-----BEGIN PRIVATE KEY-----\nom-fake-p8\n-----END PRIVATE KEY-----\n',
  keyId: 'FAKEKEYID1',
  teamId: 'FAKETEAMID',
  bundleId: 'com.openmercato.fake',
  production: false,
}

function buildInput(pushToken: string, silent = false): SendMessageInput {
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped' }, options: { badge: 4 }, silent },
    },
    credentials,
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken, platform: 'ios' },
  }
}

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-apns-fake-'))
  process.env.QUEUE_BASE_DIR = tempDir
  process.env.OM_PUSH_FAKE_PROVIDERS = '1'
  ensureApnsFakeProviderInstalled()
})

afterAll(() => {
  setApnsSenderFactory(null)
  delete process.env.OM_PUSH_FAKE_PROVIDERS
  delete process.env.QUEUE_BASE_DIR
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  clearFakePushLog()
})

describe('APNs fake provider', () => {
  it('sends through the real adapter and records the wire-form notification', async () => {
    const result = await getApnsChannelAdapter().sendMessage(buildInput('device-token-ABCDEF12'))
    expect(result.status).toBe('sent')

    // Built against a real `apn.Notification`, so this is what node-apn would transmit.
    const recorded = findFakePush('apns', 'ABCDEF12')
    expect(recorded?.native.headers).toMatchObject({ 'apns-topic': 'com.openmercato.fake' })
    expect(recorded?.native.payload).toMatchObject({
      aps: { alert: { title: 'Hello', body: 'Body text' }, badge: 4 },
    })
  })

  it('records a silent push as a background content-available notification', async () => {
    const result = await getApnsChannelAdapter().sendMessage(buildInput('device-token-SILENT12', true))
    expect(result.status).toBe('sent')

    const recorded = findFakePush('apns', 'SILENT12')
    expect(recorded?.native.headers).toMatchObject({ 'apns-push-type': 'background', 'apns-priority': 5 })
    expect(recorded?.native.payload).toMatchObject({ aps: { 'content-available': 1 } })
    expect((recorded?.native.payload as { aps: Record<string, unknown> }).aps.alert).toBeUndefined()
  })

  it('maps the native Unregistered reason to the device_unregistered sentinel', async () => {
    const result = await getApnsChannelAdapter().sendMessage(buildInput('device-unregistered-token-99'))
    expect(result.status).toBe('failed')
    expect(result.error).toBe('device_unregistered')
  })

  it('treats a fail token as a retryable error, not a token verdict', async () => {
    const result = await getApnsChannelAdapter().sendMessage(buildInput('device-fail-token-77'))
    expect(result.status).toBe('failed')
    expect(result.error).not.toBe('device_unregistered')
  })
})
