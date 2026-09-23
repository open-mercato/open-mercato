/**
 * @jest-environment jsdom
 *
 * Step 1.8 (workflows UX Phase 2b): typed trigger filter and mapping editors.
 * When the selected event is an EXACT id with a declared payloadSchema, the
 * filter-condition `field` cell and the mapping `sourceExpression` cell become
 * payload-path comboboxes (paths + type badges) and the `value` cell renders a
 * type-appropriate control (boolean select, number input). Wildcard patterns
 * and schema-less events keep free text plus the untyped-payload chip. The
 * stored trigger config shape ({ filterConditions, contextMapping }) is a
 * data-model contract and must not change.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DefinitionTriggersEditor } from '../DefinitionTriggersEditor'
import type { WorkflowDefinitionTrigger } from '../../data/entities'

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: jest.fn(() => ({
    events: [
      {
        id: 'customers.deal.won',
        label: 'Deal Won',
        module: 'customers',
        category: 'lifecycle',
        payloadSchema: {
          fields: [
            { path: 'id', type: 'text' },
            { path: 'title', type: 'text' },
            { path: 'valueAmount', type: 'text', optional: true },
            { path: 'approved', type: 'boolean' },
            { path: 'lineCount', type: 'number' },
          ],
        },
      },
      { id: 'sales.order.placed', label: 'Order Placed', module: 'sales', category: 'crud' },
    ],
    eventsByModule: {},
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  })),
}))

const EDIT_ACTION_KEY = 'Edit trigger'
const DELETE_ACTION_KEY = 'Delete trigger'
const FIELD_PLACEHOLDER_KEY = 'status'
const VALUE_PLACEHOLDER_KEY = 'submitted'
const SOURCE_PLACEHOLDER_KEY = 'id'
const TARGET_PLACEHOLDER_KEY = 'orderId'
const UNTYPED_CHIP_KEY = 'Untyped event payload'
const OPTIONAL_KEY = 'optional'
const BOOLEAN_VALUE_PLACEHOLDER_KEY = 'Select value'
const UPDATE_KEY = 'Update'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

function makeTrigger(overrides: Partial<WorkflowDefinitionTrigger> = {}): WorkflowDefinitionTrigger {
  return {
    triggerId: 'deal_won_trigger',
    name: 'Deal Won Trigger',
    description: null,
    eventPattern: 'customers.deal.won',
    enabled: true,
    priority: 0,
    config: {
      filterConditions: [{ field: 'approved', operator: 'eq', value: true }],
      contextMapping: [{ targetKey: 'dealTitle', sourceExpression: 'title' }],
    },
    ...overrides,
  } as WorkflowDefinitionTrigger
}

function openEditDialog() {
  fireEvent.click(screen.getByLabelText(EDIT_ACTION_KEY))
}

describe('DefinitionTriggersEditor typed trigger editing', () => {
  it('offers payload paths with type badges in the filter field combobox for a schema event', () => {
    renderWithProviders(
      <DefinitionTriggersEditor value={[makeTrigger()]} onChange={jest.fn()} />,
    )
    openEditDialog()

    const fieldInput = screen.getByPlaceholderText(FIELD_PLACEHOLDER_KEY)
    fireEvent.focus(fieldInput)
    fireEvent.change(fieldInput, { target: { value: '' } })

    expect(screen.getByText('lineCount')).toBeInTheDocument()
    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByText('boolean')).toBeInTheDocument()
    expect(screen.getByText('number')).toBeInTheDocument()
    expect(screen.getByText(`text · ${OPTIONAL_KEY}`)).toBeInTheDocument()
    expect(screen.queryByText(UNTYPED_CHIP_KEY)).not.toBeInTheDocument()
  })

  it('renders type-appropriate value controls from the selected payload field', () => {
    renderWithProviders(
      <DefinitionTriggersEditor
        value={[makeTrigger({ config: { filterConditions: [{ field: 'approved', operator: 'eq', value: '' }] } })]}
        onChange={jest.fn()}
      />,
    )
    openEditDialog()

    expect(screen.getByText(BOOLEAN_VALUE_PLACEHOLDER_KEY)).toBeInTheDocument()

    const fieldInput = screen.getByPlaceholderText(FIELD_PLACEHOLDER_KEY)
    fireEvent.focus(fieldInput)
    fireEvent.change(fieldInput, { target: { value: 'lineCount' } })
    fireEvent.click(screen.getByText('lineCount'))

    const valueInput = screen.getByPlaceholderText(VALUE_PLACEHOLDER_KEY)
    expect(valueInput).toHaveAttribute('type', 'number')
  })

  it('keeps free text and shows the untyped-payload chip for wildcard patterns', () => {
    renderWithProviders(
      <DefinitionTriggersEditor
        value={[makeTrigger({ eventPattern: 'customers.*', config: { filterConditions: [{ field: 'status', operator: 'eq', value: 'won' }] } })]}
        onChange={jest.fn()}
      />,
    )
    openEditDialog()

    expect(screen.getAllByText(UNTYPED_CHIP_KEY).length).toBeGreaterThan(0)
    const fieldInput = screen.getByPlaceholderText(FIELD_PLACEHOLDER_KEY)
    fireEvent.focus(fieldInput)
    expect(screen.queryByText('lineCount')).not.toBeInTheDocument()
    const valueInput = screen.getByPlaceholderText(VALUE_PLACEHOLDER_KEY)
    expect(valueInput).toHaveAttribute('type', 'text')
  })

  it('shows the untyped-payload chip for exact events without a payload schema', () => {
    renderWithProviders(
      <DefinitionTriggersEditor
        value={[makeTrigger({ eventPattern: 'sales.order.placed', config: null })]}
        onChange={jest.fn()}
      />,
    )
    openEditDialog()

    expect(screen.getAllByText(UNTYPED_CHIP_KEY).length).toBeGreaterThan(0)
  })

  it('offers the payload-path combobox for mapping sourceExpression while targetKey stays free text', () => {
    renderWithProviders(
      <DefinitionTriggersEditor value={[makeTrigger()]} onChange={jest.fn()} />,
    )
    openEditDialog()

    const targetInput = screen.getByPlaceholderText(TARGET_PLACEHOLDER_KEY)
    expect(targetInput.getAttribute('data-crud-focus-target')).toBeNull()

    const sourceInput = screen.getByPlaceholderText(SOURCE_PLACEHOLDER_KEY)
    fireEvent.focus(sourceInput)
    fireEvent.change(sourceInput, { target: { value: 'valueAmount' } })
    expect(screen.getByText('valueAmount')).toBeInTheDocument()
  })

  it('preserves the stored trigger config shape on submit', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <DefinitionTriggersEditor
        value={[makeTrigger({
          config: {
            filterConditions: [{ field: 'lineCount', operator: 'eq', value: 5 }],
            contextMapping: [{ targetKey: 'dealTitle', sourceExpression: 'title' }],
          },
        })]}
        onChange={onChange}
      />,
    )
    openEditDialog()

    const valueInput = screen.getByPlaceholderText(VALUE_PLACEHOLDER_KEY)
    fireEvent.change(valueInput, { target: { value: '7' } })

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText(UPDATE_KEY))

    expect(onChange).toHaveBeenCalledTimes(1)
    const [updatedTriggers] = onChange.mock.calls[0]
    expect(updatedTriggers).toHaveLength(1)
    expect(updatedTriggers[0].config).toEqual({
      filterConditions: [{ field: 'lineCount', operator: 'eq', value: 7 }],
      contextMapping: [{ targetKey: 'dealTitle', sourceExpression: 'title', defaultValue: undefined }],
    })
    expect(updatedTriggers[0].eventPattern).toBe('customers.deal.won')
  })
})

/**
 * The trigger form is a rail now. It opens ON TOP of the definition metadata
 * drawer that hosts this editor, so its keyboard contract has to be its own:
 * Escape closes the trigger rail (not the drawer under it) and Cmd/Ctrl+Enter
 * submits the trigger (not the whole workflow).
 */
describe('DefinitionTriggersEditor trigger rail', () => {
  it('opens the trigger editor as a drawer', () => {
    renderWithProviders(<DefinitionTriggersEditor value={[makeTrigger()]} onChange={jest.fn()} />)
    openEditDialog()

    const rail = screen.getByTestId('workflow-trigger-drawer')
    expect(rail).toBeInTheDocument()
    expect(rail.getAttribute('data-slot')).toBe('drawer-content')
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const onChange = jest.fn()
    renderWithProviders(<DefinitionTriggersEditor value={[makeTrigger()]} onChange={onChange} />)
    openEditDialog()

    fireEvent.keyDown(screen.getByTestId('workflow-trigger-drawer'), { key: 'Enter', metaKey: true })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0].triggerId).toBe('deal_won_trigger')
  })

  it('closes on Escape without committing the edit', async () => {
    const onChange = jest.fn()
    renderWithProviders(<DefinitionTriggersEditor value={[makeTrigger()]} onChange={onChange} />)
    openEditDialog()

    fireEvent.keyDown(screen.getByTestId('workflow-trigger-drawer'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('workflow-trigger-drawer')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders the per-trigger delete affordance outlined, not filled', () => {
    renderWithProviders(<DefinitionTriggersEditor value={[makeTrigger()]} onChange={jest.fn()} />)

    const remove = screen.getByLabelText(DELETE_ACTION_KEY)
    expect(remove.className).toContain('destructive')
    expect(remove.className).not.toContain('bg-destructive ')
  })
})
