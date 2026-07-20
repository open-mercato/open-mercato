/** @jest-environment jsdom */
import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DataTable } from '../DataTable'
import { RowActions } from '../RowActions'

const mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
  }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
// InjectionSpot resolves spot widgets through the real async registry loader; left
// unmocked it settles at an arbitrary point of the run and fires setState outside act().
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

type Row = { id: string; name: string }

const ROWS: Row[] = [{ id: '1', name: 'Ada' }]

// Cells routinely host inline editors (status selects, quantity inputs, quick-action
// buttons). Without the guard, editing one of those also fired the row's navigation
// handler and yanked the user off the page mid-edit. Every control below must swallow
// the click before it reaches the row.
function InteractiveCell() {
  return (
    <div>
      <button type="button" data-testid="cell-button">
        <svg data-testid="cell-button-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M0 0h16v16H0z" />
        </svg>
      </button>
      <a href="#detail" data-testid="cell-link">
        Detail
      </a>
      <input data-testid="cell-input" defaultValue="qty" />
      <select data-testid="cell-select" defaultValue="open">
        <option value="open">Open</option>
        <option value="closed">Closed</option>
      </select>
      <textarea data-testid="cell-textarea" defaultValue="note" />
      <div role="combobox" aria-expanded={false} tabIndex={0} data-testid="cell-combobox">
        Pick one
      </div>
      <div role="listbox" tabIndex={-1} data-testid="cell-listbox">
        <div data-testid="cell-listbox-option">Option</div>
      </div>
      <div contentEditable suppressContentEditableWarning data-testid="cell-contenteditable">
        <span data-testid="cell-contenteditable-child">Inline note</span>
      </div>
    </div>
  )
}

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { id: 'controls', header: 'Controls', cell: () => <InteractiveCell /> },
]

let queryClient: QueryClient | null = null

// The real I18nProvider is used rather than a `useT` mock: a mocked `useT` that
// returns a fresh function per render destabilises DataTable's memoised column
// pipeline and remounts rows mid-test.
async function renderTable(props: Record<string, unknown>) {
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={COLUMNS} data={ROWS} {...props} />
      </I18nProvider>
    </QueryClientProvider>,
  )
  // Injection spots settle their (mocked) async loader one microtask after mount.
  await act(async () => {})
  return view
}

function plainCell(container: HTMLElement): HTMLElement {
  const cell = container.querySelector('tbody tr td')
  if (!cell) throw new Error('[internal] expected a rendered body cell')
  return cell as HTMLElement
}

function editHrefActions() {
  return () => <RowActions items={[{ id: 'edit', label: 'Edit', href: '/backend/rows/1' }]} />
}

beforeEach(() => {
  mockRouterPush.mockReset()
})

afterEach(() => {
  queryClient?.clear()
  queryClient = null
})

describe('DataTable row click guard', () => {
  describe('onRowClick', () => {
    it('fires when a plain cell is clicked', async () => {
      const onRowClick = jest.fn()
      const { container } = await renderTable({ onRowClick })

      fireEvent.click(plainCell(container))

      expect(onRowClick).toHaveBeenCalledTimes(1)
      expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Ada' })
    })

    it('fires when the rendered cell text is clicked', async () => {
      const onRowClick = jest.fn()
      await renderTable({ onRowClick })

      fireEvent.click(screen.getByText('Ada'))

      expect(onRowClick).toHaveBeenCalledTimes(1)
      expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Ada' })
    })

    it.each([
      ['button', 'cell-button'],
      ['anchor', 'cell-link'],
      ['input', 'cell-input'],
      ['select', 'cell-select'],
      ['textarea', 'cell-textarea'],
      ['combobox', 'cell-combobox'],
      ['listbox', 'cell-listbox'],
      ['contenteditable', 'cell-contenteditable'],
    ])('does not fire when the %s inside a cell is clicked', async (_label, testId) => {
      const onRowClick = jest.fn()
      await renderTable({ onRowClick })

      fireEvent.click(screen.getByTestId(testId))

      expect(onRowClick).not.toHaveBeenCalled()
    })

    // `closest()` semantics, not direct-target matching: real controls wrap their
    // label/icon in child nodes, and the click target is whatever leaf was hit.
    it('does not fire for an icon nested inside a cell button', async () => {
      const onRowClick = jest.fn()
      await renderTable({ onRowClick })

      fireEvent.click(screen.getByTestId('cell-button-icon'))

      expect(onRowClick).not.toHaveBeenCalled()
    })

    it('does not fire for a node nested inside a contenteditable cell', async () => {
      const onRowClick = jest.fn()
      await renderTable({ onRowClick })

      fireEvent.click(screen.getByTestId('cell-contenteditable-child'))

      expect(onRowClick).not.toHaveBeenCalled()
    })

    // Escape hatch for consumers that relied on click-anywhere row navigation before
    // the guard landed. Without it a third-party table whose primary cell content is a
    // link or icon button would silently lose row navigation with no way back.
    it('fires for a cell button when the guard is disabled with rowClickInteractiveSelector={false}', async () => {
      const onRowClick = jest.fn()
      await renderTable({ onRowClick, rowClickInteractiveSelector: false })

      fireEvent.click(screen.getByTestId('cell-button'))

      expect(onRowClick).toHaveBeenCalledTimes(1)
    })

    it('honors a narrowed rowClickInteractiveSelector, swallowing only the listed elements', async () => {
      const onRowClick = jest.fn()
      await renderTable({ onRowClick, rowClickInteractiveSelector: 'button' })

      fireEvent.click(screen.getByTestId('cell-button'))
      expect(onRowClick).not.toHaveBeenCalled()

      // `input` is outside the narrowed selector, so it navigates again.
      fireEvent.click(screen.getByTestId('cell-input'))
      expect(onRowClick).toHaveBeenCalledTimes(1)
    })

    it('does not fire when the row actions cell is clicked', async () => {
      const onRowClick = jest.fn()
      const { container } = await renderTable({
        onRowClick,
        rowActions: () => <RowActions items={[{ id: 'edit', label: 'Edit', onSelect: () => {} }]} />,
      })

      const actionsCell = container.querySelector('tbody tr td[data-actions-cell]')
      expect(actionsCell).not.toBeNull()
      fireEvent.click(actionsCell as HTMLElement)

      expect(onRowClick).not.toHaveBeenCalled()
    })
  })

  // Without an `onRowClick` prop the row falls back to the first row action whose id
  // matches `rowClickActionIds` (default `['edit', 'open']`). The guard must leave
  // that fallback intact.
  describe('default row action fallback', () => {
    it('navigates to the default action href when a plain cell is clicked', async () => {
      const { container } = await renderTable({ rowActions: editHrefActions() })

      fireEvent.click(plainCell(container))

      expect(mockRouterPush).toHaveBeenCalledTimes(1)
      expect(mockRouterPush).toHaveBeenCalledWith('/backend/rows/1')
    })

    it('does not navigate when a control inside a cell is clicked', async () => {
      await renderTable({ rowActions: editHrefActions() })

      fireEvent.click(screen.getByTestId('cell-select'))

      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('invokes the default action onSelect resolved through custom rowClickActionIds', async () => {
      const onSelect = jest.fn()
      const { container } = await renderTable({
        rowClickActionIds: ['open'],
        rowActions: () => (
          <RowActions
            items={[
              { id: 'edit', label: 'Edit', onSelect: () => {} },
              { id: 'open', label: 'Open', onSelect },
            ]}
          />
        ),
      })

      fireEvent.click(plainCell(container))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('does not invoke the default action onSelect when a cell button is clicked', async () => {
      const onSelect = jest.fn()
      await renderTable({
        rowClickActionIds: ['open'],
        rowActions: () => <RowActions items={[{ id: 'open', label: 'Open', onSelect }]} />,
      })

      fireEvent.click(screen.getByTestId('cell-button'))

      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})
