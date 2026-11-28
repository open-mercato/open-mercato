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
  'ui.blocks.keyValue.emptyDescription': 'Details will appear here once they are added.',
  'ui.blocks.keyValue.retry': 'Try again',
  'ui.blocks.keyValue.saveError': 'Could not save. Try again.',
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

  it('lays rows out horizontally by default with sentence-case labels', () => {
    const { container } = renderBlock(keyValueFixtures.readOnly)
    const list = container.querySelector('dl') as HTMLElement
    expect(list).toHaveAttribute('data-layout', 'horizontal')
    expect(container.querySelector('[data-slot="key-value-row"]')?.className).toContain('sm:flex-row')
    const label = screen.getByText('Owner').closest('dt') as HTMLElement
    expect(label.className).not.toContain('uppercase')
    expect(label.className).toContain('sm:max-w-40')
  })

  it('stacks the label above the value in the vertical layout', () => {
    const { container } = renderBlock({ ...keyValueFixtures.readOnly, layout: 'vertical' })
    expect(container.querySelector('dl')).toHaveAttribute('data-layout', 'vertical')
    expect(container.querySelector('[data-slot="key-value-row"]')?.className).not.toContain('sm:flex-row')
  })

  it('draws cell borders and spans the last cell of an odd two-column list', () => {
    const { container } = renderBlock({ ...keyValueFixtures.twoColumns, items: keyValueFixtures.readOnly.items.slice(0, 3), bordered: true })
    expect(container.querySelector('dl')?.className).toContain('bg-input')
    const rows = container.querySelectorAll('[data-slot="key-value-row"]')
    expect(rows[2].className).toContain('md:col-span-2')
    expect(rows[0].className).not.toContain('md:col-span-2')
  })

  it('renders an icon before the label', () => {
    renderBlock({ items: [{ key: 'owner', label: 'Owner', value: 'Anna', icon: <svg data-testid="owner-icon" /> }] })
    expect(screen.getByTestId('owner-icon').closest('dt')).toHaveTextContent('Owner')
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

  it('preserves the selected value when another option uses it as its label', async () => {
    const onEdit = jest.fn().mockResolvedValue(undefined)
    renderBlock({
      items: [{
        key: 'stage',
        label: 'Stage',
        value: 'open',
        editable: true,
        editor: 'select',
        options: [
          { value: 'archived', label: 'open' },
          { value: 'open', label: 'Open request' },
        ],
      }],
      onEdit,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Stage' }))
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveTextContent('Open request')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('stage', 'open'))
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
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(screen.queryByRole('alert')).toBeNull()
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

  it('renders a skeleton shaped like the list while loading', () => {
    const { container } = renderBlock({ ...keyValueFixtures.loading, columns: 2, bordered: true })
    expect(screen.getByText('Loading details')).toHaveClass('sr-only')
    const root = container.querySelector('[data-slot="key-value"]') as HTMLElement
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('[data-slot="key-value-skeleton-row"]')).toHaveLength(4)
    const list = root.querySelector('[data-layout="horizontal"]') as HTMLElement
    expect(list.className).toContain('md:grid-cols-2')
    expect(list.className).toContain('bg-input')
  })

  it('matches the skeleton row count to known items', () => {
    const { container } = renderBlock({ items: keyValueFixtures.readOnly.items.slice(0, 2), status: 'loading' })
    expect(container.querySelectorAll('[data-slot="key-value-skeleton-row"]')).toHaveLength(2)
  })

  it('renders the error state with the provided message and a retry action', () => {
    const onRetry = jest.fn()
    renderBlock({ ...keyValueFixtures.error, onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load details.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the retry action without onRetry', () => {
    renderBlock({ items: [], status: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('renders the empty state and a custom empty slot', () => {
    const { unmount } = renderBlock(keyValueFixtures.empty)
    expect(screen.getByText('Nothing to show')).toBeInTheDocument()
    expect(screen.getByText('Details will appear here once they are added.')).toBeInTheDocument()
    unmount()
    renderBlock({ items: [], status: 'empty', emptyState: <p>Custom empty</p> })
    expect(screen.getByText('Custom empty')).toBeInTheDocument()
    expect(screen.queryByText('Nothing to show')).toBeNull()
  })

  it('formats dates through the display format independently of the editor', () => {
    const mediumDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(2026, 2, 14))
    renderBlock({
      items: [
        { key: 'created', label: 'Created', value: '2026-03-14', format: 'date' },
        { key: 'raw', label: 'Raw', value: '2026-03-15', editable: true, editor: 'date', format: 'text' },
        { key: 'seen', label: 'Last seen', value: '2026-03-16T10:30:00', format: 'datetime' },
        { key: 'free', label: 'Free text', value: 'not a date', format: 'date' },
      ],
      onEdit: jest.fn().mockResolvedValue(undefined),
    })
    expect(screen.getByText(mediumDate)).toBeInTheDocument()
    expect(screen.getByText('2026-03-15')).toBeInTheDocument()
    expect(
      screen.getByText(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-03-16T10:30:00'))),
    ).toBeInTheDocument()
    expect(screen.getByText('not a date')).toBeInTheDocument()
  })

  it('formats the created date in read-only fixtures', () => {
    renderBlock(keyValueFixtures.readOnly)
    expect(screen.queryByText('2026-03-14')).toBeNull()
  })

  it.each([
    ['editingText', 'textbox', 'Name'],
    ['editingTextarea', 'textbox', 'Notes'],
    ['editingSelect', 'combobox', 'Stage'],
    ['editingDate', 'button', 'Renewal date'],
  ] as const)('opens %s in edit mode through defaultEditingKey without moving focus', (fixture, role, name) => {
    renderBlock(keyValueFixtures[fixture])
    const editor = screen.getByRole(role, { name })
    expect(editor).toBeInTheDocument()
    expect(editor).not.toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('prefills the draft from defaultEditingKey and saves it', async () => {
    const onEdit = jest.fn().mockResolvedValue(undefined)
    renderBlock({ items: editableItems, onEdit, defaultEditingKey: 'name' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Acme')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('name', 'Acme'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Name' })).toHaveFocus())
  })

  it('ignores a defaultEditingKey that is not an editable item', () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined), defaultEditingKey: 'id' })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('keeps the edit button visible with a 32px target that does not stretch the row', () => {
    renderBlock({ items: editableItems, onEdit: jest.fn().mockResolvedValue(undefined) })
    const button = screen.getByRole('button', { name: 'Edit Name' })
    expect(button.className).toContain('size-8')
    expect(button.className).toContain('-my-2')
    expect(button.className).not.toContain('opacity-0')
  })

  it('caps the width of a single-column list only and lets className override it', () => {
    const single = renderBlock(keyValueFixtures.readOnly)
    expect(single.container.querySelector('[data-slot="key-value"]')?.className).toContain('max-w-2xl')
    single.unmount()
    const double = renderBlock(keyValueFixtures.twoColumns)
    expect(double.container.querySelector('[data-slot="key-value"]')?.className).not.toContain('max-w-2xl')
    double.unmount()
    const overridden = renderBlock({ ...keyValueFixtures.readOnly, className: 'max-w-none' })
    const className = overridden.container.querySelector('[data-slot="key-value"]')?.className ?? ''
    expect(className).toContain('max-w-none')
    expect(className).not.toContain('max-w-2xl')
  })

  it('indents the stacked value under the label text when the item has an icon', () => {
    const { container } = renderBlock(keyValueFixtures.withIcons)
    expect(container.querySelector('dd')?.className).toContain('max-sm:pl-6')
    const plain = renderBlock(keyValueFixtures.readOnly)
    expect(plain.container.querySelector('dd')?.className).not.toContain('pl-6')
  })

  it('keeps bordered rows side by side with a tinted label cell at every width', () => {
    const { container } = renderBlock(keyValueFixtures.bordered)
    const row = container.querySelector('[data-slot="key-value-row"]') as HTMLElement
    expect(row.className).toContain('flex-row')
    expect(row.querySelector('dt')?.className).toContain('bg-muted/60')
  })

  it('styles the hint smaller than the label', () => {
    renderBlock({ ...keyValueFixtures.readOnly, layout: 'vertical' })
    expect(screen.getByText('Email').closest('dt')?.className).toContain('text-sm')
    expect(screen.getByText('Primary contact').className).toContain('text-xs')
  })

  it('renders the footer slot and wraps long content', () => {
    renderBlock({ ...keyValueFixtures.longContent, footer: <p>Footer note</p> })
    expect(screen.getByText('Footer note').closest('[data-slot="key-value-footer"]')).not.toBeNull()
    expect(screen.getByText(/^PO-2026/).className).toContain('break-words')
  })

  it.each(Object.entries(keyValueFixtures))('fixture %s parses against the contract', (_name, props) => {
    expect(keyValuePropsSchema.safeParse(props).success).toBe(true)
  })
})
