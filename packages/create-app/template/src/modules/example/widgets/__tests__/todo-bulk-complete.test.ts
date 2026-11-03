/** @jest-environment node */
/**
 * The injected Todo bulk action.
 *
 * This is a data-only `widget.ts` on purpose: `InjectionBulkActionDefinition` has
 * no React component slot and the DataTable's bulk-action context carries no
 * `runMutation`, so the shared data-call helper plus the returned `progressJobId`
 * IS the whole contract. These tests pin that contract — the shape DataTable reads
 * to track the top progress bar, and the per-invocation idempotency key that makes
 * a double-click safe.
 */
const readApiResultOrThrow = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrow(...args),
}))

import widget from '../injection/todo-bulk-complete/widget'
import injectionTable from '../injection-table'

const TODO_1 = '00000000-0000-4000-8000-0000000000c1'
const TODO_2 = '00000000-0000-4000-8000-0000000000c2'
const PROGRESS_JOB_ID = '00000000-0000-4000-8000-0000000000e1'

const action = widget.bulkActions[0]

function lastRequestBody(): Record<string, unknown> {
  const call = readApiResultOrThrow.mock.calls.at(-1)
  return JSON.parse((call?.[1] as RequestInit).body as string)
}

describe('example todo bulk-complete injection widget', () => {
  beforeEach(() => {
    readApiResultOrThrow.mockReset()
    readApiResultOrThrow.mockResolvedValue({
      ok: true,
      progressJobId: PROGRESS_JOB_ID,
      message: 'Bulk completion started.',
    })
  })

  it('is registered on the Todo table bulk-action spot', () => {
    expect(injectionTable['data-table:example.todos.list:bulk-actions'])
      .toEqual({ widgetId: 'example.injection.todo-bulk-complete', priority: 20 })
    expect(widget.metadata.id).toBe('example.injection.todo-bulk-complete')
  })

  it('carries no React component — the definition has no slot for one', () => {
    expect(widget).not.toHaveProperty('Widget')
    expect(action).not.toHaveProperty('Component')
    expect(typeof action.onExecute).toBe('function')
  })

  it('uses an i18n key for the label rather than literal copy', () => {
    expect(action.label).toBe('example.todos.bulk.markDone')
  })

  it('posts the selected row ids and returns the progress job id to the DataTable', async () => {
    const result = await action.onExecute([{ id: TODO_1 }, { id: TODO_2 }], {})

    expect(readApiResultOrThrow).toHaveBeenCalledTimes(1)
    expect(readApiResultOrThrow.mock.calls[0][0]).toBe('/api/example/todos/bulk-complete')
    expect((readApiResultOrThrow.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(lastRequestBody().ids).toEqual([TODO_1, TODO_2])
    expect(result).toEqual({
      ok: true,
      progressJobId: PROGRESS_JOB_ID,
      message: 'Bulk completion started.',
    })
  })

  it('drops rows that carry no usable id', async () => {
    await action.onExecute([{ id: TODO_1 }, { id: '' }, { name: 'no id' }, null], {})

    expect(lastRequestBody().ids).toEqual([TODO_1])
  })

  it('sends a fresh idempotency key per invocation so a retry is a new operation', async () => {
    await action.onExecute([{ id: TODO_1 }], {})
    const first = lastRequestBody().idempotencyKey
    await action.onExecute([{ id: TODO_1 }], {})
    const second = lastRequestBody().idempotencyKey

    expect(typeof first).toBe('string')
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(second).not.toBe(first)
  })

  it('makes no request at all when nothing usable is selected', async () => {
    const result = await action.onExecute([{ name: 'no id' }], {})

    expect(readApiResultOrThrow).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, message: undefined })
  })

  it('propagates a transport failure so the DataTable can flash it', async () => {
    readApiResultOrThrow.mockRejectedValue(new Error('network down'))

    await expect(action.onExecute([{ id: TODO_1 }], {})).rejects.toThrow('network down')
  })
})
