/** @jest-environment jsdom */
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { galleryFamilies } from '../registry'
import { fullWidthEntryIds } from '../presentation'
import type { GalleryEntry } from '../types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/design-system',
}))

let entry: GalleryEntry
let fetchSpy: jest.Mock
const originalFetch = global.fetch

beforeAll(async () => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = jest.fn()
  const family = galleryFamilies.find((candidate) => candidate.id === 'display')!
  entry = (await family.load()).entries.find((candidate) => candidate.id === 'data-table')!
})

beforeEach(() => {
  fetchSpy = jest.fn(() => Promise.reject(new Error('[internal] network access is not allowed in this test')))
  global.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

async function mountVariant(variantId: string) {
  const variant = entry.variants.find((candidate) => candidate.id === variantId)!
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en" dict={{}}>
          {variant.render()}
        </I18nProvider>
      </QueryClientProvider>,
    )
  })
}

function bodyRows(): HTMLElement[] {
  const [, body] = within(screen.getByRole('table')).getAllByRole('rowgroup')
  return within(body).getAllByRole('row')
}

describe('DataTable gallery entry', () => {
  it('is registered next to the Table primitive as a full-width backend component', () => {
    expect(entry.importPath).toBe('@open-mercato/ui/backend/DataTable')
    expect(fullWidthEntryIds.has('data-table')).toBe(true)
    expect(entry.variants.map((variant) => variant.id)).toEqual([
      'basic',
      'sorting-pagination',
      'search-filters',
      'row-actions',
      'bulk-actions',
      'pinned-columns',
      'embedded',
      'loading',
      'empty',
      'no-results',
      'error',
    ])
  })

  it('keeps server-backed features out of every snippet', () => {
    for (const variant of entry.variants) {
      expect(variant.code).not.toMatch(/perspective=|entityId=|entityIds=|advancedFilter=|columnChooser=|exporter=/)
    }
  })

  it('mounts every variant on local data without calling the network', async () => {
    for (const variant of entry.variants) {
      await mountVariant(variant.id)
      if (variant.id === 'loading') expect(screen.getByText('Loading data...')).toBeInTheDocument()
      else expect(screen.getByRole('table')).toBeInTheDocument()
      cleanup()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders the basic table with a title and a create action', async () => {
    await mountVariant('basic')
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(5)
    expect(screen.getByText('Harbor relocation')).toBeInTheDocument()
  })

  it('sorts and pages through local state', async () => {
    await mountVariant('sorting-pagination')
    expect(bodyRows()).toHaveLength(5)
    expect(within(bodyRows()[0]).getByText('Billing cleanup')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    })
    expect(within(bodyRows()[0]).getByText('Supplier onboarding')).toBeInTheDocument()
  })

  it('filters rows by search and offers to clear a search with no results', async () => {
    await mountVariant('no-results')
    expect(screen.queryByText('Harbor relocation')).not.toBeInTheDocument()
    const search = screen.getByPlaceholderText('Search projects')
    expect(search).toHaveValue('zeppelin')
    expect(screen.getByText(/zeppelin/, { selector: 'p, span, h3, div' })).toBeInTheDocument()
  })

  it('shows selection checkboxes when bulk actions are passed', async () => {
    await mountVariant('bulk-actions')
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(6)
  })

  it('shows the list empty state with a create action', async () => {
    await mountVariant('empty')
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })

  it('shows the loading and error states', async () => {
    await mountVariant('loading')
    expect(screen.getByText('Loading data...')).toBeInTheDocument()
    cleanup()
    await mountVariant('error')
    expect(screen.getByText('Projects could not be loaded. Reload to try again.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    })
    expect(screen.getByText('Harbor relocation')).toBeInTheDocument()
  })
})
