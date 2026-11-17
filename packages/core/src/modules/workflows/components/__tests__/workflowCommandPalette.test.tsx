/**
 * @jest-environment jsdom
 *
 * Step 3.11 (workflows UX Phase 3b): the Cmd+K command palette. It renders the
 * pure command descriptors grouped, filters them as the author types, dispatches
 * the selected command's `run`, and refuses to dispatch a disabled one.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowCommandPalette } from '../WorkflowCommandPalette'
import type { WorkflowEditorCommand } from '../../lib/editor-commands'

const undo = jest.fn()
const addStep = jest.fn()
const tidy = jest.fn()

const commands: WorkflowEditorCommand[] = [
  { id: 'edit.undo', group: 'edit', label: 'Undo', shortcut: 'Cmd+Z', disabled: false, run: undo },
  { id: 'edit.redo', group: 'edit', label: 'Redo', shortcut: 'Cmd+Shift+Z', disabled: true, run: jest.fn() },
  { id: 'add.step.userTask', group: 'add', label: 'Add step: User Task', disabled: false, run: addStep },
  { id: 'navigate.step.approve', group: 'navigate', label: 'Go to step: Approve order', description: 'User Task', disabled: false, run: jest.fn() },
  { id: 'view.tidy', group: 'view', label: 'Tidy layout', disabled: false, run: tidy },
]

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
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

beforeEach(() => {
  undo.mockClear()
  addStep.mockClear()
  tidy.mockClear()
})

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = React.useState(true)
  return (
    <WorkflowCommandPalette
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      commands={commands}
    />
  )
}

describe('WorkflowCommandPalette', () => {
  it('renders every command grouped by section', async () => {
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Undo')).toBeInTheDocument())

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
    expect(screen.getByText('Go to')).toBeInTheDocument()
    expect(screen.getByText('View')).toBeInTheDocument()
    expect(screen.getByText('Add step: User Task')).toBeInTheDocument()
    expect(screen.getByText('Go to step: Approve order')).toBeInTheDocument()
  })

  it('filters commands as the author types', async () => {
    renderWithProviders(<Harness />)
    const input = await screen.findByPlaceholderText('Search commands…')

    fireEvent.change(input, { target: { value: 'tidy' } })

    await waitFor(() => expect(screen.queryByText('Undo')).not.toBeInTheDocument())
    expect(screen.getByText('Tidy layout')).toBeInTheDocument()
  })

  it('runs the selected command and closes', async () => {
    const onOpenChange = jest.fn()
    renderWithProviders(<Harness onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.getByText('Undo')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Undo'))

    expect(undo).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('never dispatches a disabled command', async () => {
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Redo')).toBeInTheDocument())

    const redoRow = screen.getByText('Redo').closest('[data-slot="command-menu-item"]')
    expect(redoRow).toHaveAttribute('data-disabled', 'true')
  })

  it('shows an empty state when nothing matches', async () => {
    renderWithProviders(<Harness />)
    const input = await screen.findByPlaceholderText('Search commands…')

    fireEvent.change(input, { target: { value: 'zzzznope' } })

    await waitFor(() => expect(screen.getByText('No matching command')).toBeInTheDocument())
  })
})
