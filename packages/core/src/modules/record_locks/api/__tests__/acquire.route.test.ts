import { POST } from '@open-mercato/core/modules/record_locks/api/acquire/route'
import { resolveRecordLocksApiContext } from '@open-mercato/core/modules/record_locks/api/utils'

jest.mock('@open-mercato/core/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/record_locks/acquire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('record_locks acquire route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns 400 for invalid payload', async () => {
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: {
        sub: '10000000-0000-4000-8000-000000000001',
        tenantId: '20000000-0000-4000-8000-000000000001',
      },
      organizationId: '30000000-0000-4000-8000-000000000001',
      recordLockService: { acquire: jest.fn() },
    })

    const response = await POST(makeRequest({}))
    expect(response.status).toBe(400)
  })

  test('returns lock error payload when service reports lock', async () => {
    const acquire = jest.fn().mockResolvedValue({
      ok: false,
      status: 423,
      error: 'Record is currently locked by another user',
      code: 'record_locked',
      allowForceUnlock: false,
      lock: null,
    })

    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: {
        sub: '10000000-0000-4000-8000-000000000001',
        tenantId: '20000000-0000-4000-8000-000000000001',
      },
      organizationId: '30000000-0000-4000-8000-000000000001',
      recordLockService: { acquire },
    })

    const response = await POST(
      makeRequest({
        resourceKind: 'sales.quote',
        resourceId: '40000000-0000-4000-8000-000000000001',
      }),
    )

    expect(response.status).toBe(423)
    const body = await response.json()
    expect(body).toMatchObject({
      code: 'record_locked',
      error: 'Record is currently locked by another user',
      allowForceUnlock: false,
    })
  })

  test('returns successful acquire response', async () => {
    const acquire = jest.fn().mockResolvedValue({
      ok: true,
      enabled: true,
      resourceEnabled: true,
      strategy: 'optimistic',
      allowForceUnlock: true,
      heartbeatSeconds: 30,
      acquired: true,
      latestActionLogId: null,
      lock: null,
    })

    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: {
        sub: '10000000-0000-4000-8000-000000000001',
        tenantId: '20000000-0000-4000-8000-000000000001',
      },
      organizationId: '30000000-0000-4000-8000-000000000001',
      recordLockService: { acquire },
    })

    const response = await POST(
      makeRequest({
        resourceKind: 'sales.quote',
        resourceId: '40000000-0000-4000-8000-000000000001',
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      resourceEnabled: true,
      strategy: 'optimistic',
      allowForceUnlock: true,
    })
  })
})
