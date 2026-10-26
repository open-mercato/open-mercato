/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useSalesDocumentMutation } from '../useSalesDocumentMutation'

const mockTriggerEvent = jest.fn()
const mockWithScopedHeaders = jest.fn(async (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation())

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({ triggerEvent: mockTriggerEvent }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => Promise<unknown>) =>
    mockWithScopedHeaders(headers, operation),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (_key: string, fallback: string) => fallback }))

describe('sales document aggregate mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTriggerEvent.mockResolvedValue({ ok: true })
  })

  it('uses the presence session for a quote adjustment and waits for its post-save refresh', async () => {
    let finishRefresh: () => void = () => {}
    const refreshed = new Promise<void>((resolve) => { finishRefresh = resolve })
    mockTriggerEvent.mockImplementation(async (event: string) => {
      if (event === 'onAfterSave') await refreshed
      return { ok: true, requestHeaders: { 'x-om-record-lock-token': 'quote-session' } }
    })
    const operation = jest.fn(async () => 'saved')
    const { result } = renderHook(() => useSalesDocumentMutation('quote', 'quote-id'))
    const payload = { quoteId: 'quote-id', kind: 'shipping', amountNet: 15 }
    let finished = false
    let mutation: Promise<unknown> = Promise.resolve()

    await act(async () => {
      mutation = result.current(operation, payload).then((value) => { finished = true; return value })
      await Promise.resolve()
    })

    expect(operation).toHaveBeenCalledTimes(1)
    expect(finished).toBe(false)
    expect(mockWithScopedHeaders).toHaveBeenCalledWith(
      { 'x-om-record-lock-token': 'quote-session' }, operation,
    )
    expect(mockTriggerEvent).toHaveBeenCalledWith('onBeforeSave', payload, expect.objectContaining({
      formId: 'record-lock:sales.quote:quote-id',
      resourceKind: 'sales.quote',
      resourceId: 'quote-id',
      retryLastMutation: expect.any(Function),
    }))

    await act(async () => { finishRefresh(); await mutation })
    expect(finished).toBe(true)
    expect(mockTriggerEvent).toHaveBeenCalledWith('onAfterSave', payload, expect.objectContaining({
      formId: 'record-lock:sales.quote:quote-id',
    }))
  })

  it('blocks the child write when the aggregate guard detects a concurrent edit', async () => {
    mockTriggerEvent.mockResolvedValue({ ok: false, message: '[internal] Concurrent quote edit' })
    const operation = jest.fn(async () => 'saved')
    const { result } = renderHook(() => useSalesDocumentMutation('quote', 'quote-id'))
    await act(async () => {
      await expect(result.current(operation, { quoteId: 'quote-id' })).rejects.toThrow('Concurrent quote edit')
    })
    expect(operation).not.toHaveBeenCalled()
    expect(mockTriggerEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps order and quote session identities separate', async () => {
    const { result } = renderHook(() => useSalesDocumentMutation('order', 'document-id'))
    await act(async () => { await result.current(async () => 'saved', { orderId: 'document-id' }) })
    expect(mockTriggerEvent).toHaveBeenCalledWith('onBeforeSave', { orderId: 'document-id' }, expect.objectContaining({
      formId: 'record-lock:sales.order:document-id',
      resourceKind: 'sales.order',
    }))
  })
})
