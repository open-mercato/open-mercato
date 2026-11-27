/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  clearAllOperations,
  markRedoConsumed,
  markUndoSuccess,
  pushOperation,
} from '@open-mercato/ui/backend/operations/store'
import { useInteractionUndoRefresh } from '../useInteractionUndoRefresh'

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

function operation(id: string, resourceKind: string | null) {
  return {
    id,
    undoToken: `token-${id}`,
    commandId: 'customers.interactions.delete',
    actionLabel: null,
    resourceKind,
    resourceId: `record-${id}`,
    executedAt: new Date().toISOString(),
  }
}

describe('useInteractionUndoRefresh', () => {
  beforeEach(() => {
    reportErrorMock.mockClear()
    act(() => {
      clearAllOperations()
    })
  })

  it('refreshes when an interaction operation is undone (#9488)', async () => {
    const onRefresh = jest.fn()
    act(() => {
      pushOperation(operation('log-1', 'customers.interaction'))
    })
    renderHook(() => useInteractionUndoRefresh(onRefresh))
    expect(onRefresh).not.toHaveBeenCalled()

    act(() => {
      markUndoSuccess('token-log-1')
    })

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('refreshes when the legacy activities adapter operation is undone', async () => {
    const onRefresh = jest.fn()
    act(() => {
      pushOperation(operation('log-1', 'customers.activity'))
    })
    renderHook(() => useInteractionUndoRefresh(onRefresh))

    act(() => {
      markUndoSuccess('token-log-1')
    })

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('refreshes again when the undone interaction operation is redone', async () => {
    const onRefresh = jest.fn()
    act(() => {
      pushOperation(operation('log-1', 'customers.interaction'))
    })
    renderHook(() => useInteractionUndoRefresh(onRefresh))
    act(() => {
      markUndoSuccess('token-log-1')
    })
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))

    act(() => {
      markRedoConsumed('log-1')
    })

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2))
  })

  it('ignores undo of operations on other resources', async () => {
    const onRefresh = jest.fn()
    act(() => {
      pushOperation(operation('log-1', 'customers.deal'))
    })
    renderHook(() => useInteractionUndoRefresh(onRefresh))

    act(() => {
      markUndoSuccess('token-log-1')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('does not refresh on mount for an operation that was undone before the timeline rendered', async () => {
    const onRefresh = jest.fn()
    act(() => {
      pushOperation(operation('log-1', 'customers.interaction'))
      markUndoSuccess('token-log-1')
    })

    renderHook(() => useInteractionUndoRefresh(onRefresh))
    await act(async () => {
      await Promise.resolve()
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('reports a failed refresh instead of throwing', async () => {
    const failure = new Error('[internal] reload failed')
    const onRefresh = jest.fn(async () => {
      throw failure
    })
    act(() => {
      pushOperation(operation('log-1', 'customers.interaction'))
    })
    renderHook(() => useInteractionUndoRefresh(onRefresh, 'ActivitiesSection'))

    act(() => {
      markUndoSuccess('token-log-1')
    })

    await waitFor(() =>
      expect(reportErrorMock).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          module: 'customers',
          code: 'customers.activity_refresh_failed',
          attributes: { component: 'ActivitiesSection' },
        }),
      ),
    )
  })
})
