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
 *
 * Step 4.4: UPDATE_ENTITY graduates to form-first with a CommandPicker
 * combobox for config.commandId fed by /api/workflows/commands (free text
 * stays authorable; fetch failure degrades to free text with a hint).
 *
 * Step 4.5: EXECUTE_FUNCTION graduates to form-first with a FunctionPicker
 * combobox for config.functionName fed by /api/workflows/functions (free text
 * stays authorable; fetch failure degrades to free text with a hint).
 *
 * Step 4.6: SET_VARIABLE graduates to form-first with an assignments row
 * editor — a path input plus a value field with a per-row JSON toggle (plain
 * strings preserve {{template}} expressions; JSON mode round-trips structured
 * values through a keystroke-safe textarea).
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ActivityConfigFields, hasActivityConfigForm } from '../fields/ActivityConfigFields'
import { ActivityArrayEditor, type Activity } from '../fields/ActivityArrayEditor'
import type { LedgerEntry } from '../../lib/context-ledger'

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

function mockSafeCommands(commands: Array<{ commandId: string; requiredFeatures: string[] }>, ok = true) {
  apiCallMock.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/api/workflows/commands')) {
      return { ok, status: ok ? 200 : 500, result: { items: commands }, response: {}, cacheStatus: null }
    }
    return { ok: true, status: 200, result: { data: [], total: 0 }, response: {}, cacheStatus: null }
  })
}

function mockWorkflowFunctions(functions: Array<{ name: string; labelKey?: string }>, ok = true) {
  apiCallMock.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/api/workflows/functions')) {
      return { ok, status: ok ? 200 : 500, result: { items: functions }, response: {}, cacheStatus: null }
    }
    return { ok: true, status: 200, result: { data: [], total: 0 }, response: {}, cacheStatus: null }
  })
}

type EndpointCatalogItem = {
  path: string
  method: string
  summary: string
  tag: string
  params: Array<{ name: string; in: 'path' | 'query' | 'header'; required: boolean; type: string }>
  hasRequestSchema: boolean
  requestSchema?: Record<string, unknown>
}

function mockEndpointCatalog(items: EndpointCatalogItem[], ok = true) {
  apiCallMock.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/api/workflows/endpoints')) {
      return { ok, status: ok ? 200 : 500, result: { items }, response: {}, cacheStatus: null }
    }
    return { ok: true, status: 200, result: { data: [], total: 0 }, response: {}, cacheStatus: null }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
  mockDeclaredEvents([])
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  if (typeof globalThis.ResizeObserver === 'undefined') {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    })
  }
}

describe('hasActivityConfigForm', () => {
  it('reports forms for the registry-driven types only', () => {
    expect(hasActivityConfigForm('WAIT')).toBe(true)
    expect(hasActivityConfigForm('SEND_EMAIL')).toBe(true)
    expect(hasActivityConfigForm('CALL_WEBHOOK')).toBe(true)
    expect(hasActivityConfigForm('CALL_API')).toBe(true)
    expect(hasActivityConfigForm('EMIT_EVENT')).toBe(true)
    expect(hasActivityConfigForm('UPDATE_ENTITY')).toBe(true)
    expect(hasActivityConfigForm('EXECUTE_FUNCTION')).toBe(true)
    expect(hasActivityConfigForm('SET_VARIABLE')).toBe(true)
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

  it('renders CALL_API endpoint and method inputs with the SSRF/tenant helper text', async () => {
    mockEndpointCatalog([])
    renderWithProviders(
      <ActivityConfigFields
        activityType="CALL_API"
        idPrefix="api-config"
        config={{ endpoint: '/api/orders', method: 'POST' }}
        onChange={jest.fn()}
      />,
    )

    expect(screen.getByLabelText(/workflows\.activityConfig\.CALL_API\.endpoint \*/)).toHaveValue('/api/orders')
    expect(screen.getByLabelText(/workflows\.activityConfig\.CALL_API\.method/)).toHaveValue('POST')
    expect(screen.getByText('workflows.activityConfig.CALL_API.endpointHint')).toBeInTheDocument()
    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/workflows/endpoints',
        undefined,
        expect.anything(),
      )
    })
  })

  it('fills CALL_API endpoint and method together when picking from the endpoint catalog', async () => {
    mockEndpointCatalog([
      {
        path: '/api/sales/orders',
        method: 'POST',
        summary: 'Create order',
        tag: 'Sales',
        params: [],
        hasRequestSchema: false,
      },
    ])
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="CALL_API"
        idPrefix="api-config"
        config={{}}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /workflows\.endpointPicker\.browse/ }))
    await waitFor(() => {
      expect(screen.getByText('Create order')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Create order'))

    expect(onChange).toHaveBeenCalledWith({ endpoint: '/api/sales/orders', method: 'POST' })
  })

  it('renders the CALL_WEBHOOK SSRF helper text on the URL field', () => {
    renderWithProviders(
      <ActivityConfigFields
        activityType="CALL_WEBHOOK"
        idPrefix="webhook-config"
        config={{}}
        onChange={jest.fn()}
      />,
    )

    expect(screen.getByText('workflows.activityConfig.CALL_WEBHOOK.urlHint')).toBeInTheDocument()
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

  it('renders the UPDATE_ENTITY command picker with API options selectable into config.commandId', async () => {
    mockSafeCommands([{ commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'] }])
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="UPDATE_ENTITY"
        idPrefix="update-config"
        config={{}}
        onChange={onChange}
      />,
    )

    expect(screen.getByText(/workflows\.activityConfig\.UPDATE_ENTITY\.input/)).toBeInTheDocument()
    expect(screen.getByLabelText(/workflows\.activityConfig\.UPDATE_ENTITY\.statusDictionary/)).toBeInTheDocument()

    const pickerInput = screen.getByPlaceholderText('workflows.commandPicker.placeholder')
    fireEvent.focus(pickerInput)
    await waitFor(() => {
      expect(screen.getByText('sales.orders.update')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('sales.orders.update'))
    expect(onChange).toHaveBeenCalledWith({ commandId: 'sales.orders.update' })
  })

  it('keeps free-text command ids authorable and preserved in the picker', async () => {
    mockSafeCommands([{ commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'] }])
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="UPDATE_ENTITY"
        idPrefix="update-config"
        config={{ commandId: 'custom.records.archive' }}
        onChange={onChange}
      />,
    )

    const pickerInput = screen.getByPlaceholderText('workflows.commandPicker.placeholder')
    await waitFor(() => {
      expect(pickerInput).toHaveValue('custom.records.archive')
    })

    ;(pickerInput as HTMLInputElement).focus()
    fireEvent.change(pickerInput, { target: { value: 'another.custom.command' } })
    fireEvent.keyDown(pickerInput, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ commandId: 'another.custom.command' })
  })

  it('degrades to free text with a hint when the command list fails to load', async () => {
    mockSafeCommands([], false)
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="UPDATE_ENTITY"
        idPrefix="update-config"
        config={{}}
        onChange={onChange}
      />,
    )

    const pickerInput = screen.getByPlaceholderText('workflows.commandPicker.placeholder')
    fireEvent.focus(pickerInput)
    await waitFor(() => {
      expect(screen.getByText('workflows.commandPicker.lookupUnavailable')).toBeInTheDocument()
    })

    fireEvent.change(pickerInput, { target: { value: 'custom.records.archive' } })
    fireEvent.keyDown(pickerInput, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ commandId: 'custom.records.archive' })
  })

  it('renders the EXECUTE_FUNCTION function picker with API options selectable into config.functionName', async () => {
    mockWorkflowFunctions([{ name: 'inventory.recalculateStock' }])
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="EXECUTE_FUNCTION"
        idPrefix="function-config"
        config={{}}
        onChange={onChange}
      />,
    )

    expect(screen.getByText(/workflows\.activityConfig\.EXECUTE_FUNCTION\.args/)).toBeInTheDocument()

    const pickerInput = screen.getByPlaceholderText('workflows.functionPicker.placeholder')
    fireEvent.focus(pickerInput)
    await waitFor(() => {
      expect(screen.getByText('inventory.recalculateStock')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('inventory.recalculateStock'))
    expect(onChange).toHaveBeenCalledWith({ functionName: 'inventory.recalculateStock' })
  })

  it('keeps free-text function names authorable and preserved in the picker', async () => {
    mockWorkflowFunctions([{ name: 'inventory.recalculateStock' }])
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="EXECUTE_FUNCTION"
        idPrefix="function-config"
        config={{ functionName: 'custom.unregistered.function' }}
        onChange={onChange}
      />,
    )

    const pickerInput = screen.getByPlaceholderText('workflows.functionPicker.placeholder')
    await waitFor(() => {
      expect(pickerInput).toHaveValue('custom.unregistered.function')
    })

    ;(pickerInput as HTMLInputElement).focus()
    fireEvent.change(pickerInput, { target: { value: 'another.custom.function' } })
    fireEvent.keyDown(pickerInput, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ functionName: 'another.custom.function' })
  })

  it('degrades to free text with a hint when the function list fails to load', async () => {
    mockWorkflowFunctions([], false)
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="EXECUTE_FUNCTION"
        idPrefix="function-config"
        config={{}}
        onChange={onChange}
      />,
    )

    const pickerInput = screen.getByPlaceholderText('workflows.functionPicker.placeholder')
    fireEvent.focus(pickerInput)
    await waitFor(() => {
      expect(screen.getByText('workflows.functionPicker.lookupUnavailable')).toBeInTheDocument()
    })

    fireEvent.change(pickerInput, { target: { value: 'custom.unregistered.function' } })
    fireEvent.keyDown(pickerInput, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ functionName: 'custom.unregistered.function' })
  })

  it('renders SET_VARIABLE assignment rows from existing config', () => {
    renderWithProviders(
      <ActivityConfigFields
        activityType="SET_VARIABLE"
        idPrefix="set-config"
        config={{ assignments: [{ path: 'customer.priority', value: 'high' }] }}
        onChange={jest.fn()}
      />,
    )

    const pathInput = screen.getByPlaceholderText('workflows.fieldEditors.activities.assignmentPathPlaceholder')
    expect(pathInput).toHaveValue('customer.priority')
    expect(screen.getByDisplayValue('high')).toBeInTheDocument()
    expect(screen.getByText('workflows.activityConfig.SET_VARIABLE.assignmentsHint')).toBeInTheDocument()
  })

  it('adds and removes assignment rows, updating config.assignments', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="SET_VARIABLE"
        idPrefix="set-config"
        config={{ assignments: [{ path: 'customer.priority', value: 'high' }] }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflows.fieldEditors.activities.assignmentAddRow' }))
    const pathInputs = screen.getAllByPlaceholderText('workflows.fieldEditors.activities.assignmentPathPlaceholder')
    expect(pathInputs).toHaveLength(2)

    fireEvent.change(pathInputs[1], { target: { value: 'customer.segment' } })
    expect(onChange).toHaveBeenCalledWith({
      assignments: [
        { path: 'customer.priority', value: 'high' },
        { path: 'customer.segment', value: '' },
      ],
    })

    const removeButtons = screen.getAllByRole('button', { name: 'workflows.fieldEditors.activities.assignmentRemoveRow' })
    fireEvent.click(removeButtons[0])
    fireEvent.click(screen.getByRole('button', { name: 'workflows.fieldEditors.activities.assignmentRemoveRow' }))
    expect(onChange).toHaveBeenLastCalledWith({})
  })

  it('round-trips an object value through the per-row JSON toggle', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="SET_VARIABLE"
        idPrefix="set-config"
        config={{ assignments: [{ path: 'customer.flags', value: { vip: true } }] }}
        onChange={onChange}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'workflows.fieldEditors.activities.assignmentJsonToggle' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const valueTextarea = screen.getByLabelText(/assignmentValue/)
    expect((valueTextarea as HTMLTextAreaElement).value).toContain('"vip": true')

    fireEvent.change(valueTextarea, { target: { value: '{"vip": false}' } })
    expect(onChange).toHaveBeenCalledWith({
      assignments: [{ path: 'customer.flags', value: { vip: false } }],
    })
  })

  it('does not emit while JSON is invalid and keeps the typed text', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="SET_VARIABLE"
        idPrefix="set-config"
        config={{ assignments: [{ path: 'customer.flags', value: { vip: true } }] }}
        onChange={onChange}
      />,
    )

    const valueTextarea = screen.getByLabelText(/assignmentValue/)
    fireEvent.change(valueTextarea, { target: { value: '{"vip": fal' } })

    expect(onChange).not.toHaveBeenCalled()
    expect((valueTextarea as HTMLTextAreaElement).value).toBe('{"vip": fal')
    expect(screen.getByText('workflows.fieldEditors.activities.invalidJson')).toBeInTheDocument()
  })

  it('preserves {{template}} strings as plain text values', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <ActivityConfigFields
        activityType="SET_VARIABLE"
        idPrefix="set-config"
        config={{ assignments: [{ path: 'order.ref', value: '{{context.orderId}}' }] }}
        onChange={onChange}
      />,
    )

    const valueInput = screen.getByLabelText(/assignmentValue/)
    expect(valueInput).toHaveValue('{{context.orderId}}')
    expect(valueInput.tagName).toBe('INPUT')

    fireEvent.change(valueInput, { target: { value: '{{context.orderNumber}}' } })
    expect(onChange).toHaveBeenCalledWith({
      assignments: [{ path: 'order.ref', value: '{{context.orderNumber}}' }],
    })
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
        initial={[{ ...emailActivity, activityName: 'Custom Step', activityType: 'CUSTOM_UNREGISTERED', config: {} }]}
      />,
    )

    fireEvent.click(screen.getByText('Custom Step'))

    expect(screen.queryByRole('button', { name: /advancedJson/ })).toBeNull()
    expect(screen.getByText('workflows.fieldEditors.activities.configurationJson')).toBeInTheDocument()
    expect(screen.getByText('workflows.fieldEditors.activities.configurationHint')).toBeInTheDocument()
  })

  it('renders SET_VARIABLE form-first with the assignments editor and Advanced (JSON) collapsed', () => {
    renderWithProviders(
      <StatefulEditor
        initial={[{
          ...emailActivity,
          activityName: 'Set Variable',
          activityType: 'SET_VARIABLE',
          config: { assignments: [{ path: 'customer.priority', value: 'high' }] },
        }]}
      />,
    )

    fireEvent.click(screen.getByText('Set Variable'))

    expect(screen.getByPlaceholderText('workflows.fieldEditors.activities.assignmentPathPlaceholder')).toHaveValue('customer.priority')
    expect(screen.getByDisplayValue('high')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /advancedJson/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('workflows.fieldEditors.activities.configurationHint')).toBeNull()
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

  it('renders UPDATE_ENTITY form-first with the command picker and Advanced (JSON) collapsed', async () => {
    mockSafeCommands([{ commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'] }])
    renderWithProviders(
      <StatefulEditor
        initial={[{ ...emailActivity, activityName: 'Update Entity', activityType: 'UPDATE_ENTITY', config: { commandId: 'sales.orders.update' } }]}
      />,
    )

    fireEvent.click(screen.getByText('Update Entity'))

    const pickerInput = screen.getByPlaceholderText('workflows.commandPicker.placeholder')
    await waitFor(() => {
      expect(pickerInput).toHaveValue('sales.orders.update')
    })
    expect(screen.getByRole('button', { name: /advancedJson/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('workflows.fieldEditors.activities.configurationHint')).toBeNull()
  })

  it('renders EXECUTE_FUNCTION form-first with the function picker and Advanced (JSON) collapsed', async () => {
    mockWorkflowFunctions([{ name: 'inventory.recalculateStock' }])
    renderWithProviders(
      <StatefulEditor
        initial={[{ ...emailActivity, activityName: 'Execute Function', activityType: 'EXECUTE_FUNCTION', config: { functionName: 'inventory.recalculateStock' } }]}
      />,
    )

    fireEvent.click(screen.getByText('Execute Function'))

    const pickerInput = screen.getByPlaceholderText('workflows.functionPicker.placeholder')
    await waitFor(() => {
      expect(pickerInput).toHaveValue('inventory.recalculateStock')
    })
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

describe('variable picker wiring (step 3.2)', () => {
  const ledgerEntries: LedgerEntry[] = [
    {
      path: 'dealId',
      type: 'text',
      presence: 'always',
      source: { kind: 'contextSchema', label: 'contextSchema.input' },
    },
  ]

  it('renders a picker button beside every SEND_EMAIL text and textarea field', () => {
    renderWithProviders(
      <ActivityConfigFields
        activityType="SEND_EMAIL"
        idPrefix="email-config"
        config={{}}
        onChange={jest.fn()}
        ledgerEntries={ledgerEntries}
      />,
    )

    const pickerButtons = screen.getAllByRole('button', { name: 'workflows.variablePicker.buttonLabel' })
    expect(pickerButtons).toHaveLength(4)
  })

  it('renders picker buttons even without ledger entries so the affordance stays discoverable', () => {
    renderWithProviders(
      <ActivityConfigFields
        activityType="SEND_EMAIL"
        idPrefix="email-config"
        config={{}}
        onChange={jest.fn()}
      />,
    )

    expect(
      screen.getAllByRole('button', { name: 'workflows.variablePicker.buttonLabel' }).length,
    ).toBeGreaterThan(0)
  })

  it('renders a picker button on the WAIT datetime field only in template mode', () => {
    const { unmount } = renderWithProviders(
      <ActivityConfigFields
        activityType="WAIT"
        idPrefix="wait-config"
        config={{ until: '{{context.deadline}}' }}
        onChange={jest.fn()}
        ledgerEntries={ledgerEntries}
      />,
    )
    expect(
      screen.getAllByRole('button', { name: 'workflows.variablePicker.buttonLabel' }).length,
    ).toBeGreaterThan(0)
    unmount()

    renderWithProviders(
      <ActivityConfigFields
        activityType="WAIT"
        idPrefix="wait-config"
        config={{ until: '2099-01-01T00:00:00.000Z' }}
        onChange={jest.fn()}
        ledgerEntries={ledgerEntries}
      />,
    )
    expect(
      screen.queryAllByRole('button', { name: 'workflows.variablePicker.buttonLabel' }),
    ).toHaveLength(0)
  })
})
