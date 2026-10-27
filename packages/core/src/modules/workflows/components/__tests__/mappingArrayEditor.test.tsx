/**
 * @jest-environment jsdom
 *
 * Step 3.3 (workflows UX Phase 2a): the variable picker on sub-workflow
 * mapping value cells. Input-mapping hosts opt in with `variablePicker` +
 * `ledgerEntries` and the picker inserts BARE parent-context dot paths (no
 * `{{}}` — `mapInputData` resolves values with `getNestedValue`, not the
 * interpolator). Hosts that leave `variablePicker` off (output mappings,
 * whose values reference the CHILD workflow's context the parent ledger
 * cannot describe) render plain value inputs with no picker button.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MappingArrayEditor, type Mapping } from '../fields/MappingArrayEditor'
import type { LedgerEntry } from '../../lib/context-ledger'

const PICKER_BUTTON_KEY = 'workflows.variablePicker.buttonLabel'

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

const ledgerEntries: LedgerEntry[] = [
  {
    path: 'customer.email',
    type: 'text',
    presence: 'always',
    source: { kind: 'contextSchema', label: 'contextSchema.input' },
  },
]

const oneMapping: Mapping[] = [{ key: 'orderId', value: '' }]

function renderEditor({
  variablePicker,
  setValue = jest.fn(),
}: {
  variablePicker?: boolean
  setValue?: (value: unknown) => void
}) {
  renderWithProviders(
    <MappingArrayEditor
      id="mappings"
      value={oneMapping}
      setValue={setValue}
      variablePicker={variablePicker}
      ledgerEntries={variablePicker ? ledgerEntries : undefined}
    />,
  )
}

function expandFirstRow() {
  fireEvent.click(screen.getByText('orderId'))
}

describe('MappingArrayEditor variable picker', () => {
  it('shows the picker on value cells and inserts the bare path when enabled', async () => {
    const setValue = jest.fn()
    renderEditor({ variablePicker: true, setValue })

    expandFirstRow()

    fireEvent.click(screen.getByRole('button', { name: PICKER_BUTTON_KEY }))
    await waitFor(() => {
      expect(screen.getByText('customer.email')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('customer.email'))

    expect(setValue).toHaveBeenCalledWith([{ key: 'orderId', value: 'customer.email' }])
  })

  it('renders no picker button when the host does not opt in (output mappings)', () => {
    renderEditor({ variablePicker: false })

    expandFirstRow()

    expect(screen.getByDisplayValue('orderId')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: PICKER_BUTTON_KEY })).not.toBeInTheDocument()
  })
})
