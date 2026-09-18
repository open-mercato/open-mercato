import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  clearFakePushLog,
  findFakePush,
} from '@open-mercato/core/modules/push_notifications/lib/fake-provider-recorder'
import { getFcmChannelAdapter, setFcmMessagingFactory } from '../adapter'
import { ensureFcmFakeProviderInstalled } from '../fake-provider'

/**
 * Drives the REAL FCM adapter against the fake SDK client, the same way `di.ts` installs it. Guards the
 * integration specs' assumptions in-process: the token sentinels, the native-message recording, and the
 * `messaging/registration-token-not-registered` → `device_unregistered` mapping.
 */
const serviceAccountJson = JSON.stringify({
  project_id: 'om-fake-project',
  client_email: 'fake@om-fake-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nom-fake-key\n-----END PRIVATE KEY-----\n',
})

function buildInput(pushToken: string): SendMessageInput {
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped' }, options: { badge: 2 } },
    },
    credentials: { serviceAccountJson },
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken, platform: 'android' },
  }
}

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-fcm-fake-'))
  process.env.QUEUE_BASE_DIR = tempDir
  process.env.OM_PUSH_FAKE_PROVIDERS = '1'
  ensureFcmFakeProviderInstalled()
})

afterAll(() => {
  setFcmMessagingFactory(null)
  delete process.env.OM_PUSH_FAKE_PROVIDERS
  delete process.env.QUEUE_BASE_DIR
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  clearFakePushLog()
})

describe('FCM fake provider', () => {
  it('installs nothing when the env flag is unset, so production never reaches the fake', async () => {
    setFcmMessagingFactory(null)
    delete process.env.OM_PUSH_FAKE_PROVIDERS
    ensureFcmFakeProviderInstalled()

    // Re-enable the flag WITHOUT re-installing, so the recorder is armed. Any recording now could only
    // come from a fake the flag-less `ensure...()` above wrongly installed. The adapter instead falls
    // through to firebase-admin, which cannot initialize with these credentials.
    process.env.OM_PUSH_FAKE_PROVIDERS = '1'
    await getFcmChannelAdapter()
      .sendMessage(buildInput('device-token-INERT001'))
      .catch(() => undefined)
    expect(findFakePush('fcm', 'INERT001')).toBeUndefined()

    ensureFcmFakeProviderInstalled()
  })

  it('sends through the real adapter and records the native message', async () => {
    const result = await getFcmChannelAdapter().sendMessage(buildInput('device-token-ABCDEF12'))
    expect(result.status).toBe('sent')

    const recorded = findFakePush('fcm', 'ABCDEF12')
    expect(recorded).toBeTruthy()
    expect(recorded?.native.token).toBe('device-token-ABCDEF12')
    expect(recorded?.native.notification).toMatchObject({ title: 'Hello', body: 'Body text' })
    expect(recorded?.native.apns).toMatchObject({ payload: { aps: { badge: 2 } } })
  })

  it('maps an unregistered token to the device_unregistered sentinel', async () => {
    const result = await getFcmChannelAdapter().sendMessage(buildInput('device-unregistered-token-99'))
    expect(result.status).toBe('failed')
    expect(result.error).toBe('device_unregistered')
  })

  it('treats a fail token as a retryable error, not a token verdict', async () => {
    const result = await getFcmChannelAdapter().sendMessage(buildInput('device-fail-token-77'))
    expect(result.status).toBe('failed')
    expect(result.error).not.toBe('device_unregistered')
  })
})
