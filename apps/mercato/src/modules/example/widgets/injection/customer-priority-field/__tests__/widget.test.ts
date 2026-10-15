import type { InjectionContext } from '@open-mercato/shared/modules/widgets/injection'
import widget from '../widget'

const mockReadApi = jest.fn()
const mockScopedHeaders = jest.fn(async (_headers: Record<string, string>, action: () => Promise<unknown>) => action())
const mockConflict = jest.fn()
const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApi(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, action: () => Promise<unknown>) => mockScopedHeaders(headers, action),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: (...args: unknown[]) => mockConflict(...args) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

const oldVersion = '2026-10-01T10:00:00.000Z'
const nextVersion = '2026-10-02T10:00:00.000Z'
const context: InjectionContext = { operation: 'update', resourceId: 'person-1', t: (key: string) => `translated:${key}` }

describe('customer priority contributor persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReadApi.mockReset()
    mockConflict.mockReset().mockReturnValue(false)
  })

  it('uses the edited flat value and captured child version without fetching a newer baseline', async () => {
    mockReadApi.mockResolvedValue({ id: 'priority-1', updatedAt: nextVersion })
    const setFormValue = jest.fn()
    const data = { id: 'person-1', _example: { priority: 'normal', priorityId: 'priority-1', priorityUpdatedAt: oldVersion }, '_example.priority': 'critical' }
    await widget.eventHandlers?.onSave?.(data, { ...context, setFormValue })
    expect(mockReadApi).toHaveBeenCalledTimes(1)
    expect(mockReadApi).toHaveBeenCalledWith('/api/example/customer-priorities', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ id: 'priority-1', customerId: 'person-1', priority: 'critical' }) }))
    expect(mockScopedHeaders).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': oldVersion }, expect.any(Function))
    expect(setFormValue).toHaveBeenCalledWith('_example', { priority: 'critical', priorityId: 'priority-1', priorityUpdatedAt: nextVersion })
  })

  it('advances the child baseline so a retry after native failure neither duplicates nor self-conflicts', async () => {
    mockReadApi.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ id: 'priority-1', updatedAt: nextVersion }).mockResolvedValueOnce({ id: 'priority-1', updatedAt: '2026-10-03T10:00:00.000Z' })
    const data: Record<string, unknown> = { id: 'person-1', _example: { priority: 'normal', priorityId: null }, '_example.priority': 'high' }
    const formContext = { ...context, setFormValue: (key: string, value: unknown) => { data[key] = value } }
    await widget.eventHandlers?.onSave?.(data, formContext)
    await widget.eventHandlers?.onSave?.(data, formContext)
    expect(mockReadApi.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(mockReadApi.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1)
    expect(mockScopedHeaders.mock.calls[1][0]).toEqual({ 'x-om-ext-optimistic-lock-expected-updated-at': nextVersion })
  })

  it('surfaces stale-child conflicts and keeps the captured version', async () => {
    const conflict = { status: 409, body: { code: 'optimistic_lock_conflict' } }
    mockReadApi.mockRejectedValue(conflict)
    mockConflict.mockReturnValue(true)
    const data = { id: 'person-1', _example: { priority: 'normal', priorityId: 'priority-1', priorityUpdatedAt: oldVersion }, '_example.priority': 'high' }
    await expect(widget.eventHandlers?.onSave?.(data, context)).rejects.toEqual(conflict)
    expect(mockConflict).toHaveBeenCalledWith(conflict, context.t)
    expect(data._example.priorityUpdatedAt).toBe(oldVersion)
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('reports ordinary edit failures even when the shared save dispatcher treats them as non-blocking', async () => {
    const failure = new Error('[internal] service unavailable')
    mockReadApi.mockRejectedValue(failure)
    await expect(widget.eventHandlers?.onSave?.({ id: 'person-1', '_example.priority': 'high' }, context)).rejects.toThrow(failure)
    expect(mockFlash).toHaveBeenCalledWith('translated:example.priority.detail.error.save', 'error')
    expect(mockReadApi).toHaveBeenCalledTimes(1)
  })

  it('restores ordinary failure feedback after the native success message for the same submission only', async () => {
    mockReadApi.mockRejectedValue(new Error('Service unavailable'))
    const data = { id: 'person-1', '_example.priority': 'high' }
    await expect(widget.eventHandlers?.onSave?.(data, context)).rejects.toThrow()
    mockFlash('Person updated.', 'success')
    await widget.eventHandlers?.onAfterSave?.({ id: 'another-person' }, context)
    expect(mockFlash).toHaveBeenLastCalledWith('Person updated.', 'success')
    await widget.eventHandlers?.onAfterSave?.(data, context)
    expect(mockFlash).toHaveBeenLastCalledWith('translated:example.priority.detail.error.save', 'error')
    const callCount = mockFlash.mock.calls.length
    await widget.eventHandlers?.onAfterSave?.(data, context)
    expect(mockFlash).toHaveBeenCalledTimes(callCount)
  })

  it('clears pending failure feedback when the same submission succeeds on retry', async () => {
    const data = { id: 'person-1', _example: { priorityId: 'priority-1', priorityUpdatedAt: oldVersion }, '_example.priority': 'high' }
    mockReadApi.mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValueOnce({ id: 'priority-1', updatedAt: nextVersion })
    await expect(widget.eventHandlers?.onSave?.(data, context)).rejects.toThrow()
    await widget.eventHandlers?.onSave?.(data, context)
    mockFlash('Person updated.', 'success')
    await widget.eventHandlers?.onAfterSave?.(data, context)
    expect(mockFlash).toHaveBeenLastCalledWith('Person updated.', 'success')
  })

  it('persists create contributions only after a new resource ID is available', async () => {
    const data = { '_example.priority': 'high' }
    const createContext = { ...context, operation: 'create', resourceId: undefined }
    await widget.eventHandlers?.onSave?.(data, createContext)
    await widget.eventHandlers?.onAfterSave?.(data, createContext)
    expect(mockReadApi).not.toHaveBeenCalled()
    mockReadApi.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ id: 'priority-1', updatedAt: nextVersion })
    await widget.eventHandlers?.onAfterSave?.(data, { ...createContext, resourceId: 'new-person' })
    expect(mockReadApi).toHaveBeenLastCalledWith('/api/example/customer-priorities', expect.objectContaining({ method: 'POST', body: JSON.stringify({ customerId: 'new-person', priority: 'high' }) }))
  })

  it('reports a translated create extension failure without repeating the native create', async () => {
    mockReadApi.mockRejectedValue(new Error('[internal] service unavailable'))
    await widget.eventHandlers?.onAfterSave?.({ '_example.priority': 'high' }, { ...context, operation: 'create', resourceId: 'new-person' })
    expect(mockFlash).toHaveBeenCalledWith('translated:example.priority.detail.error.createSave', 'error')
    expect(mockReadApi).toHaveBeenCalledTimes(1)
  })

  it('does not replace a newly discovered child with a fresh lookup baseline', async () => {
    mockReadApi.mockResolvedValue({ items: [{ id: 'created-by-another-actor' }] })
    await expect(widget.eventHandlers?.onSave?.({ id: 'person-1', '_example.priority': 'high' }, context)).rejects.toThrow()
    expect(mockReadApi).toHaveBeenCalledTimes(1)
  })
})
