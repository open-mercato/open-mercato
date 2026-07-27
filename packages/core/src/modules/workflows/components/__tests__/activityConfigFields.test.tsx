/**
 * @jest-environment jsdom
 *
 * Step 4.2: registry-driven config forms replace raw JSON as the primary
 * editing surface for WAIT, SEND_EMAIL, CALL_WEBHOOK, and CALL_API activities.
 * The JsonBuilder survives as a collapsed "Advanced (JSON)" section that stays
 * in two-way sync with the form fields.
 *
 * Step 4.3: EMIT_EVENT graduates to form-first with an EventPatternInput
 * picker for config.eventName (custom values stay legal) plus a payload JSON
 * editor.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ActivityConfigFields, hasActivityConfigForm } from '../fields/ActivityConfigFields'
import { ActivityArrayEditor, type Activity } from '../fields/ActivityArrayEditor'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock

function mockDeclaredEvents(events: Array<{ id: string; label: string }>) {
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: { data: events, total: events.length },
    response: {},
    cacheStatus: null,
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
  mockDeclaredEvents([])
})

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

describe('hasActivityConfigForm', () => {
  it('reports forms for the registry-driven types only', () => {
    expect(hasActivityConfigForm('WAIT')).toBe(true)
    expect(hasActivityConfigForm('SEND_EMAIL')).toBe(true)
    expect(hasActivityConfigForm('CALL_WEBHOOK')).toBe(true)
    expect(hasActivityConfigForm('CALL_API')).toBe(true)
    expect(hasActivityConfigForm('EMIT_EVENT')).toBe(true)
    expect(hasActivityConfigForm('UPDATE_ENTITY')).toBe(false)
    expect(hasActivityConfigForm('EXECUTE_FUNCTION')).toBe(false)
    expect(hasActivityConfigForm('SET_VARIABLE')).toBe(false)
    expect(hasActivityConfigForm('UNKNOWN_TYPE')).toBe(false)
  })
})

describe('ActivityConfigFields', () => {
  it('renders WAIT config.duration through DurationInput', () => {
    renderWithProviders(
      <ActivityConfigFields
        activityType="WAIT"
        idPrefix="wait-config"
        config={{ duration: 'PT10M' }}
        onChange={jest.fn()}
      />,
    )

    const amountInput = screen.getByRole('spinbutton', { name: 'workflows.activityConfig.WAIT.duration' })
    expect(amountInput).toHaveValue(10)
  })

  it('clears WAIT until when a duration is entered (duration XOR until)', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="WAIT"
        idPrefix="wait-config"
        config={{ until: '2099-01-01T00:00:00.000Z' }}
        onChange={onChange}
      />,
    )

    const amountInput = screen.getByRole('spinbutton', { name: 'workflows.activityConfig.WAIT.duration' })
    fireEvent.change(amountInput, { target: { value: '5' } })

    expect(onChange).toHaveBeenCalledWith({ duration: 'PT5M' })
  })

  it('renders SEND_EMAIL to/subject inputs and propagates edits into config', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="SEND_EMAIL"
        idPrefix="email-config"
        config={{ subject: 'Welcome' }}
        onChange={onChange}
      />,
    )

    expect(screen.getByLabelText(/workflows\.activityConfig\.SEND_EMAIL\.subject/)).toHaveValue('Welcome')

    const toInput = screen.getByLabelText(/workflows\.activityConfig\.SEND_EMAIL\.to/)
    fireEvent.change(toInput, { target: { value: 'ops@example.com' } })

    expect(onChange).toHaveBeenCalledWith({ subject: 'Welcome', to: 'ops@example.com' })
  })

  it('renders CALL_API endpoint and method inputs', () => {
    renderWithProviders(
      <ActivityConfigFields
        activityType="CALL_API"
        idPrefix="api-config"
        config={{ endpoint: '/api/orders', method: 'POST' }}
        onChange={jest.fn()}
      />,
    )

    expect(screen.getByLabelText(/workflows\.activityConfig\.CALL_API\.endpoint/)).toHaveValue('/api/orders')
    expect(screen.getByLabelText(/workflows\.activityConfig\.CALL_API\.method/)).toHaveValue('POST')
  })

  it('renders the EMIT_EVENT event picker fed by declared events plus a payload JSON editor', async () => {
    mockDeclaredEvents([{ id: 'sales.order.created', label: 'Order Created' }])
    renderWithProviders(
      <ActivityConfigFields
        activityType="EMIT_EVENT"
        idPrefix="emit-config"
        config={{}}
        onChange={jest.fn()}
      />,
    )

    const pickerInput = screen.getByPlaceholderText('sales.orders.created')
    fireEvent.focus(pickerInput)
    await waitFor(() => {
      expect(screen.getByText('Order Created')).toBeInTheDocument()
    })

    expect(screen.getByText(/workflows\.activityConfig\.EMIT_EVENT\.payload/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('{"key": "value"}')).toBeInTheDocument()
  })

  it('writes config.eventName when a value is typed into the event picker', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="EMIT_EVENT"
        idPrefix="emit-config"
        config={{}}
        onChange={onChange}
      />,
    )

    const pickerInput = screen.getByPlaceholderText('sales.orders.created')
    fireEvent.change(pickerInput, { target: { value: 'custom.record.archived' } })
    fireEvent.keyDown(pickerInput, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith({ eventName: 'custom.record.archived' })
  })
})

describe('ActivityArrayEditor — registry-driven forms with Advanced (JSON)', () => {
  const emailActivity: Activity = {
    activityId: 'send_welcome',
    activityName: 'Send Welcome',
    activityType: 'SEND_EMAIL',
    config: { to: 'user@example.com', subject: 'Hello' },
  }

  function StatefulEditor({ initial }: { initial: Activity[] }) {
    const [activities, setActivities] = React.useState(initial)
    return (
      <ActivityArrayEditor
        id="stepActivities"
        value={activities}
        setValue={setActivities as (value: unknown) => void}
      />
    )
  }

  it('collapses the Advanced (JSON) section by default when the type has a form', () => {
    renderWithProviders(<StatefulEditor initial={[emailActivity]} />)

    fireEvent.click(screen.getByText('Send Welcome'))

    expect(screen.getByRole('button', { name: /advancedJson/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('workflows.fieldEditors.activities.configurationHint')).toBeNull()
  })

  it('keeps the JSON builder primary for types without a form yet', () => {
    renderWithProviders(
      <StatefulEditor
        initial={[{ ...emailActivity, activityName: 'Update Entity', activityType: 'UPDATE_ENTITY', config: {} }]}
      />,
    )

    fireEvent.click(screen.getByText('Update Entity'))

    expect(screen.queryByRole('button', { name: /advancedJson/ })).toBeNull()
    expect(screen.getByText('workflows.fieldEditors.activities.configurationJson')).toBeInTheDocument()
    expect(screen.getByText('workflows.fieldEditors.activities.configurationHint')).toBeInTheDocument()
  })

  it('renders EMIT_EVENT form-first with the Advanced (JSON) section collapsed', () => {
    renderWithProviders(
      <StatefulEditor
        initial={[{ ...emailActivity, activityName: 'Emit Event', activityType: 'EMIT_EVENT', config: { eventName: 'sales.order.created' } }]}
      />,
    )

    fireEvent.click(screen.getByText('Emit Event'))

    expect(screen.getByPlaceholderText('sales.orders.created')).toHaveValue('sales.order.created')
    expect(screen.getByRole('button', { name: /advancedJson/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('workflows.fieldEditors.activities.configurationHint')).toBeNull()
  })

  it('keeps the Advanced JSON view in sync after a form edit', () => {
    renderWithProviders(<StatefulEditor initial={[emailActivity]} />)

    fireEvent.click(screen.getByText('Send Welcome'))
    fireEvent.click(screen.getByRole('button', { name: /advancedJson/ }))

    const toInput = screen.getByLabelText(/workflows\.activityConfig\.SEND_EMAIL\.to/)
    fireEvent.change(toInput, { target: { value: 'ops@example.com' } })

    const jsonTextareas = screen.getAllByRole('textbox').filter((element) =>
      element.tagName === 'TEXTAREA' && (element as HTMLTextAreaElement).value.includes('"to"'),
    )
    expect(jsonTextareas).toHaveLength(1)
    expect((jsonTextareas[0] as HTMLTextAreaElement).value).toContain('"to": "ops@example.com"')
  })
})
