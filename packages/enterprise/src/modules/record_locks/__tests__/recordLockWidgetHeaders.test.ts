import widget from '../widgets/injection/record-locking/widget'
import {
  clearRecordLockFormState,
  getRecordLockFormState,
  setRecordLockFormState,
  type RecordLockUiConflict,
  type RecordLockUiView,
} from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'
import { validateBeforeSave } from '../widgets/injection/record-locking/widget.client'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('../widgets/injection/record-locking/widget.client', () => ({
  ...jest.requireActual<typeof import('../widgets/injection/record-locking/widget.client')>('../widgets/injection/record-locking/widget.client'),
  __esModule: true,
  default: () => null,
  validateBeforeSave: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

const mockedValidateBeforeSave = validateBeforeSave as jest.MockedFunction<typeof validateBeforeSave>
const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>

function buildApiResult(result: Record<string, unknown>, status = 200) {
  return {
    ok: status < 400,
    status,
    result,
    response: new Response(JSON.stringify(result), { status }),
    cacheStatus: null,
  }
}

describe('record lock widget resolution headers', () => {
  const formId = 'record-lock:test-form'
  const conflictId = 'a0000000-0000-4000-8000-000000000001'
  const lock: RecordLockUiView = {
    id: 'c0000000-0000-4000-8000-000000000001',
    resourceKind: 'sales.quote',
    resourceId: 'b0000000-0000-4000-8000-000000000001',
    token: 'lock-token',
    strategy: 'optimistic',
    status: 'active',
    lockedByUserId: 'user-1',
    baseActionLogId: 'log-1',
    lockedAt: '2026-06-03T10:00:00.000Z',
    lastHeartbeatAt: '2026-06-03T10:00:00.000Z',
    expiresAt: '2026-06-03T10:05:00.000Z',
  }
  const conflict: RecordLockUiConflict = {
    id: conflictId,
    resourceKind: lock.resourceKind,
    resourceId: lock.resourceId,
    baseActionLogId: 'log-1',
    incomingActionLogId: 'log-2',
    allowIncomingOverride: true,
    canOverrideIncoming: true,
    resolutionOptions: ['accept_mine'],
    changes: [],
  }

  beforeEach(() => {
    clearRecordLockFormState(formId)
    mockedValidateBeforeSave.mockReset()
    mockedValidateBeforeSave.mockResolvedValue({ ok: true })
    mockedApiCall.mockReset()
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

  test('preserves ownership when failed validation returns the same active lock without its token', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    mockedValidateBeforeSave.mockResolvedValue({
      ok: false,
      lock: { ...lock, token: null },
      conflict,
    })

    const result = await widget.eventHandlers.onBeforeSave({}, { formId })

    expect(result.ok).toBe(false)
    expect(getRecordLockFormState(formId)?.lock?.token).toBe('lock-token')
    expect(getRecordLockFormState(formId)?.conflict).toEqual(conflict)
  })

  test('keeps a foreign lock tokenless after failed validation', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
    })
    mockedValidateBeforeSave.mockResolvedValue({
      ok: false,
      lock: { ...lock, id: 'foreign-lock', lockedByUserId: 'user-2', token: null },
      conflict,
    })

    await widget.eventHandlers.onBeforeSave({}, { formId })

    expect(getRecordLockFormState(formId)?.lock?.token).toBeNull()
    expect(getRecordLockFormState(formId)?.lock?.lockedByUserId).toBe('user-2')
  })

  test('awaits the current baseline before finishing a successful save without releasing its token', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
      conflict,
      pendingConflictId: conflict.id,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })
    let completeAcquire: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall
      .mockImplementationOnce(() => new Promise((resolve) => { completeAcquire = resolve }))
    let finished = false
    const saving = widget.eventHandlers.onAfterSave({}, { formId }).then(() => { finished = true })

    expect(mockedApiCall).toHaveBeenCalledTimes(1)
    expect(mockedApiCall.mock.calls[0][0]).toBe('/api/record_locks/acquire')
    expect(JSON.parse(String(mockedApiCall.mock.calls[0][1]?.body))).toEqual({
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
    })
    expect(finished).toBe(false)
    expect(getRecordLockFormState(formId)?.latestActionLogId).toBe('log-1')
    completeAcquire(buildApiResult({
      ok: true,
      acquired: false,
      lock,
      latestActionLogId: 'log-2',
      currentUserId: 'user-1',
      heartbeatSeconds: 30,
      allowForceUnlock: true,
    }))
    await saving

    expect(getRecordLockFormState(formId)).toMatchObject({
      acquired: false,
      lock: { id: lock.id, token: 'lock-token' },
      latestActionLogId: 'log-2',
      conflict: null,
      pendingConflictId: null,
      pendingResolution: 'normal',
      pendingResolutionArmed: false,
    })
  })

  test('immediate consecutive mutations carry the baseline from the previous successful write', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    mockedApiCall
      .mockResolvedValueOnce(buildApiResult({
        ok: true,
        acquired: false,
        lock,
        latestActionLogId: 'log-2',
      }))
      .mockResolvedValueOnce(buildApiResult({
        ok: true,
        acquired: false,
        lock,
        latestActionLogId: 'log-3',
      }))

    await widget.eventHandlers.onAfterSave({}, { formId })
    const nextMutation = await widget.eventHandlers.onBeforeSave({}, { formId })
    expect(nextMutation.ok).toBe(true)
    if (!nextMutation.ok) throw new Error('[internal] Expected next mutation to pass')
    expect(nextMutation.requestHeaders).toMatchObject({
      'x-om-record-lock-token': 'lock-token',
      'x-om-record-lock-base-log-id': 'log-2',
    })
    await widget.eventHandlers.onAfterSave({}, { formId })

    expect(mockedApiCall).toHaveBeenCalledTimes(2)
    expect(mockedApiCall.mock.calls.every(([url]) => url === '/api/record_locks/acquire')).toBe(true)
    expect(getRecordLockFormState(formId)?.latestActionLogId).toBe('log-3')
  })

  test('preserves existing ownership and baseline if refreshing after save fails', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    const priorState = getRecordLockFormState(formId)
    mockedApiCall
      .mockResolvedValueOnce(buildApiResult({ error: 'Unavailable' }, 503))

    await expect(widget.eventHandlers.onAfterSave({}, { formId })).rejects.toThrow()

    expect(getRecordLockFormState(formId)).toBe(priorState)
  })

  test('does not clear an incoming conflict received while refreshing the saved lock', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    let completeAcquire: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall
      .mockImplementationOnce(() => new Promise((resolve) => { completeAcquire = resolve }))
    const saving = widget.eventHandlers.onAfterSave({}, { formId })
    await Promise.resolve()
    setRecordLockFormState(formId, {
      conflict,
      pendingConflictId: conflict.id,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })
    completeAcquire(buildApiResult({
      ok: true,
      acquired: true,
      lock: { ...lock, token: 'next-token', baseActionLogId: 'log-2' },
      latestActionLogId: 'log-2',
    }))
    await saving

    expect(getRecordLockFormState(formId)?.conflict).toBe(conflict)
    expect(getRecordLockFormState(formId)).toMatchObject({
      acquired: true,
      lock: { token: 'next-token' },
      latestActionLogId: 'log-1',
      pendingConflictId: conflict.id,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })
  })

  test('preserves ownership and a new conflict when refreshing after save fails', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    let completeAcquire: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall
      .mockImplementationOnce(() => new Promise((resolve) => { completeAcquire = resolve }))
    const saving = widget.eventHandlers.onAfterSave({}, { formId })
    await Promise.resolve()
    setRecordLockFormState(formId, {
      conflict,
      pendingConflictId: conflict.id,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })
    completeAcquire(buildApiResult({ error: 'Unavailable' }, 503))

    await expect(saving).rejects.toThrow()

    expect(getRecordLockFormState(formId)).toMatchObject({
      lock: { token: 'lock-token' },
      latestActionLogId: 'log-1',
      conflict,
      pendingConflictId: conflict.id,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })
  })

  test.each(['unmounted', 'changed-record', 'deleted'] as const)(
    'releases a newly acquired token if the form %s while refreshing',
    async (navigation) => {
      setRecordLockFormState(formId, {
        formId,
        resourceKind: lock.resourceKind,
        resourceId: lock.resourceId,
        lock,
        latestActionLogId: 'log-1',
      })
      let completeAcquire: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
      mockedApiCall
        .mockImplementationOnce(() => new Promise((resolve) => { completeAcquire = resolve }))
        .mockResolvedValueOnce(buildApiResult({ ok: true, released: true }))
      const saving = widget.eventHandlers.onAfterSave({}, { formId })
      await Promise.resolve()
      if (navigation === 'deleted') {
        setRecordLockFormState(formId, { recordDeleted: true, lock: null })
      } else {
        clearRecordLockFormState(formId)
      }
      if (navigation === 'changed-record') {
        setRecordLockFormState(formId, {
          formId,
          resourceKind: 'sales.order',
          resourceId: 'other-record',
        })
      }
      const navigatedState = getRecordLockFormState(formId)
      completeAcquire(buildApiResult({
        ok: true,
        acquired: true,
        lock: { ...lock, token: 'next-token', baseActionLogId: 'log-2' },
        latestActionLogId: 'log-2',
      }))
      await saving

      expect(mockedApiCall).toHaveBeenCalledTimes(2)
      expect(mockedApiCall.mock.calls[1][0]).toBe('/api/record_locks/release')
      expect(JSON.parse(String(mockedApiCall.mock.calls[1][1]?.body))).toEqual({
        resourceKind: lock.resourceKind,
        resourceId: lock.resourceId,
        token: 'next-token',
        reason: 'unmount',
      })
      expect(getRecordLockFormState(formId)).toBe(navigatedState)
    },
  )

  test('clears state after deletion without reacquiring a lock for the deleted record', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })

    await widget.eventHandlers.onAfterDelete({}, { formId })

    expect(mockedApiCall).not.toHaveBeenCalled()
    expect(getRecordLockFormState(formId)).toMatchObject({ lock: null, latestActionLogId: null })
  })

  test('establishes the current baseline after a successful mutation without a prior owned token', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock: { ...lock, token: null, lockedByUserId: 'user-2' },
      latestActionLogId: 'log-1',
    })
    mockedApiCall.mockResolvedValueOnce(buildApiResult({ ok: true, lock, latestActionLogId: 'log-2' }))
    await widget.eventHandlers.onAfterSave({}, { formId })

    expect(mockedApiCall).toHaveBeenCalledTimes(1)
    expect(mockedApiCall.mock.calls[0][0]).toBe('/api/record_locks/acquire')
    expect(getRecordLockFormState(formId)).toMatchObject({ lock, latestActionLogId: 'log-2' })
  })

  test('releases and clears a removed record after a guarded save without reacquiring it', async () => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    mockedApiCall.mockResolvedValueOnce(buildApiResult({ ok: true, released: true }))

    await widget.eventHandlers.onAfterSave({}, { formId, operation: 'delete' })

    expect(mockedApiCall).toHaveBeenCalledTimes(1)
    expect(mockedApiCall.mock.calls[0][0]).toBe('/api/record_locks/release')
    expect(getRecordLockFormState(formId)).toMatchObject({ lock: null, latestActionLogId: null })
  })

  test.each([
    { name: 'a newer owned session', replacement: { ...lock, id: 'new-lock', token: 'new-token' } },
    { name: 'a foreign lock', replacement: { ...lock, id: 'foreign-lock', token: null, lockedByUserId: 'user-2' } },
    { name: 'a force-released session', replacement: { ...lock, token: null, status: 'force_released' as const } },
  ])('does not restore an obsolete post-save session over $name', async ({ replacement }) => {
    setRecordLockFormState(formId, {
      formId,
      resourceKind: lock.resourceKind,
      resourceId: lock.resourceId,
      lock,
      latestActionLogId: 'log-1',
    })
    let completeAcquire: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall.mockImplementationOnce(() => new Promise((resolve) => { completeAcquire = resolve }))
    const saving = widget.eventHandlers.onAfterSave({}, { formId })
    setRecordLockFormState(formId, {
      lock: replacement,
      latestActionLogId: 'fresh-baseline',
      conflict,
      pendingConflictId: conflict.id,
      pendingResolution: 'accept_mine',
      pendingResolutionArmed: true,
    })
    const freshState = getRecordLockFormState(formId)
    completeAcquire(buildApiResult({ ok: true, lock, latestActionLogId: 'log-2' }))

    await saving

    expect(getRecordLockFormState(formId)).toBe(freshState)
    expect(mockedApiCall).toHaveBeenCalledTimes(1)
  })
})
