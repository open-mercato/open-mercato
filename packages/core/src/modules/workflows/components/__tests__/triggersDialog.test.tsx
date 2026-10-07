/**
 * @jest-environment jsdom
 *
 * TriggersDialog (fidelity gap #5, Direction A) — the focused Triggers modal the
 * START node's cap opens, replacing the detour through the definition drawer.
 * Pins the dialog's own contract: a working copy so Cancel reverts, Save commits
 * to the caller, and the shared Cmd/Ctrl+Enter shortcut. `DefinitionTriggersEditor`
 * is stubbed — it has its own suite and pulls in the events registry.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('../TriggersEditor', () => ({
  TriggersEditor: ({
    value,
    onChange,
  }: {
    value: Array<{ triggerId: string }>
    onChange: (next: Array<{ triggerId: string }>) => void
  }) => (
    <div>
      <div data-testid="stub-count">{value.length}</div>
      <button
        type="button"
        onClick={() =>
          onChange([
            ...value,
            { triggerId: 'new', name: 'New', eventPattern: 'x.y', enabled: true, priority: 100 } as never,
          ])
        }
      >
        stub-add
      </button>
    </div>
  ),
}))

import { TriggersDialog } from '../TriggersDialog'

describe('TriggersDialog', () => {
  it('renders the focused modal with its title', () => {
    renderWithProviders(
      <TriggersDialog open onOpenChange={jest.fn()} triggers={[]} onSave={jest.fn()} />,
    )
    expect(screen.getByTestId('workflow-triggers-dialog')).toBeInTheDocument()
    expect(screen.getByText('Triggers')).toBeInTheDocument()
  })

  it('commits the working copy only on Save', () => {
    const onSave = jest.fn()
    const onOpenChange = jest.fn()
    renderWithProviders(
      <TriggersDialog open onOpenChange={onOpenChange} triggers={[]} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText('stub-add'))
    expect(screen.getByTestId('stub-count').textContent).toBe('1')
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save triggers' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toHaveLength(1)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('discards edits on Cancel (working copy, never committed)', () => {
    const onSave = jest.fn()
    const onOpenChange = jest.fn()
    renderWithProviders(
      <TriggersDialog open onOpenChange={onOpenChange} triggers={[]} onSave={onSave} />,
    )

    fireEvent.click(screen.getByText('stub-add'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('saves on Cmd/Ctrl+Enter', () => {
    const onSave = jest.fn()
    renderWithProviders(
      <TriggersDialog open onOpenChange={jest.fn()} triggers={[]} onSave={onSave} />,
    )
    fireEvent.keyDown(screen.getByTestId('workflow-triggers-dialog'), { key: 'Enter', metaKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
