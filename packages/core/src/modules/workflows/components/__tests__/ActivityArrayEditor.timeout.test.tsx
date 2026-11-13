/** @jest-environment jsdom */

/**
 * The timeout box in this editor displays the activity's effective timeout,
 * which may come from either field. It must therefore write both, or an edit
 * made here is discarded at run time in favour of a stale `timeoutMs`.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { resolveActivityTimeoutMs } from '../../lib/activityTimeoutFields'
import { ActivityArrayEditor, type Activity } from '../fields/ActivityArrayEditor'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/JsonBuilder', () => ({
  JsonBuilder: () => <div data-testid="json-builder" />,
}))

function renderEditor(activity: Activity) {
  const setValue = jest.fn()
  const { container } = render(
    <ActivityArrayEditor id="activities" value={[activity]} setValue={setValue} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Call API/ }))
  const input = container.querySelector<HTMLInputElement>('#activities-0-timeout')
  if (!input) throw new Error('[internal] timeout input not rendered')
  return { container, input, setValue }
}

const baseActivity: Activity = {
  activityId: 'call_api_1',
  activityName: 'Call API',
  activityType: 'CALL_API',
  config: { endpoint: '/api/x' },
}

function lastActivity(setValue: jest.Mock): Activity {
  const [activities] = setValue.mock.calls[setValue.mock.calls.length - 1] as [Activity[]]
  return activities[0]
}

describe('ActivityArrayEditor timeout binding', () => {
  it('shows the canonical timeout of an activity written by a visual editor', () => {
    const { input } = renderEditor({ ...baseActivity, timeoutMs: 5000 })
    expect(input.value).toBe('5000')
  })

  it('applies an edit to the timeout the executor resolves', () => {
    const { input, setValue } = renderEditor({ ...baseActivity, timeoutMs: 5000 })

    fireEvent.change(input, { target: { value: '60000' } })

    expect(resolveActivityTimeoutMs(lastActivity(setValue))).toBe(60000)
  })

  it('clears the timeout when the box is emptied', () => {
    const { input, setValue } = renderEditor({ ...baseActivity, timeoutMs: 5000, timeout: '5000' })

    fireEvent.change(input, { target: { value: '' } })

    expect(resolveActivityTimeoutMs(lastActivity(setValue))).toBeUndefined()
  })

  it('resolves a duration string typed into the box', () => {
    const { container, setValue } = renderEditor(baseActivity)

    // An activity with no timeout yet renders the duration picker, whose
    // amount box only accepts numbers; a raw duration string is typed through
    // the picker's text escape hatch.
    fireEvent.click(screen.getByRole('button', { name: 'Edit as text' }))
    const rawInput = container.querySelector<HTMLInputElement>('#activities-0-timeout')
    if (!rawInput) throw new Error('[internal] timeout input not rendered')

    fireEvent.change(rawInput, { target: { value: 'PT30S' } })

    expect(resolveActivityTimeoutMs(lastActivity(setValue))).toBe(30000)
  })

  it('writes both timeout fields when the duration picker sets an amount', () => {
    const { input, setValue } = renderEditor(baseActivity)

    fireEvent.change(input, { target: { value: '30' } })

    const activity = lastActivity(setValue)
    expect(activity.timeout).toBe('PT30M')
    expect(resolveActivityTimeoutMs(activity)).toBe(30 * 60 * 1000)
  })
})
