/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { SearchResult } from '@open-mercato/shared/modules/search'
import { TopbarSearchInline } from '../TopbarSearchInline'
import { fetchGlobalSearchResults } from '../../utils'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}))
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
jest.mock('../../utils', () => ({ fetchGlobalSearchResults: jest.fn() }))

const fetchResultsMock = jest.mocked(fetchGlobalSearchResults)
const dictionary = {
  'search.dialog.empty.none': 'Brak wyników',
  'search.dialog.empty.hint': 'Wpisz co najmniej {count} znaki',
}

function renderSearch(embeddingConfigured = true) {
  render(
    <I18nProvider locale="pl" dict={dictionary}>
      <TopbarSearchInline embeddingConfigured={embeddingConfigured} missingConfigMessage="Configure embeddings" />
    </I18nProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open global search' }))
  const input = screen.getByRole('textbox')
  fireEvent.focus(input)
  return input
}

async function finishSearch() {
  await act(async () => { jest.advanceTimersByTime(220) })
}

describe('TopbarSearchInline search feedback', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    fetchResultsMock.mockReset()
    fetchResultsMock.mockResolvedValue({ results: [] })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('keeps an empty response visible and announces the translated status', async () => {
    const input = renderSearch()
    fireEvent.change(input, { target: { value: 'Zielonka' } })
    await finishSearch()

    expect(fetchResultsMock).toHaveBeenCalledWith('Zielonka', expect.objectContaining({ limit: 10 }))
    expect(screen.getByRole('listbox').contains(screen.getByRole('status'))).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Brak wyników')
  })

  it('waits for the request to finish before announcing an empty result', async () => {
    let resolveSearch!: (value: { results: SearchResult[] }) => void
    fetchResultsMock.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve }))
    fireEvent.change(renderSearch(), { target: { value: 'Zielonka' } })
    await finishSearch()

    expect(screen.getByRole('listbox')).toBeTruthy()
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
    expect(fetchResultsMock).not.toHaveBeenCalled()
  })

  it('shows matching records without an empty status', async () => {
    fetchResultsMock.mockResolvedValue({ results: [{
      entityId: 'customers:customer_person_profile', recordId: 'person-1', score: 1,
      source: 'tokens', url: '/backend/customers/people/person-1', presenter: { title: 'Zielonka' },
    }] })
    fireEvent.change(renderSearch(), { target: { value: 'Zielonka' } })
    await finishSearch()
    expect(screen.getByRole('option').textContent).toContain('Zielonka')
    expect(screen.queryByText('Brak wyników')).toBeNull()
  })

  it('shows a search error instead of the empty state', async () => {
    fetchResultsMock.mockResolvedValue({ results: [], error: 'Search unavailable' })
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
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.focus(input)
    expect(screen.getByRole('status')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
