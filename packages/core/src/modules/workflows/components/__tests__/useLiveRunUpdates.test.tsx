/**
 * @jest-environment jsdom
 *
 * Live run updates over the DOM Event Bridge (spec §8.3).
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useLiveRunUpdates, LIVE_REFRESH_THROTTLE_MS } from '../run/useLiveRunUpdates'

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111'

function emit(id: string, payload: Record<string, unknown> = {}) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(APP_EVENT_DOM_NAME, {
        detail: { id, payload, timestamp: Date.now(), organizationId: 'org-1' },
      })
    )
  })
}

function Probe(props: Parameters<typeof useLiveRunUpdates>[0]) {
  useLiveRunUpdates(props)
  return null
}

describe('useLiveRunUpdates', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  function flushThrottle() {
    act(() => {
      jest.advanceTimersByTime(LIVE_REFRESH_THROTTLE_MS + 10)
    })
  }

  it('refreshes on a matching instance lifecycle event', () => {
    const onRefresh = jest.fn()
    render(<Probe instanceId={INSTANCE_ID} onRefresh={onRefresh} />)

    emit('workflows.instance.completed', { id: INSTANCE_ID })
    flushThrottle()

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('ignores an event for a different instance', () => {
    const onRefresh = jest.fn()
    render(<Probe instanceId={INSTANCE_ID} onRefresh={onRefresh} />)

    emit('workflows.instance.completed', { id: 'some-other-instance' })
    flushThrottle()

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('accepts every instance when no id is given — the run list', () => {
    const onRefresh = jest.fn()
    render(<Probe onRefresh={onRefresh} />)

    emit('workflows.instance.started', { id: 'anything' })
    flushThrottle()

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst into one refresh', () => {
    const onRefresh = jest.fn()
    render(<Probe onRefresh={onRefresh} />)

    for (let index = 0; index < 25; index += 1) {
      emit('workflows.instance.started', { id: `instance-${index}` })
    }
    flushThrottle()

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes again after the throttle window', () => {
    const onRefresh = jest.fn()
    render(<Probe onRefresh={onRefresh} />)

    emit('workflows.instance.started', {})
    flushThrottle()
    emit('workflows.instance.completed', {})
    flushThrottle()

    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('ignores unrelated module events', () => {
    const onRefresh = jest.fn()
    render(<Probe onRefresh={onRefresh} />)

    emit('workflows.task.assigned', { id: INSTANCE_ID })
    emit('customers.person.created', {})
    flushThrottle()

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('refreshes after the bridge reconnects, to close the gap the drop left', () => {
    const onRefresh = jest.fn()
    render(<Probe onRefresh={onRefresh} />)

    emit('om:bridge:reconnected')
    flushThrottle()

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    const onRefresh = jest.fn()
    render(<Probe instanceId={INSTANCE_ID} onRefresh={onRefresh} enabled={false} />)

    emit('workflows.instance.completed', { id: INSTANCE_ID })
    flushThrottle()

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('does not fire after unmount', () => {
    const onRefresh = jest.fn()
    const { unmount } = render(<Probe onRefresh={onRefresh} />)

    emit('workflows.instance.started', {})
    unmount()
    flushThrottle()

    expect(onRefresh).not.toHaveBeenCalled()
  })
})
