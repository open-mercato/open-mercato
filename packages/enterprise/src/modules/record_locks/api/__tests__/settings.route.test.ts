import { GET, POST } from '@open-mercato/enterprise/modules/record_locks/api/settings/route'
import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'

jest.mock('@open-mercato/enterprise/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

const TENANT_ID = '60000000-0000-4000-8000-000000000001'

const STORED_AT = '2026-11-20T10:00:00.000Z'
const SAVED_AT = '2026-11-20T10:05:00.000Z'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/record_locks/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const VALID_SETTINGS = {
  enabled: true,
  strategy: 'pessimistic',
  timeoutSeconds: 600,
  heartbeatSeconds: 30,
  enabledResources: ['sales.quote'],
  allowForceUnlock: true,
  allowIncomingOverride: true,
  notifyOnConflict: true,
}

type AssertCurrent = (currentUpdatedAt: string | null) => void

function mockService(currentUpdatedAt: string | null) {
  const persist = jest.fn()
  const saveSettingsRecord = jest.fn(async (
    input: unknown,
    _tenantId: string,
    options?: { assertCurrent?: AssertCurrent },
  ) => {
    options?.assertCurrent?.(currentUpdatedAt)
    persist(input)
    return { settings: VALID_SETTINGS, updatedAt: SAVED_AT }
  })
  jest.mocked(resolveRecordLocksApiContext).mockResolvedValue({
    auth: { tenantId: TENANT_ID },
    recordLockService: { saveSettingsRecord },
  } as unknown as Awaited<ReturnType<typeof resolveRecordLocksApiContext>>)
  return { saveSettingsRecord, persist }
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

    const getSettingsRecord = jest.fn().mockResolvedValue({ settings, updatedAt: STORED_AT })
    jest.mocked(resolveRecordLocksApiContext).mockResolvedValue({
      auth: { tenantId: TENANT_ID },
      recordLockService: { getSettingsRecord },
    } as unknown as Awaited<ReturnType<typeof resolveRecordLocksApiContext>>)

    const response = await GET(new Request('http://localhost/api/record_locks/settings'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings, updatedAt: STORED_AT })
    expect(getSettingsRecord).toHaveBeenCalledWith(TENANT_ID)
  })

  test('POST returns 400 when payload is invalid', async () => {
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: { saveSettingsRecord: jest.fn() },
    })

    const response = await POST(makeRequest({ enabled: 'yes' }))
    expect(response.status).toBe(400)
  })

  test('POST saves and returns settings with the new version', async () => {
    const { saveSettingsRecord } = mockService(STORED_AT)

    const response = await POST(makeRequest(VALID_SETTINGS))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings: VALID_SETTINGS, updatedAt: SAVED_AT })
    expect(saveSettingsRecord).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      strategy: 'pessimistic',
      timeoutSeconds: 600,
      heartbeatSeconds: 30,
      enabledResources: ['sales.quote'],
      allowForceUnlock: true,
      notifyOnConflict: true,
    }), TENANT_ID, { assertCurrent: expect.any(Function) })
  })

  test('POST saves when the expected version matches the stored settings', async () => {
    const { persist } = mockService(STORED_AT)

    const response = await POST(makeRequest(VALID_SETTINGS, { [LOCK_HEADER]: STORED_AT }))
    expect(response.status).toBe(200)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  test('POST refuses a stale save with 409 and keeps the stored settings', async () => {
    const staleAt = '2026-11-20T09:00:00.000Z'
    const { persist } = mockService(STORED_AT)

    const response = await POST(makeRequest(VALID_SETTINGS, { [LOCK_HEADER]: staleAt }))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toEqual({
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: STORED_AT,
      expectedUpdatedAt: staleAt,
    })
    expect(persist).not.toHaveBeenCalled()
  })
})
