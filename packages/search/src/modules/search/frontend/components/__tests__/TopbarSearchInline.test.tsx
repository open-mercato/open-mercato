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
