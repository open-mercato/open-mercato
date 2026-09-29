import { getFcmChannelAdapter } from '../adapter'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'

type FakeApp = { name: string; delete: jest.Mock<Promise<void>, []> }

const mockApps: FakeApp[] = []
const mockDeletedNames: string[] = []

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn((config: unknown) => ({ __cert: config })),
  getApps: jest.fn(() => mockApps),
  initializeApp: jest.fn((_options: unknown, name: string) => {
    const app: FakeApp = {
      name,
      delete: jest.fn(async () => {
        mockDeletedNames.push(name)
        const index = mockApps.indexOf(app)
        if (index >= 0) mockApps.splice(index, 1)
      }),
    }
    mockApps.push(app)
    return app
  }),
}))

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send: jest.fn(async () => 'projects/demo/messages/1') })),
}))

function buildInputForPrivateKey(privateKey: string): SendMessageInput {
  const serviceAccountJson = JSON.stringify({
    project_id: 'demo-project',
    client_email: 'svc@demo-project.iam.gserviceaccount.com',
    private_key: privateKey,
  })
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped' } },
    },
    credentials: { serviceAccountJson },
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken: 'device-token-abc', platform: 'android' },
  }
}

describe('FcmChannelAdapter default app cache', () => {
  const APP_CACHE_MAX = 32

  it('LRU-evicts the least-recently used app and calls app.delete() once the cap is exceeded', async () => {
    const adapter = getFcmChannelAdapter()

    // Fill the cache to its cap with distinct service accounts (distinct key hash → distinct app).
    for (let index = 0; index < APP_CACHE_MAX; index += 1) {
      const result = await adapter.sendMessage(buildInputForPrivateKey(`key-${index}`))
      expect(result.status).toBe('sent')
    }

    expect(mockApps).toHaveLength(APP_CACHE_MAX)
    expect(mockDeletedNames).toHaveLength(0)

    // The (cap + 1)-th distinct account exceeds the bound and evicts the oldest app.
    const overflow = await adapter.sendMessage(buildInputForPrivateKey('key-overflow'))
    expect(overflow.status).toBe('sent')

    expect(mockDeletedNames).toHaveLength(1)
    expect(mockApps).toHaveLength(APP_CACHE_MAX)
  })

  it('reuses the cached app for repeated sends with the same service account (no new init, no delete)', async () => {
    const before = mockApps.length
    const deletesBefore = mockDeletedNames.length

    const first = await getFcmChannelAdapter().sendMessage(buildInputForPrivateKey('key-overflow'))
    const second = await getFcmChannelAdapter().sendMessage(buildInputForPrivateKey('key-overflow'))

    expect(first.status).toBe('sent')
    expect(second.status).toBe('sent')
    // Same account → same cache entry; no additional app initialized, none evicted.
    expect(mockApps.length).toBe(before)
    expect(mockDeletedNames.length).toBe(deletesBefore)
  })
})
