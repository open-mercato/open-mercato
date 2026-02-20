import { POST } from '@open-mercato/enterprise/modules/record_locks/api/release/route'
import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'

jest.mock('@open-mercato/enterprise/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/record_locks/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('record_locks release route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns 400 when reason=conflict_resolved but conflict payload is missing', async () => {
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: {
        sub: '10000000-0000-4000-8000-000000000001',
        tenantId: '20000000-0000-4000-8000-000000000001',
      },
      organizationId: '30000000-0000-4000-8000-000000000001',
      recordLockService: { release: jest.fn() },
    })

    const response = await POST(
      makeRequest({
        resourceKind: 'sales.quote',
        resourceId: '40000000-0000-4000-8000-000000000001',
        token: '50000000-0000-4000-8000-000000000001',
        reason: 'conflict_resolved',
      }),
    )

    expect(response.status).toBe(400)
  })

  test('passes explicit conflict resolution payload to service and returns result', async () => {
    const release = jest.fn().mockResolvedValue({
      ok: true,
      released: true,
      conflictResolved: true,
    })

    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: {
        sub: '10000000-0000-4000-8000-000000000001',
        tenantId: '20000000-0000-4000-8000-000000000001',
      },
      organizationId: '30000000-0000-4000-8000-000000000001',
      recordLockService: { release },
    })

    const response = await POST(
      makeRequest({
        resourceKind: 'sales.quote',
        resourceId: '40000000-0000-4000-8000-000000000001',
        token: '50000000-0000-4000-8000-000000000001',
        reason: 'conflict_resolved',
        conflictId: '60000000-0000-4000-8000-000000000001',
        resolution: 'accept_incoming',
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      ok: true,
      released: true,
      conflictResolved: true,
    })
    expect(release).toHaveBeenCalledWith({
      token: '50000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '40000000-0000-4000-8000-000000000001',
      reason: 'conflict_resolved',
      conflictId: '60000000-0000-4000-8000-000000000001',
      resolution: 'accept_incoming',
      tenantId: '20000000-0000-4000-8000-000000000001',
      organizationId: '30000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000001',
    })
  })

  test('accepts conflict_resolved payload without token and passes it to service', async () => {
    const release = jest.fn().mockResolvedValue({
      ok: true,
      released: false,
      conflictResolved: true,
    })

    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      auth: {
        sub: '10000000-0000-4000-8000-000000000001',
        tenantId: '20000000-0000-4000-8000-000000000001',
      },
      organizationId: '30000000-0000-4000-8000-000000000001',
      recordLockService: { release },
    })

    const response = await POST(
      makeRequest({
        resourceKind: 'sales.quote',
        resourceId: '40000000-0000-4000-8000-000000000001',
        reason: 'conflict_resolved',
        conflictId: '60000000-0000-4000-8000-000000000001',
        resolution: 'accept_incoming',
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      ok: true,
      released: false,
      conflictResolved: true,
    })
    expect(release).toHaveBeenCalledWith({
      token: undefined,
      resourceKind: 'sales.quote',
      resourceId: '40000000-0000-4000-8000-000000000001',
      reason: 'conflict_resolved',
      conflictId: '60000000-0000-4000-8000-000000000001',
      resolution: 'accept_incoming',
      tenantId: '20000000-0000-4000-8000-000000000001',
      organizationId: '30000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000001',
    })
  })
})
