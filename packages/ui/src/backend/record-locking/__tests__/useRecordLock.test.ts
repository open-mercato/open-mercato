import { readRecordLockError } from '../useRecordLock'

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
        resolutionOptions: ['accept_incoming', 'accept_mine'] as const,
        changes: [
          {
            field: 'displayName',
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
  })

  test('falls back to generic message for unknown input', () => {
    const parsed = readRecordLockError(undefined)
    expect(parsed.message).toBe('Request failed')
    expect(parsed.code).toBeUndefined()
  })
})
