/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => <div data-testid="mock-ai-chat" />,
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

import { LineItemsEditor } from '../backend/warranty_claims/create/page'

type EditorProps = React.ComponentProps<typeof LineItemsEditor>
type EditorLine = Parameters<EditorProps['setLines']>[0][number]

const SEARCH_PLACEHOLDER = 'Search product, SKU or serial number'

const TRANSLATIONS: EditorProps['translations'] = {
  addLine: 'Add line',
  removeLine: 'Remove line',
  productName: 'Product name',
  sku: 'SKU',
  serialNumber: 'Serial number',
  faultCode: 'Fault code',
  faultDescription: 'Fault description',
  qtyClaimed: 'Qty claimed',
  faultCodePlaceholder: 'Select fault code',
}

function buildLines(count: number): EditorLine[] {
  return Array.from({ length: count }, (_, index) => ({
    productId: null,
    variantId: null,
    orderLineId: null,
    productName: `Widget ${index + 1}`,
    sku: `SKU-${index + 1}`,
    serialNumber: `SN-${index + 1}`,
    purchaseDate: '',
    warrantyMonths: '',
    faultCode: null,
    faultDescription: '',
    qtyClaimed: 1,
  }))
}

// The editor is controlled by CrudForm in production; this stand-in keeps the same
// contract so search and paging are exercised against real state transitions.
function EditorHost({ initialLines }: { initialLines: EditorLine[] }) {
  const [lines, setLines] = React.useState(initialLines)
  return (
    <LineItemsEditor
      value={lines}
      setLines={setLines}
      orderId={null}
      defaultWarrantyMonths={null}
      faultCodeOptions={[]}
      translations={TRANSLATIONS}
      t={((key: string, fallback?: string) => fallback ?? key) as EditorProps['t']}
    />
  )
}

let queryClient: QueryClient | null = null

async function renderEditor(lineCount: number) {
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <EditorHost initialLines={buildLines(lineCount)} />
      </I18nProvider>
    </QueryClientProvider>,
  )
  await act(async () => {})
  return view
}

function renderedProductNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody tr'))
    .map((row) => within(row as HTMLElement).queryByText(/^Widget \d+$/)?.textContent ?? '')
    .filter((name) => name.length > 0)
}

// FilterBar debounces for a full second before it calls onSearchChange, so every
// assertion that depends on a search term needs a window wider than RTL's default.
const SEARCH_DEBOUNCE_WINDOW = { timeout: 3000 }

function search(term: string) {
  fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: term } })
}

function goToPage(page: number) {
  fireEvent.click(screen.getByRole('button', { name: `Go to page ${page}` }))
}

beforeEach(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  Element.prototype.scrollIntoView = jest.fn()
})

afterEach(() => {
  queryClient?.clear()
  queryClient = null
})

describe('LineItemsEditor', () => {
  it('renders only one page of rows for an order with hundreds of lines', async () => {
    const { container } = await renderEditor(250)

    const names = renderedProductNames(container)
    expect(names).toHaveLength(20)
    expect(names[0]).toBe('Widget 1')
    expect(names[19]).toBe('Widget 20')
    expect(screen.queryByText('Widget 21')).toBeNull()
  })

  it('reports the unfiltered total in the pagination summary', async () => {
    await renderEditor(45)

    expect(screen.getByText('Showing 1 to 20 of 45 results')).toBeTruthy()
  })

  it('pages forward without rendering the earlier rows', async () => {
    const { container } = await renderEditor(45)

    goToPage(3)

    const names = renderedProductNames(container)
    expect(names).toEqual(['Widget 41', 'Widget 42', 'Widget 43', 'Widget 44', 'Widget 45'])
    expect(screen.queryByText('Widget 20')).toBeNull()
  })

  it('filters on serial number and narrows the total to the matches', async () => {
    const { container } = await renderEditor(45)

    search('SN-4')

    await waitFor(() => {
      expect(renderedProductNames(container)).toEqual([
        'Widget 4', 'Widget 40', 'Widget 41', 'Widget 42', 'Widget 43',
        'Widget 44', 'Widget 45',
      ])
    }, SEARCH_DEBOUNCE_WINDOW)
    expect(screen.getByText('Showing 1 to 7 of 7 results')).toBeTruthy()
  })

  it('returns to page 1 when the search term changes while on a later page', async () => {
    const { container } = await renderEditor(45)

    goToPage(3)
    expect(renderedProductNames(container)[0]).toBe('Widget 41')

    search('Widget 1')

    await waitFor(() => expect(renderedProductNames(container)[0]).toBe('Widget 1'), SEARCH_DEBOUNCE_WINDOW)
    expect(screen.getByText('Showing 1 to 11 of 11 results')).toBeTruthy()
  })

  it('clamps to the last surviving page when the current page is emptied by deletes', async () => {
    const { container } = await renderEditor(21)

    goToPage(2)
    expect(renderedProductNames(container)).toEqual(['Widget 21'])

    const actionsTrigger = within(container.querySelector('tbody tr') as HTMLElement)
      .getByRole('button')
    fireEvent.click(actionsTrigger)
    fireEvent.click(await screen.findByText('Remove line'))

    await waitFor(() => expect(renderedProductNames(container)).toHaveLength(20))
    expect(screen.getByText('Showing 1 to 20 of 20 results')).toBeTruthy()
  })
})
