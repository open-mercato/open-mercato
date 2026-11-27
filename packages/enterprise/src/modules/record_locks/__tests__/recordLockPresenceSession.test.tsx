/** @jest-environment jsdom */
import * as React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { dispatchBackendMutationError } from '@open-mercato/ui/backend/injection/mutationEvents'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import RecordLockingWidget from '../widgets/injection/record-locking/widget.client'
import recordLockWidget from '../widgets/injection/record-locking/widget'
import {
  clearRecordLockFormState,
  getRecordLockFormState,
  setRecordLockFormState,
  type RecordLockUiConflict,
  type RecordLockUiView,
} from '../lib/clientLockStore'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation(),
}))

const mockTriggerEvent = jest.fn()
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({ triggerEvent: mockTriggerEvent }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('next/navigation', () => ({ useSearchParams: () => null }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))
jest.mock('@open-mercato/core/modules/audit_logs/lib/display-helpers', () => ({
  ChangedFieldsTable: () => null,
}))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const context = {
  formId: 'record-lock:sales.quote:quote-1',
  resourceKind: 'sales.quote',
  resourceId: 'quote-1',
}
const lock: RecordLockUiView = {
  id: 'lock-1',
  resourceKind: context.resourceKind,
  resourceId: context.resourceId,
  token: 'token-1',
  strategy: 'optimistic',
  status: 'active',
  lockedByUserId: 'user-1',
  baseActionLogId: 'log-1',
  lockedAt: '2026-10-13T10:00:00.000Z',
  lastHeartbeatAt: '2026-10-13T10:00:00.000Z',
  expiresAt: '2026-10-13T10:05:00.000Z',
}

function buildApiResult(result: Record<string, unknown>, status = 200) {
  return {
    ok: status < 400,
    status,
    result,
    response: { status } as Response,
    cacheStatus: null,
  }
}

async function mountOwnedRecord() {
  mockedApiCall.mockImplementation(async () => buildApiResult({
    ok: true,
    acquired: true,
    lock,
    latestActionLogId: 'log-1',
    currentUserId: 'user-1',
    heartbeatSeconds: 30,
  }))
  const mounted = render(<RecordLockingWidget context={context} data={{}} />)
  await waitFor(() => expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-1'))
  return mounted
}

describe('record-lock presence session freshness', () => {
  beforeEach(() => {
    clearRecordLockFormState(context.formId)
    mockedApiCall.mockReset()
  })

  afterEach(() => {
    cleanup()
    clearRecordLockFormState(context.formId)
  })

  test.each([200, 423])('ignores a delayed presence response with status %s after the session rotates', async (status) => {
    await mountOwnedRecord()
    let completePresence: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall.mockImplementationOnce(() => new Promise((resolve) => { completePresence = resolve }))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => {
      setRecordLockFormState(context.formId, {
        lock: { ...lock, id: 'lock-2', token: 'token-2', baseActionLogId: 'log-2' },
        latestActionLogId: 'log-2',
      })
    })
    const freshState = getRecordLockFormState(context.formId)

    await act(async () => {
      completePresence(buildApiResult({
        ok: status === 200,
        lock: status === 200 ? lock : { ...lock, token: null, lockedByUserId: 'user-2' },
        latestActionLogId: 'log-1',
      }, status))
    })

    expect(getRecordLockFormState(context.formId)).toBe(freshState)
    expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-2')
    expect(getRecordLockFormState(context.formId)?.latestActionLogId).toBe('log-2')
  })

  test('keeps the baseline pinned when presence returns the same session with a newer action log', async () => {
    await mountOwnedRecord()
    mockedApiCall.mockResolvedValueOnce(buildApiResult({ ok: true, lock, latestActionLogId: 'foreign-log' }))

    await act(async () => { window.dispatchEvent(new Event('focus')) })

    expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-1')
    expect(getRecordLockFormState(context.formId)?.latestActionLogId).toBe('log-1')
  })

  test.each([null, 'log-1'])('preserves an initialized %s baseline when presence reacquires a new token', async (baseline) => {
    await mountOwnedRecord()
    await act(async () => { setRecordLockFormState(context.formId, { latestActionLogId: baseline }) })
    mockedApiCall.mockResolvedValueOnce(buildApiResult({
      ok: true,
      lock: { ...lock, token: 'token-2', id: 'lock-2' },
      latestActionLogId: 'foreign-log',
    }))

    await act(async () => { window.dispatchEvent(new Event('focus')) })

    expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-2')
    expect(getRecordLockFormState(context.formId)?.latestActionLogId).toBe(baseline)
  })

  test('does not recreate state when a pending presence request finishes after unmount', async () => {
    const mounted = await mountOwnedRecord()
    let completePresence: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall.mockImplementationOnce(() => new Promise((resolve) => { completePresence = resolve }))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    mounted.unmount()

    await act(async () => { completePresence(buildApiResult({ ok: true, lock, latestActionLogId: 'log-1' })) })

    expect(getRecordLockFormState(context.formId)).toBeNull()
  })

  test('ignores an initial acquire response that arrives after the session advances', async () => {
    let completeInitialAcquire: (result: ReturnType<typeof buildApiResult>) => void = () => undefined
    mockedApiCall
      .mockImplementationOnce(() => new Promise((resolve) => { completeInitialAcquire = resolve }))
      .mockResolvedValue(buildApiResult({ ok: true, lock, latestActionLogId: 'log-1' }))
    render(<RecordLockingWidget context={context} data={{}} />)
    await waitFor(() => expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-1'))
    await act(async () => {
      setRecordLockFormState(context.formId, {
        lock: { ...lock, id: 'lock-2', token: 'token-2' },
        latestActionLogId: 'log-2',
      })
    })
    const freshState = getRecordLockFormState(context.formId)

    await act(async () => { completeInitialAcquire(buildApiResult({ ok: true, lock, latestActionLogId: 'log-1' })) })

    expect(getRecordLockFormState(context.formId)).toBe(freshState)
  })

  test.each(['inferred', 'explicit'] as const)(
    'shares one session across the shell and an %s second widget, and releases once on final unmount',
    async (secondContext) => {
      mockedApiCall.mockResolvedValue(buildApiResult({
        ok: true,
        acquired: true,
        lock,
        latestActionLogId: 'log-1',
        currentUserId: 'user-1',
      }))
      const inferredContext = { path: `/backend/sales/quotes/${context.resourceId}` }
      const mounted = render(
        <>
          <RecordLockingWidget context={inferredContext} data={{}} />
          <RecordLockingWidget context={secondContext === 'explicit' ? context : inferredContext} data={{}} />
        </>,
      )
      await waitFor(() => expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-1'))
      mockedApiCall.mockClear()

      await act(async () => { window.dispatchEvent(new Event('focus')) })

      expect(mockedApiCall).toHaveBeenCalledTimes(1)
      expect(mockedApiCall.mock.calls[0][0]).toBe('/api/record_locks/acquire')
      expect(getRecordLockFormState(context.formId)?.lock?.token).toBe('token-1')
      mockedApiCall.mockClear()
      mounted.unmount()

      expect(mockedApiCall).toHaveBeenCalledTimes(1)
      expect(mockedApiCall.mock.calls[0][0]).toBe('/api/record_locks/release')
      expect(JSON.parse(String(mockedApiCall.mock.calls[0][1]?.body)).token).toBe('token-1')
      expect(getRecordLockFormState(context.formId)).toBeNull()
    },
  )
})

describe('record-lock conflict retries', () => {
  const sourceId = 'header-stage-change'
  const conflict: RecordLockUiConflict = {
    id: '445cec8a-ce95-48a6-9dda-6736ef05e09e',
    resourceKind: context.resourceKind,
    resourceId: context.resourceId,
    baseActionLogId: 'log-1',
    incomingActionLogId: 'log-2',
    allowIncomingOverride: true,
    canOverrideIncoming: true,
    resolutionOptions: ['accept_mine'],
    changes: [],
  }

  afterEach(() => {
    cleanup()
    clearRecordLockFormState(context.formId)
    clearRecordLockFormState(sourceId)
    mockTriggerEvent.mockReset()
    mockedApiCall.mockReset()
  })

  test.each([true, false])('retries the blocked write with a details form mounted = %s', async (formMounted) => {
    const submitDetails = jest.fn((event: React.FormEvent) => event.preventDefault())
    const saveStage = jest.fn(async () => 'saved')
    const onSuccess = jest.fn()
    const validate = jest.fn()
      .mockReturnValueOnce(buildApiResult({ ok: false, conflict, lock: { ...lock, token: null } }, 409))
      .mockReturnValueOnce(buildApiResult({ ok: true, latestActionLogId: 'log-2', lock: { ...lock, token: null } }))
    mockedApiCall.mockImplementation(async (url, options) => {
      if (url === '/api/record_locks/validate') return validate(JSON.parse(String(options?.body)))
      return buildApiResult({ ok: true, acquired: true, lock, latestActionLogId: 'log-1' })
    })
    mockTriggerEvent.mockImplementation(async (event, payload, eventContext) => {
      if (event === 'onBeforeSave') return recordLockWidget.eventHandlers?.onBeforeSave?.(payload, eventContext)
      await recordLockWidget.eventHandlers?.onAfterSave?.(payload, eventContext)
      return { ok: true }
    })
    render(
      <>
        {formMounted ? <form id={context.formId} onSubmit={submitDetails} /> : null}
        <RecordLockingWidget context={context} data={{}} />
      </>,
    )
    await waitFor(() => expect(getRecordLockFormState(context.formId)?.lock?.token).toBe(lock.token))
    const mutationFormId = formMounted ? context.formId : sourceId
    const { result } = renderHook(() => useGuardedMutation({ contextId: mutationFormId }))
    const mutationPayload = { id: context.resourceId, pipelineStageId: 'stage-2' }

    await act(async () => {
      await expect(result.current.runMutation({
        operation: saveStage,
        context: { ...context, formId: mutationFormId },
        mutationPayload,
        onSuccess,
      })).rejects.toThrow('Record conflict detected')
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Keep my changes' }))
    await waitFor(() => expect(saveStage).toHaveBeenCalledTimes(1))
    expect(submitDetails).not.toHaveBeenCalled()
    expect(validate).toHaveBeenLastCalledWith(expect.objectContaining({
      token: lock.token,
      conflictId: conflict.id,
      resolution: 'accept_mine',
      mutationPayload,
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(getRecordLockFormState(mutationFormId)?.conflict ?? null).toBeNull()
  })

  test('retries the form when the form itself reports the conflict', async () => {
    await mountOwnedRecord()
    const submitDetails = jest.fn((event: React.FormEvent) => event.preventDefault())
    render(<form id={context.formId} onSubmit={submitDetails} />)
    await act(async () => {
      dispatchBackendMutationError({
        formId: context.formId,
        error: { code: 'record_lock_conflict', conflict },
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Keep my changes' }))

    await waitFor(() => expect(submitDetails).toHaveBeenCalledTimes(1))
    expect(getRecordLockFormState(context.formId)?.pendingResolution).toBe('accept_mine')
  })
})
