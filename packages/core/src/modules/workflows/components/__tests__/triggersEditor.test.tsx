/**
 * @jest-environment jsdom
 *
 * TriggersEditor (fidelity gap #5, Direction A) — the lighter inline trigger
 * editor in the Triggers modal: a Switch toggle per row, click-to-expand inline
 * editing, a built-in Manual/API row, and Add trigger. Replaces the old
 * nested-drawer editor's presentation while keeping the same data shape.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TriggersEditor } from '../TriggersEditor'
import type { WorkflowDefinitionTrigger } from '../../data/entities'

function Harness({ initial }: { initial: WorkflowDefinitionTrigger[] }) {
  const [triggers, setTriggers] = React.useState(initial)
  return (
    <>
      <TriggersEditor value={triggers} onChange={setTriggers} />
      <pre data-testid="json">{JSON.stringify(triggers)}</pre>
    </>
  )
}

const base: WorkflowDefinitionTrigger[] = [
  { triggerId: 't1', name: 'Order placed', eventPattern: 'sales.orders.created', enabled: true, priority: 100, config: {} } as WorkflowDefinitionTrigger,
]

const parsed = () => JSON.parse(screen.getByTestId('json').textContent || '[]')

describe('TriggersEditor', () => {
  it('lists triggers and the built-in Manual/API row', () => {
    renderWithProviders(<Harness initial={base} />)
    expect(screen.getByText('Order placed')).toBeInTheDocument()
    expect(screen.getByText('sales.orders.created')).toBeInTheDocument()
    expect(screen.getByText('built-in')).toBeInTheDocument()
    expect(screen.getByTestId('add-trigger')).toBeInTheDocument()
  })

  it('toggles a trigger enabled via the Switch', () => {
    renderWithProviders(<Harness initial={base} />)
    fireEvent.click(screen.getByLabelText('Enabled'))
    expect(parsed()[0].enabled).toBe(false)
  })

  it('appends a blank trigger on Add trigger', () => {
    renderWithProviders(<Harness initial={base} />)
    fireEvent.click(screen.getByTestId('add-trigger'))
    expect(parsed()).toHaveLength(2)
    expect(parsed()[1].name).toBe('')
  })

  it('expands a row and edits its name inline', () => {
    renderWithProviders(<Harness initial={base} />)
    fireEvent.click(screen.getByText('Order placed'))
    const nameInput = screen.getByDisplayValue('Order placed')
    fireEvent.change(nameInput, { target: { value: 'Order created' } })
    expect(parsed()[0].name).toBe('Order created')
  })

  it('removes a trigger (the built-in row is not a trigger)', () => {
    renderWithProviders(<Harness initial={base} />)
    fireEvent.click(screen.getAllByLabelText('Delete')[0])
    expect(parsed()).toHaveLength(0)
  })
})
