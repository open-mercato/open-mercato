import widget from '../widgets/injection/record-locking/widget'
import {
  clearRecordLockFormState,
  getRecordLockFormState,
  setRecordLockFormState,
} from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'
import { validateBeforeSave } from '../widgets/injection/record-locking/widget.client'

jest.mock('../widgets/injection/record-locking/widget.client', () => ({
  __esModule: true,
  default: () => null,
  validateBeforeSave: jest.fn(),
}))

const mockedValidateBeforeSave = validateBeforeSave as jest.MockedFunction<typeof validateBeforeSave>

describe('record lock widget resolution headers', () => {
  const formId = 'record-lock:test-form'
  const conflictId = 'a0000000-0000-4000-8000-000000000001'

  beforeEach(() => {
    clearRecordLockFormState(formId)
    mockedValidateBeforeSave.mockReset()
    mockedValidateBeforeSave.mockResolvedValue({ ok: true })
  })

  test('blocks save when resolution intent is not armed', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: 'customers.deal',
      resourceId: 'b0000000-0000-4000-8000-000000000001',
      conflict: {
        id: conflictId,
        resourceKind: 'customers.deal',
        resourceId: 'b0000000-0000-4000-8000-000000000001',
        baseActionLogId: null,
        incomingActionLogId: null,
        allowIncomingOverride: true,
        canOverrideIncoming: true,
        resolutionOptions: ['accept_mine'],
        changes: [],
      },
      pendingConflictId: conflictId,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: false,
    })

    const context: Parameters<NonNullable<typeof widget.eventHandlers.onBeforeSave>>[1] = { formId }
    const result = await widget.eventHandlers.onBeforeSave({}, context)
    expect(result.ok).toBe(false)
    expect(mockedValidateBeforeSave).not.toHaveBeenCalled()
  })

  test('does not call validate before save while conflict is unresolved', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: 'customers.deal',
      resourceId: 'b0000000-0000-4000-8000-000000000001',
      conflict: {
        id: conflictId,
        resourceKind: 'customers.deal',
        resourceId: 'b0000000-0000-4000-8000-000000000001',
        baseActionLogId: null,
        incomingActionLogId: null,
        allowIncomingOverride: true,
        canOverrideIncoming: true,
        resolutionOptions: ['accept_mine'],
        changes: [],
      },
      pendingConflictId: conflictId,
      pendingResolution: 'normal',
      pendingResolutionArmed: false,
    })

    const result = await widget.eventHandlers.onBeforeSave({}, { formId } as any)
    expect(result.ok).toBe(false)
    expect(mockedValidateBeforeSave).not.toHaveBeenCalled()
  })

  test('sends resolution header once and disarms it immediately', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: 'customers.deal',
      resourceId: 'b0000000-0000-4000-8000-000000000001',
      conflict: {
        id: conflictId,
        resourceKind: 'customers.deal',
        resourceId: 'b0000000-0000-4000-8000-000000000001',
        baseActionLogId: null,
        incomingActionLogId: null,
        allowIncomingOverride: true,
        canOverrideIncoming: true,
        resolutionOptions: ['accept_mine'],
        changes: [],
      },
      pendingConflictId: conflictId,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })

    const first = await widget.eventHandlers.onBeforeSave({}, { formId } as any)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('Expected successful first result')
    expect(first.requestHeaders?.['x-om-record-lock-resolution']).toBe('accept_mine')

    const consumedState = getRecordLockFormState(formId)
    expect(consumedState?.pendingResolution).toBe('normal')
    expect(consumedState?.pendingResolutionArmed).toBe(false)

    const second = await widget.eventHandlers.onBeforeSave({}, { formId } as any)
    expect(second.ok).toBe(false)
  })

  test('blocks save when record was deleted by another user', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: 'customers.deal',
      resourceId: 'b0000000-0000-4000-8000-000000000001',
      recordDeleted: true,
    })

    const result = await widget.eventHandlers.onBeforeSave({}, { formId } as any)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected blocked save result')
    expect(result.message).toContain('deleted')
    expect(mockedValidateBeforeSave).not.toHaveBeenCalled()
  })

  test('allows save with an acquired lock when no conflict or deletion is pending', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: 'customers.person',
      resourceId: 'b0000000-0000-4000-8000-000000000001',
      acquired: true,
      lock: {
        id: 'c0000000-0000-4000-8000-000000000001',
        resourceKind: 'customers.person',
        resourceId: 'b0000000-0000-4000-8000-000000000001',
        token: 'lock-token',
        strategy: 'optimistic',
        status: 'active',
        lockedByUserId: 'user-1',
        baseActionLogId: null,
        lockedAt: '2026-06-03T10:00:00.000Z',
        lastHeartbeatAt: '2026-06-03T10:00:00.000Z',
        expiresAt: '2026-06-03T10:05:00.000Z',
      },
      latestActionLogId: 'log-1',
      conflict: null,
      pendingResolution: 'normal',
      pendingResolutionArmed: false,
      recordDeleted: false,
    })

    const result = await widget.eventHandlers.onBeforeSave({}, { formId } as any)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected successful result')
    expect(result.requestHeaders).toMatchObject({
      'x-om-record-lock-kind': 'customers.person',
      'x-om-record-lock-resource-id': 'b0000000-0000-4000-8000-000000000001',
      'x-om-record-lock-token': 'lock-token',
      'x-om-record-lock-base-log-id': 'log-1',
    })
    expect(mockedValidateBeforeSave).toHaveBeenCalledTimes(1)
  })
})
