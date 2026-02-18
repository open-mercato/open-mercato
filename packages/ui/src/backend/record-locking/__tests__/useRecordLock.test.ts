import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { readRecordLockError, useRecordLock, type RecordLockConflict } from '../useRecordLock'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  withScopedApiHeaders: async <T,>(_headers: Record<string, string>, run: () => Promise<T>): Promise<T> => run(),
}))

describe('readRecordLockError', () => {
  test('maps conflict payload', () => {
    const payload = {
      code: 'record_lock_conflict',
      error: 'Conflict detected',
      conflict: {
        id: '10000000-0000-4000-8000-000000000001',
        resourceKind: 'sales.quote',
        resourceId: '20000000-0000-4000-8000-000000000001',
        baseActionLogId: '30000000-0000-4000-8000-000000000001',
        incomingActionLogId: '40000000-0000-4000-8000-000000000001',
        resolutionOptions: ['accept_mine'] as const,
        changes: [
          {
            field: 'displayName',
            displayValue: 'Acme',
            baseValue: 'Acme',
            incomingValue: 'Acme Updated',
            mineValue: 'Acme Admin',
          },
        ],
      },
    }

    const parsed = readRecordLockError(payload)
    expect(parsed.code).toBe('record_lock_conflict')
    expect(parsed.message).toBe('Conflict detected')
    expect(parsed.conflict?.id).toBe('10000000-0000-4000-8000-000000000001')
    expect(parsed.conflict?.changes[0]?.field).toBe('displayName')
    expect(parsed.conflict?.changes[0]?.displayValue).toBe('Acme')
  })

  test('falls back to generic message for unknown input', () => {
    const parsed = readRecordLockError(undefined)
    expect(parsed.message).toBe('Request failed')
    expect(parsed.code).toBeUndefined()
  })
})

describe('useRecordLock accept incoming', () => {
  const mockApiCall = apiCall as unknown as jest.Mock

  beforeEach(() => {
    mockApiCall.mockReset()
  })

  test('calls explicit release flow with conflict_resolved payload', async () => {
    mockApiCall
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: {
          ok: true,
          enabled: true,
          resourceEnabled: true,
          strategy: 'optimistic',
          allowForceUnlock: true,
          heartbeatSeconds: 30,
          acquired: false,
          latestActionLogId: null,
          lock: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: {
          ok: true,
          released: false,
          conflictResolved: true,
        },
      })

    const { result, unmount } = renderHook(() => useRecordLock({
      resourceKind: 'customers.company',
      resourceId: '10000000-0000-4000-8000-000000000001',
      enabled: true,
      autoCheckAcl: false,
    }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledTimes(1)
    })

    const conflict: RecordLockConflict = {
      id: '20000000-0000-4000-8000-000000000001',
      resourceKind: 'customers.company',
      resourceId: '10000000-0000-4000-8000-000000000001',
      baseActionLogId: '30000000-0000-4000-8000-000000000001',
      incomingActionLogId: '40000000-0000-4000-8000-000000000001',
      resolutionOptions: ['accept_mine'],
      changes: [],
    }

    let accepted = false
    await act(async () => {
      accepted = await result.current.acceptIncoming(conflict)
    })

    expect(accepted).toBe(true)
    expect(mockApiCall).toHaveBeenNthCalledWith(
      2,
      '/api/record_locks/release',
      expect.objectContaining({
        method: 'POST',
      }),
    )

    const request = mockApiCall.mock.calls[1]?.[1] as { body?: string } | undefined
    const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>
    expect(body).toMatchObject({
      resourceKind: 'customers.company',
      resourceId: '10000000-0000-4000-8000-000000000001',
      reason: 'conflict_resolved',
      conflictId: conflict.id,
      resolution: 'accept_incoming',
    })
    expect(body).not.toHaveProperty('token')

    unmount()
  })

  test('clears lock token after successful accept incoming release', async () => {
    mockApiCall
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: {
          ok: true,
          enabled: true,
          resourceEnabled: true,
          strategy: 'optimistic',
          allowForceUnlock: true,
          heartbeatSeconds: 30,
          acquired: true,
          latestActionLogId: '30000000-0000-4000-8000-000000000001',
          lock: {
            id: '50000000-0000-4000-8000-000000000001',
            resourceKind: 'customers.company',
            resourceId: '10000000-0000-4000-8000-000000000001',
            token: 'lock-token-1',
            strategy: 'optimistic',
            status: 'active',
            lockedByUserId: '60000000-0000-4000-8000-000000000001',
            baseActionLogId: '30000000-0000-4000-8000-000000000001',
            lockedAt: new Date().toISOString(),
            lastHeartbeatAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: {
          ok: true,
          released: true,
          conflictResolved: true,
        },
      })

    const { result, unmount } = renderHook(() => useRecordLock({
      resourceKind: 'customers.company',
      resourceId: '10000000-0000-4000-8000-000000000001',
      enabled: true,
      autoCheckAcl: false,
    }))

    await waitFor(() => {
      expect(result.current.lock?.token).toBe('lock-token-1')
    })

    const conflict: RecordLockConflict = {
      id: '20000000-0000-4000-8000-000000000002',
      resourceKind: 'customers.company',
      resourceId: '10000000-0000-4000-8000-000000000001',
      baseActionLogId: '30000000-0000-4000-8000-000000000001',
      incomingActionLogId: '70000000-0000-4000-8000-000000000001',
      resolutionOptions: ['accept_mine'],
      changes: [],
    }

    await act(async () => {
      const accepted = await result.current.acceptIncoming(conflict)
      expect(accepted).toBe(true)
    })

    await waitFor(() => {
      expect(result.current.lock?.token).toBeNull()
      expect(result.current.lock?.status).toBe('released')
      expect(result.current.latestActionLogId).toBe('70000000-0000-4000-8000-000000000001')
    })

    const request = mockApiCall.mock.calls[1]?.[1] as { body?: string } | undefined
    const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>
    expect(body.token).toBe('lock-token-1')

    unmount()
  })
})
