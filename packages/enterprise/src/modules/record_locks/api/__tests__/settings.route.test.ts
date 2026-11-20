import { GET, POST } from '@open-mercato/enterprise/modules/record_locks/api/settings/route'
import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'

jest.mock('@open-mercato/enterprise/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

const TENANT_ID = '60000000-0000-4000-8000-000000000001'

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
      allowIncomingOverride: true,
      notifyOnConflict: true,
    }

    const getSettings = jest.fn().mockResolvedValue(settings)
    jest.mocked(resolveRecordLocksApiContext).mockResolvedValue({
      auth: { tenantId: TENANT_ID },
      recordLockService: { getSettings },
    } as Awaited<ReturnType<typeof resolveRecordLocksApiContext>>)

    const response = await GET(new Request('http://localhost/api/record_locks/settings'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings })
    expect(getSettings).toHaveBeenCalledWith(TENANT_ID)
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
      allowIncomingOverride: true,
      notifyOnConflict: true,
    }

    const saveSettings = jest.fn().mockResolvedValue(settings)
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: { tenantId: TENANT_ID },
      recordLockService: { saveSettings },
    })

    const response = await POST(makeRequest(settings))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings })
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      strategy: 'pessimistic',
      timeoutSeconds: 600,
      heartbeatSeconds: 30,
      enabledResources: ['sales.quote'],
      allowForceUnlock: true,
      notifyOnConflict: true,
    }), TENANT_ID)
  })
})
