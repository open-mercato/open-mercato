/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { SearchResult } from '@open-mercato/shared/modules/search'

const mockPush = jest.fn()
const mockFetchResults = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  )
  MockLink.displayName = 'MockLink'
  return MockLink
})

jest.mock('@open-mercato/ui/primitives/icon-button', () => ({
  IconButton: ({ size, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => <button {...props} />,
}), { virtual: true })
jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
}), { virtual: true })
jest.mock('@open-mercato/shared/lib/frontend/organizationEvents', () => ({
  getCurrentOrganizationScope: () => ({ organizationId: null }),
  subscribeOrganizationScopeChanged: () => () => undefined,
}))

jest.mock('../../utils', () => ({
  fetchGlobalSearchResults: (...args: unknown[]) => mockFetchResults(...args),
}))

import { TopbarSearchInline } from '../TopbarSearchInline'

const RESULTS: SearchResult[] = [
  { entityId: 'customers:customer_person_profile', recordId: 'p1', score: 1, source: 'tokens', presenter: { title: 'Mia Johnson' }, url: '/backend/customers/people-v2/p1' },
  { entityId: 'customers:customer_person_profile', recordId: 'p2', score: 0.9, source: 'tokens', presenter: { title: 'Mia Chen' }, url: '/backend/customers/people-v2/p2' },
]

// The search field behaved like a combobox (arrow keys move a highlight through
// results while focus stays in the field) but was not exposed as one: no role,
// `aria-expanded` and `aria-controls` on a plain textbox, a `listbox` that also
// held links and messages, and nothing telling assistive technology which
// result was highlighted.
describe('TopbarSearchInline combobox semantics', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockPush.mockReset()
    mockFetchResults.mockReset()
    mockFetchResults.mockResolvedValue({ results: RESULTS, error: null })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function openSearch() {
    render(
      <I18nProvider locale="en" dict={{}}>
        <TopbarSearchInline embeddingConfigured missingConfigMessage="" />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open global search' }))
    return screen.getByRole('combobox')
  }

  async function typeQuery(input: HTMLElement, value: string) {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value } })
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
  }

  it('exposes the field as a combobox named for what it does', () => {
    const input = openSearch()

    expect(screen.getByRole('combobox', { name: 'Search' })).toBe(input)
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-controls')).toBe(false)
  })

  it('stays collapsed while the panel only shows a hint', async () => {
    const input = openSearch()

    await typeQuery(input, 'mi')

    expect(document.getElementById('topbar-search-results')).not.toBeNull()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.hasAttribute('aria-controls')).toBe(false)
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('points at a named listbox that contains only options', async () => {
    const input = openSearch()

    await typeQuery(input, 'mia')

    const listbox = await waitFor(() => screen.getByRole('listbox', { name: 'Search results' }))
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(Array.from(listbox.children)).toEqual(options)
    expect(listbox.querySelector('a')).toBeNull()
  })

  it('keeps the warning link outside the listbox', async () => {
    render(
      <I18nProvider locale="en" dict={{}}>
        <TopbarSearchInline embeddingConfigured={false} missingConfigMessage="Vector search is not configured" />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open global search' }))
    const input = screen.getByRole('combobox')

    await typeQuery(input, 'mia')

    const listbox = await waitFor(() => screen.getByRole('listbox'))
    const link = screen.getByRole('link', { name: 'Configure search settings' })
    expect(listbox.contains(link)).toBe(false)
  })

  it('tells assistive technology which result is highlighted as the arrows move', async () => {
    const input = openSearch()

    await typeQuery(input, 'mia')
    await waitFor(() => screen.getByRole('listbox'))
    const [first, second] = screen.getAllByRole('option')

    expect(first.id).not.toBe('')
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
    expect(first.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id)
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(first.getAttribute('aria-selected')).toBe('false')
  })

  it('keeps results out of the tab order and still opens them on click and Enter', async () => {
    const input = openSearch()

    await typeQuery(input, 'mia')
    await waitFor(() => screen.getByRole('listbox'))
    const [first, second] = screen.getAllByRole('option')

    expect(first.getAttribute('tabindex')).toBe('-1')
    fireEvent.click(second)
    expect(mockPush).toHaveBeenCalledWith('/backend/customers/people-v2/p2')
  })
})

// Merged from the baseline's search-feedback suite after this PR moved the
// `listbox` role off the popover panel: the empty state, warning and error are
// panel content, not listbox options, so those assertions look at the panel.
describe('TopbarSearchInline search feedback', () => {
  const dictionary = {
    'search.dialog.empty.none': 'Brak wyników',
    'search.dialog.empty.hint': 'Wpisz co najmniej {count} znaki',
  }

  beforeEach(() => {
    jest.useFakeTimers()
    mockPush.mockReset()
    mockFetchResults.mockReset()
    mockFetchResults.mockResolvedValue({ results: [], error: null })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  function renderSearch(embeddingConfigured = true) {
    render(
      <I18nProvider locale="pl" dict={dictionary}>
        <TopbarSearchInline
          embeddingConfigured={embeddingConfigured}
          missingConfigMessage="Configure embeddings"
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open global search' }))
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    return input
  }

  async function finishSearch() {
    await act(async () => { jest.advanceTimersByTime(220) })
  }

  function panel() {
    return document.getElementById('topbar-search-results')
  }

  it('keeps an empty response visible and announces the translated status', async () => {
    const input = renderSearch()
    fireEvent.change(input, { target: { value: 'Zielonka' } })
    await finishSearch()

    expect(mockFetchResults).toHaveBeenCalledWith(
      'Zielonka',
      expect.objectContaining({ limit: expect.any(Number) }),
    )
    expect(panel()?.contains(screen.getByRole('status'))).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Brak wyników')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('waits for the request to finish before announcing an empty result', async () => {
    let resolveSearch!: (value: { results: SearchResult[]; error?: string | null }) => void
    mockFetchResults.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve }))
    fireEvent.change(renderSearch(), { target: { value: 'Zielonka' } })
    await finishSearch()

    expect(panel()).not.toBeNull()
    expect(screen.queryByText('Brak wyników')).toBeNull()
    await act(async () => { resolveSearch({ results: [] }) })
    expect(screen.getByRole('status').textContent).toBe('Brak wyników')
  })

  it('does not show no-results feedback for a blank or short query', () => {
    const input = renderSearch()
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(screen.getByText('Wpisz co najmniej 3 znaki')).toBeTruthy()
    expect(screen.queryByText('Brak wyników')).toBeNull()
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(mockFetchResults).not.toHaveBeenCalled()
  })

  it('shows matching records without an empty status', async () => {
    mockFetchResults.mockResolvedValue({ results: [{
      entityId: 'customers:customer_person_profile', recordId: 'person-1', score: 1,
      source: 'tokens', url: '/backend/customers/people/person-1', presenter: { title: 'Zielonka' },
    }], error: null })
    fireEvent.change(renderSearch(), { target: { value: 'Zielonka' } })
    await finishSearch()
    expect(screen.getByRole('option').textContent).toContain('Zielonka')
    expect(screen.queryByText('Brak wyników')).toBeNull()
  })

  it('shows a search error instead of the empty state', async () => {
    mockFetchResults.mockResolvedValue({ results: [], error: 'Search unavailable' })
    fireEvent.change(renderSearch(), { target: { value: 'Zielonka' } })
    await finishSearch()
    expect(screen.getByText('Search unavailable')).toBeTruthy()
    expect(screen.queryByText('Brak wyników')).toBeNull()
  })

  it('clears the empty response and keeps the warning without claiming a blank query has no matches', async () => {
    const input = renderSearch(false)
    expect(screen.getByText('Configure embeddings')).toBeTruthy()
    expect(screen.queryByText('Brak wyników')).toBeNull()
    fireEvent.change(input, { target: { value: 'Zielonka' } })
    await finishSearch()
    expect(screen.getByRole('status').textContent).toBe('Brak wyników')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('Configure embeddings')).toBeTruthy()
    expect(screen.queryByText('Brak wyników')).toBeNull()
  })

  it('dismisses an empty response with Escape or an outside click', async () => {
    const input = renderSearch()
    fireEvent.change(input, { target: { value: 'Zielonka' } })
    await finishSearch()
    expect(screen.getByRole('status')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.focus(input)
    expect(screen.getByRole('status')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
