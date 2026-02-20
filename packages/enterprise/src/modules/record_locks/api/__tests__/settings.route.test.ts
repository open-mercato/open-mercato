import { GET, POST } from '@open-mercato/enterprise/modules/record_locks/api/settings/route'
import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'

jest.mock('@open-mercato/enterprise/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/record_locks/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('record_locks settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('GET returns current settings', async () => {
    const settings = {
      enabled: false,
      strategy: 'optimistic',
      timeoutSeconds: 300,
      heartbeatSeconds: 30,
      enabledResources: [],
      allowForceUnlock: true,
      notifyOnConflict: true,
    }

    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: {
        getSettings: jest.fn().mockResolvedValue(settings),
      },
    })

    const response = await GET(new Request('http://localhost/api/record_locks/settings'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings })
  })

  test('POST returns 400 when payload is invalid', async () => {
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: { saveSettings: jest.fn() },
    })

    const response = await POST(makeRequest({ enabled: 'yes' }))
    expect(response.status).toBe(400)
  })

  test('POST saves and returns settings', async () => {
    const settings = {
      enabled: true,
      strategy: 'pessimistic',
      timeoutSeconds: 600,
      heartbeatSeconds: 30,
      enabledResources: ['sales.quote'],
      allowForceUnlock: true,
      notifyOnConflict: true,
    }

    const saveSettings = jest.fn().mockResolvedValue(settings)
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: { saveSettings },
    })

    const response = await POST(makeRequest(settings))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings })
    expect(saveSettings).toHaveBeenCalledWith(settings)
  })
})
