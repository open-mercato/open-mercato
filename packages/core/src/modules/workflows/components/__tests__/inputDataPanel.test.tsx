/**
 * @jest-environment jsdom
 *
 * Step 1.13 (workflows UX Phase 2b): the docked Input data panel and the
 * drag-a-field-into-a-parameter gesture. jsdom cannot perform a real drag, so
 * the units are tested where they live: what a dragged row writes into the
 * dataTransfer, and what a drop inserts into a text control.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { InputDataPanel } from '../InputDataPanel'
import { ledgerDropTargetProps } from '../fields/ledgerDropTarget'
import { LEDGER_PATH_MIME } from '../../lib/ledger-drag'
import type { LedgerEntry } from '../../lib/context-ledger'

const entries: LedgerEntry[] = [
  {
    path: 'customer.email',
    type: 'text',
    presence: 'always',
    source: { kind: 'contextSchema', label: 'contextSchema.input' },
  },
  {
    path: 'riskScore',
    type: 'number',
    presence: 'maybe',
    source: { kind: 'invokeAgent', label: 'invokeAgent:risk' },
  },
  {
    path: '*',
    type: 'unknown',
    presence: 'maybe',
    source: { kind: 'trigger', label: 'trigger:t1:payload' },
  },
]

function dataTransferStub(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    dropEffect: 'none',
    effectAllowed: 'none',
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    get types() {
      return [...store.keys()]
    },
  }
}

function DropField({ onChange }: { onChange: (next: string) => void }) {
  const [value, setValue] = React.useState('to: ')
  return (
    <input
      aria-label="target"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      {...ledgerDropTargetProps({
        value,
        onValueChange: (next) => {
          setValue(next)
          onChange(next)
        },
      })}
    />
  )
}

describe('InputDataPanel', () => {
  it('lists the grouped ledger with placeholder samples and hides wildcard spreads', () => {
    renderWithProviders(<InputDataPanel entries={entries} stepId="review" />)

    expect(screen.getByText('customer.email')).toBeInTheDocument()
    expect(screen.getByText('riskScore')).toBeInTheDocument()
    expect(screen.queryByText('*')).not.toBeInTheDocument()
    expect(screen.getByText('workflows.variablePicker.groups.contextSchema')).toBeInTheDocument()
    expect(screen.getByText('workflows.variablePicker.groups.invokeAgent')).toBeInTheDocument()
  })

  it('prefers a pinned sample over the ledger placeholder', () => {
    renderWithProviders(
      <InputDataPanel
        entries={entries}
        stepId="review"
        samples={{
          review: { pinnedAt: '2026-07-01T00:00:00.000Z', source: 'manual', data: { customer: { email: 'a@b.c' } } },
        }}
      />,
    )

    expect(screen.getByText('a@b.c')).toBeInTheDocument()
  })

  it('filters rows by the search box', () => {
    renderWithProviders(<InputDataPanel entries={entries} stepId="review" />)

    fireEvent.change(screen.getByLabelText('workflows.variablePicker.searchPlaceholder'), {
      target: { value: 'risk' },
    })

    expect(screen.getByText('riskScore')).toBeInTheDocument()
    expect(screen.queryByText('customer.email')).not.toBeInTheDocument()
  })

  it('writes both drag payloads when a row starts dragging', () => {
    renderWithProviders(<InputDataPanel entries={entries} stepId="review" />)

    const dataTransfer = dataTransferStub()
    fireEvent.dragStart(screen.getByText('customer.email').closest('button') as HTMLElement, { dataTransfer })

    expect(dataTransfer.getData('text/plain')).toBe('{{customer.email}}')
    expect(dataTransfer.getData(LEDGER_PATH_MIME)).toBe('customer.email')
  })

  it('collapses to its header', () => {
    renderWithProviders(<InputDataPanel entries={entries} stepId="review" />)

    fireEvent.click(screen.getByRole('button', { expanded: true }))

    expect(screen.queryByText('customer.email')).not.toBeInTheDocument()
  })

  it('starts folded when the host asks for it, and still opens', () => {
    // The docked rail stacks this under the form rather than beside it, so an
    // expanded ledger would push the form the author came for off the top.
    renderWithProviders(<InputDataPanel entries={entries} stepId="review" defaultCollapsed />)

    expect(screen.queryByText('customer.email')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('customer.email')).toBeInTheDocument()
  })
})

describe('ledgerDropTargetProps', () => {
  it('inserts the dropped ledger path as a pill at the caret', () => {
    const onChange = jest.fn()
    renderWithProviders(<DropField onChange={onChange} />)

    const field = screen.getByLabelText('target') as HTMLInputElement
    field.setSelectionRange(4, 4)
    fireEvent.drop(field, { dataTransfer: dataTransferStub({ [LEDGER_PATH_MIME]: 'customer.email' }) })

    expect(onChange).toHaveBeenCalledWith('to: {{customer.email}}')
  })

  it('ignores drops that carry no ledger path', () => {
    const onChange = jest.fn()
    renderWithProviders(<DropField onChange={onChange} />)

    fireEvent.drop(screen.getByLabelText('target'), {
      dataTransfer: dataTransferStub({ 'text/plain': 'pasted text' }),
    })

    expect(onChange).not.toHaveBeenCalled()
  })
})
