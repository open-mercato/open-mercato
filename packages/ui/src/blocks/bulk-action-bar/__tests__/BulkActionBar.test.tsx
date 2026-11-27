import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { BulkActionBar } from '../BulkActionBar'
import { bulkActionBarFixtures } from '../fixtures'
import { bulkActionBarPropsSchema, type BulkActionBarProps } from '../../contracts/bulk-action-bar'

const dict = {
  ui: {
    blocks: {
      bulkActionBar: {
        label: 'Bulk actions',
        clear: 'Clear selection',
        selected: '{count} selected',
        allSelected: 'All {count} selected',
        selectAll: 'Select all {count}',
        moreActions: 'More actions',
        progressCount: '{done} of {total}',
      },
    },
  },
}

function renderBar(props: BulkActionBarProps) {
  return renderWithProviders(<BulkActionBar {...props} />, { dict })
}

function deferred() {
  let resolve: () => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mockViewport(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: wide,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
}

function pressEscape(target: Element | Document = document.body) {
  fireEvent.keyDown(target, { key: 'Escape' })
}

const fiveActions = bulkActionBarFixtures.withOverflow

describe('BulkActionBar', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('has fixtures that satisfy the contract', () => {
    for (const fixture of Object.values(bulkActionBarFixtures)) {
      expect(bulkActionBarPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('renders nothing when nothing is selected and there is no progress', () => {
    const { container } = renderBar({ ...bulkActionBarFixtures.default, selectedCount: 0 })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a labelled toolbar without taking focus', () => {
    renderBar(bulkActionBarFixtures.default)
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  it('shows the count as text and announces it through a polite live region', async () => {
    const { rerender } = renderBar(bulkActionBarFixtures.default)
    const count = document.querySelector('[data-slot="bulk-action-bar-count"]') as HTMLElement
    expect(count).toHaveTextContent('3 selected')
    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(live).toHaveTextContent('3 selected'))
    rerender(<BulkActionBar {...bulkActionBarFixtures.default} selectedCount={5} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('5 selected'))
    expect(document.querySelector('[data-slot="bulk-action-bar-count"]')).toHaveTextContent('5 selected')
  })

  it('shows the summary once in muted text', () => {
    renderBar(bulkActionBarFixtures.withSummary)
    const summary = screen.getByText('Total 48,200.00 USD')
    expect(summary).toHaveAttribute('data-slot', 'bulk-action-bar-summary')
    expect(summary.className).toContain('text-muted-foreground')
  })

  it('shows three visible actions by default and keeps the rest, including destructive ones, in the menu', () => {
    renderBar(fiveActions)
    for (const name of ['Assign owner', 'Change stage', 'Export']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Add tag')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('keeps a destructive action in the menu even when it would fit', () => {
    renderBar({
      ...bulkActionBarFixtures.default,
      actions: [
        { key: 'delete', label: 'Delete', tone: 'destructive' },
        { key: 'export', label: 'Export' },
      ],
    })
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })

  it('shows a destructive action as a visible button when destructivePlacement is inline', () => {
    const onAction = jest.fn()
    renderBar({ ...bulkActionBarFixtures.destructiveInline, onAction })
    const visible = screen
      .getAllByRole('button')
      .filter((button) => button.dataset.slot === 'bulk-action-bar-action')
    expect(visible.map((button) => button.textContent)).toEqual(['Change stage', 'Assign owner', 'Export', 'Delete'])
    const remove = screen.getByRole('button', { name: 'Delete' })
    const removeClasses = remove.className.split(' ')
    expect(removeClasses).toContain('text-destructive')
    expect(removeClasses).not.toContain('border-destructive')
    expect(screen.getByRole('button', { name: 'Export' }).className.split(' ')).not.toContain('text-destructive')
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    fireEvent.click(remove)
    expect(onAction).toHaveBeenCalledWith('delete')
  })

  it('counts an inline destructive action in maxVisibleActions and keeps the given order', () => {
    renderBar({
      ...bulkActionBarFixtures.default,
      destructivePlacement: 'inline',
      maxVisibleActions: 2,
      actions: [
        { key: 'delete', label: 'Delete', tone: 'destructive' },
        { key: 'export', label: 'Export' },
        { key: 'archive', label: 'Archive', tone: 'destructive' },
      ],
    })
    const visible = screen
      .getAllByRole('button')
      .filter((button) => button.dataset.slot === 'bulk-action-bar-action')
    expect(visible.map((button) => button.textContent)).toEqual(['Delete', 'Export'])
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Archive')).toBeInTheDocument()
  })

  it('keeps destructive actions in the menu when destructivePlacement is overflow', () => {
    renderBar({ ...bulkActionBarFixtures.destructiveInline, destructivePlacement: 'overflow' })
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })

  it('uses ariaLabel as the accessible name of the toolbar', () => {
    renderBar({ ...bulkActionBarFixtures.default, ariaLabel: 'Bulk actions for deals' })
    expect(screen.getByRole('toolbar', { name: 'Bulk actions for deals' })).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('respects maxVisibleActions', () => {
    renderBar({ ...fiveActions, maxVisibleActions: 2 })
    expect(screen.getAllByRole('button').filter((button) => button.dataset.slot === 'bulk-action-bar-action')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })

  it('shows no menu when every action fits', () => {
    renderBar(bulkActionBarFixtures.singleAction)
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
  })

  it('shows one visible action plus the menu on a phone viewport', () => {
    mockViewport(false)
    renderBar(bulkActionBarFixtures.default)
    expect(screen.getByRole('button', { name: 'Assign owner' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change stage' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Change stage')).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('calls onAction with the key for visible and menu actions', () => {
    const onAction = jest.fn()
    renderBar({ ...fiveActions, onAction })
    fireEvent.click(screen.getByRole('button', { name: 'Change stage' }))
    expect(onAction).toHaveBeenCalledWith('change-stage')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Delete'))
    expect(onAction).toHaveBeenCalledWith('delete')
  })

  it('marks the action busy and disables the others while its promise is pending', async () => {
    const pending = deferred()
    const onAction = jest.fn(() => pending.promise)
    renderBar({ ...fiveActions, onAction })
    fireEvent.click(screen.getByRole('button', { name: 'Change stage' }))
    const busy = screen.getByRole('button', { name: /Change stage/ })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Assign owner' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Assign owner' })).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: 'More actions' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change stage' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Assign owner' })).toBeEnabled()
  })

  it('re-enables the actions after the promise rejects', async () => {
    const pending = deferred()
    renderBar({ ...bulkActionBarFixtures.default, onAction: () => pending.promise })
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled()
    await act(async () => {
      pending.reject(new Error('failed'))
      await pending.promise.catch(() => undefined)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
  })

  it('shows a spinner on the menu trigger while a menu action is pending', async () => {
    const pending = deferred()
    renderBar({ ...fiveActions, onAction: (key) => (key === 'delete' ? pending.promise : undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Delete'))
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toBeEnabled())
  })

  it('reflects a host-driven pendingActionKey', () => {
    const onAction = jest.fn()
    renderBar({ ...bulkActionBarFixtures.pending, onAction })
    const busy = screen.getByRole('button', { name: /Change stage/ })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Assign owner' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(onAction).not.toHaveBeenCalled()
  })

  it('keeps a disabled-with-reason action focusable, inert and described by its reason', () => {
    const onAction = jest.fn()
    renderBar({ ...bulkActionBarFixtures.disabledAction, onAction })
    const button = screen.getByRole('button', { name: 'Create report' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onAction).not.toHaveBeenCalled()
    const reason = document.getElementById(button.getAttribute('aria-describedby') as string) as HTMLElement
    expect(reason).toHaveTextContent('Select projects of one customer to create a report')
    expect(reason.className).toContain('md:sr-only')
    expect(screen.getByRole('button', { name: 'Assign members' })).toBeEnabled()
  })

  it('shows the disabled reason as the description of a menu item', () => {
    renderBar({ ...bulkActionBarFixtures.disabledAction, maxVisibleActions: 1, actions: [
      { key: 'assign-members', label: 'Assign members' },
      { key: 'create-report', label: 'Create report', disabled: true, disabledReason: 'Select projects of one customer' },
    ] })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Select projects of one customer')).toBeInTheDocument()
  })

  it('offers to select all matching records and emits the event', () => {
    const onSelectAllMatching = jest.fn()
    renderBar({ ...bulkActionBarFixtures.selectAllMatching, onSelectAllMatching })
    expect(document.querySelector('[data-slot="bulk-action-bar-count"]')).toHaveTextContent('25 selected')
    fireEvent.click(screen.getByRole('button', { name: 'Select all 128' }))
    expect(onSelectAllMatching).toHaveBeenCalledTimes(1)
  })

  it('replaces the prompt with the all-selected text once allMatchingSelected is true', async () => {
    renderBar(bulkActionBarFixtures.allMatchingSelected)
    expect(screen.queryByRole('button', { name: 'Select all 128' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="bulk-action-bar-count"]')).toHaveTextContent('All 128 selected')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All 128 selected'))
    expect(screen.queryByText('25 selected')).not.toBeInTheDocument()
  })

  it('shows no select-all prompt without totalCount or when everything is already selected', () => {
    renderBar({ ...bulkActionBarFixtures.default, totalCount: 3, onSelectAllMatching: () => undefined })
    expect(screen.queryByRole('button', { name: /Select all/ })).not.toBeInTheDocument()
  })

  it('replaces the actions with determinate progress', () => {
    renderBar(bulkActionBarFixtures.progress)
    expect(screen.getByText('Updating stage')).toBeInTheDocument()
    expect(screen.getByText('12 of 40')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Updating stage' })
    expect(bar).toHaveAttribute('aria-valuenow', '12')
    expect(bar).toHaveAttribute('aria-valuemax', '40')
    expect(bar).toHaveAttribute('aria-valuetext', '12 of 40')
    expect(screen.queryByRole('button', { name: 'Assign owner' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument()
  })

  it('shows indeterminate progress without a progress bar', () => {
    renderBar({ ...bulkActionBarFixtures.progress, progress: { label: 'Preparing export' } })
    expect(screen.getByText('Preparing export')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument()
  })

  it('stays visible for progress when the selection is already empty', () => {
    renderBar({ ...bulkActionBarFixtures.progress, selectedCount: 0 })
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument()
    expect(screen.getByText('12 of 40')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument()
  })

  it('clears through the clear button', () => {
    const onClear = jest.fn()
    renderBar({ ...bulkActionBarFixtures.default, onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('clears on Escape by default', () => {
    const onClear = jest.fn()
    renderBar({ ...bulkActionBarFixtures.default, onClear })
    pressEscape()
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape when clearOnEscape is false', () => {
    const onClear = jest.fn()
    renderBar({ ...bulkActionBarFixtures.default, onClear, clearOnEscape: false })
    pressEscape()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('ignores other keys and already handled Escape presses', () => {
    const onClear = jest.fn()
    renderBar({ ...bulkActionBarFixtures.default, onClear })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    handled.preventDefault()
    document.body.dispatchEvent(handled)
    expect(onClear).not.toHaveBeenCalled()
  })

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const editable = document.createElement('div')
        editable.setAttribute('contenteditable', 'true')
        editable.tabIndex = 0
        return editable
      },
    ],
  ])('ignores Escape while focus is inside %s', (_name, create) => {
    const onClear = jest.fn()
    renderBar({ ...bulkActionBarFixtures.default, onClear })
    const field = create()
    document.body.appendChild(field)
    field.focus()
    expect(field).toHaveFocus()
    pressEscape(field)
    expect(onClear).not.toHaveBeenCalled()
    field.remove()
  })

  it.each(['dialog', 'alertdialog', 'menu'])('ignores Escape while a %s is open', (role) => {
    const onClear = jest.fn()
    renderBar({ ...bulkActionBarFixtures.default, onClear })
    const layer = document.createElement('div')
    layer.setAttribute('role', role)
    document.body.appendChild(layer)
    pressEscape()
    expect(onClear).not.toHaveBeenCalled()
    layer.remove()
    pressEscape()
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape while its own menu is open', () => {
    const onClear = jest.fn()
    renderBar({ ...fiveActions, onClear })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    pressEscape(screen.getByText('Delete'))
    expect(onClear).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once the selection is empty', () => {
    const onClear = jest.fn()
    const { rerender } = renderBar({ ...bulkActionBarFixtures.default, onClear })
    rerender(<BulkActionBar {...bulkActionBarFixtures.default} onClear={onClear} selectedCount={0} />)
    pressEscape()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('positions floating by default and in flow when inline', () => {
    const { unmount } = renderBar({ ...bulkActionBarFixtures.default, position: undefined })
    const floating = screen.getByRole('toolbar')
    expect(floating).toHaveAttribute('data-position', 'floating')
    expect(floating.className).toContain('fixed')
    expect(floating.className).toContain('z-sticky')
    unmount()
    renderBar(bulkActionBarFixtures.default)
    const inline = screen.getByRole('toolbar')
    expect(inline).toHaveAttribute('data-position', 'inline')
    expect(inline.className).not.toContain('fixed')
  })

  it('renders the trailing slot and merges className', () => {
    renderBar({
      ...bulkActionBarFixtures.default,
      trailing: <span>Synced</span>,
      className: 'custom-class',
    })
    expect(screen.getByText('Synced').parentElement).toHaveAttribute('data-slot', 'bulk-action-bar-trailing')
    expect(screen.getByRole('toolbar').className).toContain('custom-class')
  })
})
