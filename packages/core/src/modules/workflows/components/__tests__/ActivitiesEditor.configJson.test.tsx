/**
 * @jest-environment jsdom
 *
 * Guards #4234: the activity config textarea was controlled by
 * `JSON.stringify(activity.config)` and its onChange discarded anything that
 * did not parse. Every intermediate keystroke of a hand edit is invalid JSON,
 * so state never advanced and React restored the previous text — the field read
 * as frozen right after a config was pasted, pushing users to the non-visual
 * editor.
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

import { ActivitiesEditor } from '../ActivitiesEditor'

type Activity = {
  activityId: string
  activityName: string
  activityType: string
  config?: Record<string, unknown>
}

const baseActivity: Activity = {
  activityId: 'call_api_1',
  activityName: 'Call API',
  activityType: 'CALL_API',
  config: { endpoint: '/api/sales/orders' },
}

/** Host that owns the activities array, like the real dialogs do. */
function Harness({ initial = [baseActivity] }: { initial?: Activity[] }) {
  const [activities, setActivities] = React.useState<Activity[]>(initial)
  return <ActivitiesEditor value={activities as never} onChange={setActivities as never} />
}

function configTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText(/Configuration|workflows\.activities\.config/i) as HTMLTextAreaElement
}

describe('ActivitiesEditor config JSON field (#4234)', () => {
  it('accepts a keystroke that leaves the JSON temporarily invalid', () => {
    render(<Harness />)
    const textarea = configTextarea()

    // Deleting the closing brace is the first keystroke of any hand edit.
    const brokenText = textarea.value.slice(0, -1)
    fireEvent.change(textarea, { target: { value: brokenText } })

    expect(textarea.value).toBe(brokenText)
  })

  it('surfaces an inline error while the JSON is invalid', () => {
    render(<Harness />)
    fireEvent.change(configTextarea(), { target: { value: '{"endpoint": ' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(configTextarea()).toHaveAttribute('aria-invalid', 'true')
  })

  it('lets a pasted config be edited afterwards (the reported symptom)', () => {
    render(<Harness />)
    const textarea = configTextarea()

    // Paste a doc snippet…
    fireEvent.change(textarea, {
      target: { value: '{"endpoint": "/api/sales/orders", "method": "POST"}' },
    })
    // …then hand-edit it: the intermediate state is invalid JSON.
    fireEvent.change(textarea, {
      target: { value: '{"endpoint": "/api/sales/orders", "method": "POS' },
    })
    expect(textarea.value).toBe('{"endpoint": "/api/sales/orders", "method": "POS')

    // Finishing the edit clears the error and keeps the typed text.
    fireEvent.change(textarea, {
      target: { value: '{"endpoint": "/api/sales/orders", "method": "PUT"}' },
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(textarea.value).toBe('{"endpoint": "/api/sales/orders", "method": "PUT"}')
  })

  it('rejects a valid-JSON non-object (arrays would break config lookups)', () => {
    render(<Harness />)
    fireEvent.change(configTextarea(), { target: { value: '["nope"]' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('re-serializes from the canonical config on blur once valid', () => {
    render(<Harness />)
    const textarea = configTextarea()

    fireEvent.change(textarea, { target: { value: '{"endpoint":"/x"}' } })
    fireEvent.blur(textarea)

    // Back to the pretty-printed projection of the parsed config.
    expect(textarea.value).toBe(JSON.stringify({ endpoint: '/x' }, null, 2))
  })

  it('keeps the raw text on blur while it is still invalid, so work is not lost', () => {
    render(<Harness />)
    const textarea = configTextarea()

    fireEvent.change(textarea, { target: { value: '{"endpoint": ' } })
    fireEvent.blur(textarea)

    expect(textarea.value).toBe('{"endpoint": ')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
