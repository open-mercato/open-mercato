/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

import { BulkActionsBar } from '../BulkActionsBar'

const dict = {
  'customers.deals.kanban.bulk.aria.bar': 'Deal bulk actions',
  'customers.deals.kanban.bulk.changeStage': 'Move stage',
  'customers.deals.kanban.bulk.changeOwner': 'Reassign owner',
  'customers.deals.kanban.bulk.exportCsv': 'Download CSV',
  'customers.deals.kanban.bulk.delete': 'Remove',
  'customers.deals.kanban.bulk.totalValue': 'Sum {value}',
  'ui.blocks.bulkActionBar.clear': 'Clear selection',
  'ui.blocks.bulkActionBar.selected': '{count} selected',
  'ui.blocks.bulkActionBar.moreActions': 'More actions',
}

type BarProps = React.ComponentProps<typeof BulkActionsBar>

function createHandlers() {
  return {
    onChangeStage: jest.fn(),
    onChangeOwner: jest.fn(),
    onExportCsv: jest.fn(),
    onDelete: jest.fn(),
    onClear: jest.fn(),
  }
}

function renderBar(overrides: Partial<BarProps> = {}) {
  const handlers = createHandlers()
  const props: BarProps = { count: 3, totalLabel: null, ...handlers, ...overrides }
  const view = renderWithProviders(<BulkActionsBar {...props} />, { dict })
  return { ...view, props }
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

function visibleActionLabels(): Array<string | null> {
  return screen
    .getAllByRole('button')
    .filter((button) => button.dataset.slot === 'bulk-action-bar-action')
    .map((button) => button.textContent)
}

describe('BulkActionsBar (deals pipeline adapter)', () => {
  const originalMatchMedia = window.matchMedia

  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  beforeEach(() => {
    mockViewport(true)
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia })
  })

  it('renders nothing when no deal is selected', () => {
    const { container } = renderBar({ count: 0, totalLabel: '$1,000.00' })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a floating toolbar named by the module label, above dialogs', () => {
    renderBar()
    const toolbar = screen.getByRole('toolbar', { name: 'Deal bulk actions' })
    expect(toolbar).toHaveAttribute('data-position', 'floating')
    expect(toolbar.className.split(' ')).toContain('z-toast!')
  })

  it('shows the selected count', () => {
    renderBar({ count: 7 })
    expect(document.querySelector('[data-slot="bulk-action-bar-count"]')).toHaveTextContent('7 selected')
  })

  it('shows the total when provided and omits it otherwise', () => {
    const { unmount } = renderBar({ totalLabel: '$48,200.00' })
    expect(screen.getByText('Sum $48,200.00')).toHaveAttribute('data-slot', 'bulk-action-bar-summary')
    unmount()
    renderBar({ totalLabel: null })
    expect(document.querySelector('[data-slot="bulk-action-bar-summary"]')).toBeNull()
  })

  it('shows all four actions as visible buttons in order, with Delete styled as destructive', () => {
    renderBar()
    expect(visibleActionLabels()).toEqual(['Move stage', 'Reassign owner', 'Download CSV', 'Remove'])
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' }).className).toContain('text-destructive')
  })

  it('keeps one visible action and moves the rest, including Delete, to the menu on a phone viewport', () => {
    mockViewport(false)
    const { props } = renderBar()
    expect(visibleActionLabels()).toEqual(['Move stage'])
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByText('Remove'))
    expect(props.onDelete).toHaveBeenCalledTimes(1)
  })

  it('renders an icon for every action', () => {
    renderBar()
    for (const name of ['Move stage', 'Reassign owner', 'Download CSV', 'Remove']) {
      expect(screen.getByRole('button', { name }).querySelector('svg')).not.toBeNull()
    }
  })

  it.each([
    ['Move stage', 'onChangeStage'],
    ['Reassign owner', 'onChangeOwner'],
    ['Download CSV', 'onExportCsv'],
    ['Remove', 'onDelete'],
  ] as const)('routes %s to %s only', (name, handlerName) => {
    const { props } = renderBar()
    fireEvent.click(screen.getByRole('button', { name }))
    for (const candidate of ['onChangeStage', 'onChangeOwner', 'onExportCsv', 'onDelete'] as const) {
      expect(props[candidate]).toHaveBeenCalledTimes(candidate === handlerName ? 1 : 0)
    }
    expect(props.onClear).not.toHaveBeenCalled()
  })

  it('adds no pending state when a callback returns a promise', () => {
    const onDelete = jest.fn(() => new Promise<void>(() => undefined)) as unknown as () => void
    renderBar({ onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    const remove = screen.getByRole('button', { name: 'Remove' })
    expect(remove).toBeEnabled()
    expect(remove).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: 'Move stage' })).toBeEnabled()
  })

  it('clears through the clear button', () => {
    const { props } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('clears the selection on Escape', () => {
    const { props } = renderBar()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('does not listen for Escape when nothing is selected', () => {
    const { props } = renderBar({ count: 0 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(props.onClear).not.toHaveBeenCalled()
  })

  it('ignores Escape while focus is in a text field', () => {
    const { props } = renderBar()
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(props.onClear).not.toHaveBeenCalled()
    field.remove()
  })

  it('ignores Escape while a dialog is open', () => {
    const { props } = renderBar()
    const layer = document.createElement('div')
    layer.setAttribute('role', 'dialog')
    document.body.appendChild(layer)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(props.onClear).not.toHaveBeenCalled()
    layer.remove()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })
})
