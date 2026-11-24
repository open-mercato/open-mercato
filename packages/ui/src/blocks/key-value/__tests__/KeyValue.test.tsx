/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { KeyValue } from '../KeyValue'
import { keyValueFixtures } from '../fixtures'
import { keyValuePropsSchema, type KeyValueProps } from '../../contracts/key-value'

const dict = {
  'ui.blocks.keyValue.edit': 'Edit {label}',
  'ui.blocks.keyValue.save': 'Save',
  'ui.blocks.keyValue.cancel': 'Cancel',
  'ui.blocks.keyValue.loading': 'Loading details',
  'ui.blocks.keyValue.error': 'Something went wrong',
  'ui.blocks.keyValue.empty': 'Nothing to show',
}

function renderBlock(props: KeyValueProps) {
  return renderWithProviders(<KeyValue {...props} />, { dict })
}

const editableItems: KeyValueProps['items'] = [
  { key: 'name', label: 'Name', value: 'Acme', editable: true, editor: 'text' },
  { key: 'notes', label: 'Notes', value: 'Hello', editable: true, editor: 'textarea' },
  { key: 'id', label: 'Record ID', value: 'REC-1' },
]

describe('KeyValue', () => {
  it('renders labels and values', () => {
    renderBlock(keyValueFixtures.readOnly)
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('Anna Kowalska')).toBeInTheDocument()
    expect(screen.getByText('Primary contact')).toBeInTheDocument()
  })

  it('shows the option label for select items and a formatted date for date items', () => {
    renderBlock(keyValueFixtures.editable)
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.queryByText('qualified')).not.toBeInTheDocument()
    expect(screen.queryByText('2026-09-01')).not.toBeInTheDocument()
    expect(screen.getByText(new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(2026, 8, 1)))).toBeInTheDocument()
  })

  it('renders ReactNode values', () => {
    renderBlock(keyValueFixtures.richValue)
    expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument()
  })

  it('applies a two-column grid when columns is 2', () => {
    const { container } = renderBlock(keyValueFixtures.twoColumns)
    expect(container.querySelector('dl')?.className).toContain('md:grid-cols-2')
  })

  it('stays single column by default', () => {
    const { container } = renderBlock(keyValueFixtures.readOnly)
    expect(container.querySelector('dl')?.className).not.toContain('md:grid-cols-2')
  })

  it('shows no edit affordance on non-editable items', () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined) })
    expect(screen.getByRole('button', { name: 'Edit Name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Record ID' })).toBeNull()
  })

  it('opens the editor with the current value', () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Acme')
  })

  it('opens a textarea editor for textarea items', () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Notes' }))
    expect(screen.getByRole('textbox', { name: 'Notes' }).tagName).toBe('TEXTAREA')
  })

  it('opens a select editor showing the current option', () => {
    renderBlock(keyValueFixtures.editable)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Stage' }))
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveTextContent('Qualified')
  })

  it('opens a date editor', () => {
    renderBlock(keyValueFixtures.editable)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Renewal date' }))
    expect(screen.getByRole('button', { name: 'Renewal date' })).toBeInTheDocument()
  })

  it('allows only one item in edit mode at a time', () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Notes' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
  })

  it('saves via onEdit, disables save while pending, and returns to read mode', async () => {
    let resolve: () => void = () => undefined
    const onEdit = jest.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    renderBlock({ items: editableItems, onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Acme 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).toHaveBeenCalledWith('name', 'Acme 2')
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
    await act(async () => {
      resolve()
    })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Edit Name' })).toBeInTheDocument()
  })

  it('stays in edit mode with the draft when onEdit rejects', async () => {
    const onEdit = jest.fn().mockRejectedValue(new Error('nope'))
    renderBlock({ items: editableItems, onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled())
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Typed')
  })

  it('cancels on Escape', () => {
    const onEdit = jest.fn().mockResolvedValue(undefined)
    renderBlock({ items: editableItems, onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('saves on Ctrl+Enter', async () => {
    const onEdit = jest.fn().mockResolvedValue(undefined)
    renderBlock({ items: editableItems, onEdit })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('name', 'Acme'))
  })

  it('moves focus to the editor and back to the edit button for text', async () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Name' })).toHaveFocus())
  })

  it('moves focus to the select trigger and back after save', async () => {
    renderBlock(keyValueFixtures.editable)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Stage' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Stage' })).toHaveFocus())
  })

  it('ignores Escape from outside the form and stops propagation when handled', () => {
    const parentKeyDown = jest.fn()
    renderWithProviders(
      <div onKeyDown={parentKeyDown}>
        <KeyValue items={editableItems} onEdit={jest.fn().mockResolvedValue(undefined)} />
        <button type="button">Outside</button>
      </div>,
      { dict },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
    const form = screen.getByRole('textbox', { name: 'Name' }).closest('form') as HTMLFormElement
    fireEvent.keyDown(screen.getByRole('button', { name: 'Outside' }), { key: 'Escape' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    parentKeyDown.mockClear()
    fireEvent.keyDown(form.querySelector('input') as HTMLInputElement, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('renders the loading state', () => {
    renderBlock(keyValueFixtures.loading)
    expect(screen.getByText('Loading details')).toBeInTheDocument()
  })

  it('renders the error state with the provided message', () => {
    renderBlock(keyValueFixtures.error)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load details.')
  })

  it('renders the empty state and a custom empty slot', () => {
    const { unmount } = renderBlock(keyValueFixtures.empty)
    expect(screen.getByText('Nothing to show')).toBeInTheDocument()
    unmount()
    renderBlock({ items: [], status: 'empty', emptyState: <p>Custom empty</p> })
    expect(screen.getByText('Custom empty')).toBeInTheDocument()
  })

  it.each(Object.entries(keyValueFixtures))('fixture %s parses against the contract', (_name, props) => {
    expect(keyValuePropsSchema.safeParse(props).success).toBe(true)
  })
})
