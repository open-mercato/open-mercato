/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useProcessDefinitionsLiveUpdates } from '../components/useProcessDefinitionsLiveUpdates'

function emit(eventId: string): void {
  window.dispatchEvent(new CustomEvent(APP_EVENT_DOM_NAME, {
    detail: { id: eventId, payload: {}, timestamp: Date.now(), organizationId: 'organization-1' },
  }))
}

describe('useProcessDefinitionsLiveUpdates', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('recovers a missed execution update on reconnect and coalesces repeated broadcasts', () => {
    const reload = jest.fn()
    renderHook(() => useProcessDefinitionsLiveUpdates(reload))

    act(() => { emit('om:bridge:reconnected') })
    expect(reload).toHaveBeenCalledTimes(1)

    act(() => {
      emit('agent_orchestrator.process.execution.started')
      emit('om:bridge:reconnected')
      emit('agent_orchestrator.process.execution.completed')
    })
    expect(reload).toHaveBeenCalledTimes(1)
    act(() => { jest.advanceTimersByTime(5000) })
    expect(reload).toHaveBeenCalledTimes(2)

    act(() => { emit('another_module.entity.created') })
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('catches an external mutation that commits after the reconnect refresh', () => {
    let lastExecution = 'failed'
    const reload = jest.fn(() => lastExecution)
    renderHook(() => useProcessDefinitionsLiveUpdates(reload))
    act(() => { emit('om:bridge:reconnected') })
    expect(reload).toHaveLastReturnedWith('failed')

    lastExecution = 'running'
    act(() => { jest.advanceTimersByTime(5000) })
    expect(reload).toHaveBeenCalledTimes(2)
    expect(reload).toHaveLastReturnedWith('running')
  })

  it('removes event listeners and the pending reload when the list unmounts', () => {
    const reload = jest.fn()
    const { unmount } = renderHook(() => useProcessDefinitionsLiveUpdates(reload))
    act(() => {
      emit('agent_orchestrator.process.execution.started')
      emit('om:bridge:reconnected')
    })
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    act(() => {
      emit('om:bridge:reconnected')
      emit('agent_orchestrator.process.execution.completed')
      jest.advanceTimersByTime(10000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
