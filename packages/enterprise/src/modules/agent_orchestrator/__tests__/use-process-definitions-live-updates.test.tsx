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

  it('coalesces catch-up and execution reloads that share the same deadline', () => {
    const reload = jest.fn()
    renderHook(() => useProcessDefinitionsLiveUpdates(reload))
    act(() => {
      emit('om:bridge:reconnected')
      emit('agent_orchestrator.process.execution.started')
    })
    act(() => { jest.advanceTimersByTime(5000) })
    expect(reload).toHaveBeenCalledTimes(2)
    act(() => { jest.advanceTimersByTime(5000) })
    expect(reload).toHaveBeenCalledTimes(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('observes a late mutation after reconnect and execution events during an existing cooldown', () => {
    jest.setSystemTime(0)
    let lastExecution = 'failed'
    const reload = jest.fn(() => ({ at: Date.now(), lastExecution }))
    renderHook(() => useProcessDefinitionsLiveUpdates(reload))

    act(() => { emit('agent_orchestrator.process.execution.started') })
    expect(reload).toHaveLastReturnedWith({ at: 0, lastExecution: 'failed' })

    act(() => { jest.advanceTimersByTime(3000) })
    act(() => { emit('om:bridge:reconnected') })
    act(() => { jest.advanceTimersByTime(1000) })
    act(() => { emit('agent_orchestrator.process.execution.completed') })
    expect(reload).toHaveBeenCalledTimes(1)

    act(() => { jest.advanceTimersByTime(1000) })
    expect(reload).toHaveBeenCalledTimes(2)
    expect(reload).toHaveLastReturnedWith({ at: 5000, lastExecution: 'failed' })

    act(() => { jest.advanceTimersByTime(1000) })
    lastExecution = 'running'
    act(() => { jest.advanceTimersByTime(3999) })
    expect(reload).toHaveBeenCalledTimes(2)
    act(() => { jest.advanceTimersByTime(1) })
    expect(reload).toHaveBeenCalledTimes(3)
    expect(reload).toHaveLastReturnedWith({ at: 10000, lastExecution: 'running' })
    expect(jest.getTimerCount()).toBe(0)
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

  it.each([4000, 9000])('clears reconnect recovery when unmounted at %i ms', (unmountAt) => {
    const reload = jest.fn()
    const { unmount } = renderHook(() => useProcessDefinitionsLiveUpdates(reload))
    act(() => { emit('agent_orchestrator.process.execution.started') })
    act(() => { jest.advanceTimersByTime(3000) })
    act(() => { emit('om:bridge:reconnected') })
    act(() => { jest.advanceTimersByTime(1000) })
    act(() => { emit('agent_orchestrator.process.execution.completed') })
    act(() => { jest.advanceTimersByTime(unmountAt - 4000) })
    const callsBeforeUnmount = reload.mock.calls.length

    unmount()
    expect(jest.getTimerCount()).toBe(0)
    act(() => {
      emit('om:bridge:reconnected')
      emit('agent_orchestrator.process.execution.started')
      jest.advanceTimersByTime(10000)
    })
    expect(reload).toHaveBeenCalledTimes(callsBeforeUnmount)
    expect(jest.getTimerCount()).toBe(0)
  })
})
