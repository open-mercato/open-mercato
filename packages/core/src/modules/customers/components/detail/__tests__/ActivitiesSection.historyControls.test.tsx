/**
 * @jest-environment jsdom
 *
 * Guards the history capabilities the company tab had before it moved to the
 * shared section (#7494): search across pages, title sort choices and a visible
 * failed-load state with retry. Callers that do not opt in keep the local filter.
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActivitiesSection } from '../ActivitiesSection'
import { ActivityLogTab } from '../ActivityLogTab'
import type { InteractionSummary } from '../types'

const mockT = (key: string, fallback?: string) => fallback ?? key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockT,
}))

type CanonicalPayload = { items: Array<Partial<InteractionSummary>>; nextCursor?: string }
type LegacyPayload = { items: Array<Record<string, unknown>>; totalPages: number }

const mockCanonicalHandler = jest.fn<Promise<CanonicalPayload>, [URLSearchParams]>()
const mockLegacyHandler = jest.fn<Promise<LegacyPayload>, [URLSearchParams]>()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: async () => ({}),
  readApiResultOrThrow: async (url: string) => {
    const [path, query] = url.split('?')
    const params = new URLSearchParams(query)
    if (path === '/api/customers/interactions') return mockCanonicalHandler(params)
    if (path === '/api/customers/activities') return mockLegacyHandler(params)
    return {}
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('../ActivityTimeline', () => ({
  ActivityTimeline: ({ activities }: { activities: InteractionSummary[] }) => (
    <ul aria-label="timeline">
      {activities.length === 0 ? <li>empty history</li> : null}
      {activities.map((activity) => <li key={activity.id}>{activity.title ?? activity.body}</li>)}
    </ul>
  ),
}))

jest.mock('../InlineActivityComposer', () => ({ InlineActivityComposer: () => null }))
jest.mock('../PlannedActivitiesSection', () => ({ PlannedActivitiesSection: () => null }))

const mockSelectContext = React.createContext<(value: string) => void>(() => undefined)
jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => (
    <mockSelectContext.Provider value={onValueChange}>{children}</mockSelectContext.Provider>
  ),
  SelectTrigger: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => <span role="combobox" aria-controls="sort" aria-expanded aria-label={ariaLabel} />,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
    const onValueChange = React.useContext(mockSelectContext)
    return <button type="button" role="option" aria-selected={false} onClick={() => onValueChange(value)}>{children}</button>
  },
}))

function row(id: string, title: string | null, overrides: Partial<InteractionSummary> = {}): Partial<InteractionSummary> {
  return {
    id,
    title,
    interactionType: 'call',
    status: 'done',
    scheduledAt: null,
    occurredAt: '2026-03-29T09:00:00.000Z',
    createdAt: '2026-03-29T09:00:00.000Z',
    updatedAt: '2026-03-29T09:00:00.000Z',
    ...overrides,
  }
}

function fullPage(prefix: string): Array<Partial<InteractionSummary>> {
  return Array.from({ length: 50 }, (_, index) => row(`${prefix}-${index}`, `${prefix} ${index}`))
}

function renderedTitles(): string[] {
  return Array.from(screen.getByRole('list', { name: 'timeline' }).querySelectorAll('li')).map((item) => item.textContent ?? '')
}

function canonicalRequests(): URLSearchParams[] {
  return mockCanonicalHandler.mock.calls.map(([params]) => params)
}

function searchFor(term: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: term } })
}

const sectionProps = {
  entityId: 'company-1',
  useCanonicalInteractions: true,
  addActionLabel: 'Add',
  emptyState: { title: 'No activities', actionLabel: 'Add' },
}

beforeEach(() => {
  mockCanonicalHandler.mockReset()
  mockLegacyHandler.mockReset()
  mockCanonicalHandler.mockResolvedValue({ items: [] })
  mockLegacyHandler.mockResolvedValue({ items: [], totalPages: 1 })
})

describe('history search', () => {
  function renderCompanyTab() {
    return render(
      <ActivityLogTab
        entityType="company"
        entityId="company-1"
        plannedActivities={[]}
        onScheduleRequested={() => {}}
        onEditActivity={() => {}}
        useCanonicalInteractions
      />,
    )
  }

  it('finds on the company tab a row whose only match is beyond the first page', async () => {
    mockCanonicalHandler.mockImplementation(async (params) => {
      if (params.get('search') === 'renewal') return { items: [row('page-2-row', 'Renewal call')] }
      return { items: fullPage('recent'), nextCursor: 'cursor-2' }
    })
    renderCompanyTab()
    await screen.findByText('recent 0')
    expect(screen.queryByText('Renewal call')).toBeNull()

    searchFor(' renewal ')

    expect(await screen.findByText('Renewal call')).toBeTruthy()
    const searched = canonicalRequests().filter((params) => params.has('search'))
    expect(searched.length).toBeGreaterThan(0)
    expect(searched.every((params) => params.get('search') === 'renewal' && !params.has('cursor'))).toBe(true)
    expect(renderedTitles()).toEqual(['Renewal call'])
  })

  it('sends no term for blank input', async () => {
    mockCanonicalHandler.mockResolvedValue({ items: [row('a', 'Alpha')] })
    render(<ActivitiesSection {...sectionProps} serverHistoryControls />)
    await screen.findByText('Alpha')
    searchFor('   ')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
    expect(canonicalRequests().some((params) => params.has('search'))).toBe(false)
  })

  it('resets the cursor and the loaded pages when the term changes', async () => {
    mockCanonicalHandler.mockImplementation(async (params) => {
      if (params.get('search')) return { items: [row('match', 'Match')], nextCursor: 'search-cursor' }
      if (params.get('cursor') === 'cursor-2') return { items: [row('second', 'Second page')] }
      return { items: [row('first', 'First page')], nextCursor: 'cursor-2' }
    })
    render(<ActivitiesSection {...sectionProps} serverHistoryControls />)
    await screen.findByText('First page')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Second page')

    mockCanonicalHandler.mockClear()
    searchFor('match')
    await screen.findByText('Match')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

    expect(canonicalRequests().filter((params) => params.has('search')).every((params) => !params.has('cursor'))).toBe(true)
    expect(canonicalRequests().some((params) => params.get('cursor') === 'search-cursor')).toBe(false)

    mockCanonicalHandler.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => {
      expect(canonicalRequests().some((params) => params.get('cursor') === 'search-cursor')).toBe(true)
    })
    expect(canonicalRequests().find((params) => params.get('cursor') === 'search-cursor')?.get('search')).toBe('match')
  })

  it('ignores a slower response for an earlier term', async () => {
    let resolveEarlier: (payload: CanonicalPayload) => void = () => undefined
    mockCanonicalHandler.mockImplementation((params) => {
      if (params.get('search') === 'earlier') {
        return new Promise<CanonicalPayload>((resolve) => { resolveEarlier = resolve })
      }
      if (params.get('search') === 'later') return Promise.resolve({ items: [row('later', 'later result')] })
      return Promise.resolve({ items: [] })
    })
    render(<ActivitiesSection {...sectionProps} serverHistoryControls />)
    searchFor('earlier')
    await waitFor(() => {
      expect(canonicalRequests().some((params) => params.get('search') === 'earlier')).toBe(true)
    })
    searchFor('later')
    await screen.findByText('later result')

    await act(async () => { resolveEarlier({ items: [row('earlier', 'earlier result')] }) })

    expect(screen.queryByText('earlier result')).toBeNull()
    expect(renderedTitles()).toEqual(['later result'])
  })

  it('keeps matching loaded rows on author when the API search finds nothing, as the person tab did', async () => {
    mockCanonicalHandler.mockImplementation(async (params) => {
      if (params.get('search')) return { items: [] }
      return {
        items: [
          row('by-ada', 'Quarterly review', { authorName: 'Ada Lovelace' }),
          row('by-alan', 'Pricing call', { authorName: 'Alan Turing' }),
        ],
      }
    })
    render(
      <ActivityLogTab
        entityType="person"
        entityId="person-1"
        plannedActivities={[]}
        onScheduleRequested={() => {}}
        onEditActivity={() => {}}
        useCanonicalInteractions
      />,
    )
    await screen.findByText('Pricing call')

    searchFor('lovelace')

    await waitFor(() => { expect(renderedTitles()).toEqual(['Quarterly review']) })
  })

  it('keeps later pages reachable when the API search finds nothing, for matches it does not cover', async () => {
    mockCanonicalHandler.mockImplementation(async (params) => {
      if (params.get('search')) return { items: [] }
      if (params.get('cursor') === 'cursor-2') return { items: [row('deep', 'Deep renewal note')] }
      return { items: [row('top', 'Top row')], nextCursor: 'cursor-2' }
    })
    render(<ActivitiesSection {...sectionProps} serverHistoryControls />)
    await screen.findByText('Top row')

    searchFor('renewal')
    await screen.findByText('empty history')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('Deep renewal note')
    expect(renderedTitles()).toEqual(['Deep renewal note'])
  })

  it('filters legacy rows by the term when the record is not canonical yet', async () => {
    mockCanonicalHandler.mockResolvedValue({ items: [] })
    mockLegacyHandler.mockResolvedValue({
      items: [
        { id: 'legacy-a', activityType: 'call', subject: 'Legacy renewal', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'legacy-b', activityType: 'call', subject: 'Legacy pricing', createdAt: '2026-01-02T00:00:00.000Z' },
      ],
      totalPages: 1,
    })
    render(<ActivitiesSection {...sectionProps} useCanonicalInteractions={false} serverHistoryControls />)
    await screen.findByText('Legacy pricing')

    searchFor('renewal')

    await waitFor(() => { expect(renderedTitles()).toEqual(['Legacy renewal']) })
  })

  it('keeps the local filter and sends no term or sort for callers that do not opt in', async () => {
    mockCanonicalHandler.mockResolvedValue({ items: [row('a', 'Alpha'), row('b', 'Beta')] })
    render(<ActivitiesSection {...sectionProps} />)
    await screen.findByText('Alpha')

    searchFor('beta')
    await waitFor(() => { expect(renderedTitles()).toEqual(['Beta']) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })

    expect(canonicalRequests().some((params) => params.has('search'))).toBe(false)
    expect(canonicalRequests().every((params) => params.get('sortField') === 'occurredAt')).toBe(true)
    expect(screen.queryByRole('combobox', { name: 'Sort order' })).toBeNull()
  })
})

describe('history load failures', () => {
  it('shows a failed company load as an error, not as empty history, and recovers on retry', async () => {
    mockCanonicalHandler.mockRejectedValueOnce(new Error('[internal] 500'))
    render(
      <ActivityLogTab
        entityType="company"
        entityId="company-1"
        plannedActivities={[]}
        onScheduleRequested={() => {}}
        onEditActivity={() => {}}
        useCanonicalInteractions
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Failed to load activities.')
    expect(screen.queryByText('empty history')).toBeNull()

    mockCanonicalHandler.mockResolvedValue({ items: [row('restored', 'Restored row')] })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Restored row')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a failed page on an opted-in section outside canonical mode', async () => {
    mockCanonicalHandler.mockRejectedValue(new Error('[internal] 500'))
    render(<ActivitiesSection {...sectionProps} useCanonicalInteractions={false} serverHistoryControls />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('keeps the legacy fallback for callers that merge legacy activities and did not opt in', async () => {
    mockCanonicalHandler.mockRejectedValue(new Error('[internal] 403'))
    mockLegacyHandler.mockResolvedValue({
      items: [{ id: 'legacy-a', activityType: 'call', subject: 'Legacy row', createdAt: '2026-01-01T00:00:00.000Z' }],
      totalPages: 1,
    })
    render(<ActivitiesSection {...sectionProps} useCanonicalInteractions={false} />)

    await screen.findByText('Legacy row')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('history sort', () => {
  function serveTitlesOverTwoPages(pages: Array<Array<Partial<InteractionSummary>>>) {
    mockCanonicalHandler.mockImplementation(async (params) => {
      if (params.get('sortField') !== 'title') return { items: [row('newest', 'Newest row')], nextCursor: 'recent-cursor' }
      if (params.get('cursor') === 'title-cursor') return { items: pages[1] }
      return { items: pages[0], nextCursor: 'title-cursor' }
    })
  }

  it.each([
    {
      option: 'Sort: Name A-Z',
      sortDir: 'asc',
      pages: [[row('a', 'apple'), row('b', 'Banana')], [row('c', 'cherry')]],
      expected: ['apple', 'Banana', 'cherry'],
    },
    {
      option: 'Sort: Name Z-A',
      sortDir: 'desc',
      pages: [[row('c', 'cherry'), row('b', 'Banana')], [row('a', 'apple')]],
      expected: ['cherry', 'Banana', 'apple'],
    },
  ])('$option asks the API for that order and keeps it across pages', async ({ option, sortDir, pages, expected }) => {
    serveTitlesOverTwoPages(pages)
    render(<ActivitiesSection {...sectionProps} serverHistoryControls />)
    await screen.findByText('Newest row')
    expect(canonicalRequests()[0]?.get('sortField')).toBe('occurredAt')
    expect(canonicalRequests()[0]?.get('sortDir')).toBe('desc')

    fireEvent.click(screen.getByRole('option', { name: option }))
    await screen.findByText(expected[0]!)
    expect(canonicalRequests().at(-1)?.get('sortField')).toBe('title')
    expect(canonicalRequests().at(-1)?.get('sortDir')).toBe(sortDir)
    expect(canonicalRequests().at(-1)?.has('cursor')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText(expected[2]!)

    const paged = canonicalRequests().find((params) => params.get('cursor') === 'title-cursor')
    expect(paged?.get('sortField')).toBe('title')
    expect(paged?.get('sortDir')).toBe(sortDir)
    expect(renderedTitles()).toEqual(expected)
  })

  it('goes back to the newest order and to the first page', async () => {
    serveTitlesOverTwoPages([[row('a', 'apple')], [row('b', 'Banana')]])
    render(<ActivitiesSection {...sectionProps} serverHistoryControls />)
    await screen.findByText('Newest row')
    fireEvent.click(screen.getByRole('option', { name: 'Sort: Name A-Z' }))
    await screen.findByText('apple')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Banana')

    mockCanonicalHandler.mockClear()
    fireEvent.click(screen.getByRole('option', { name: 'Sort: newest' }))

    await screen.findByText('Newest row')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(canonicalRequests().length).toBeGreaterThan(0)
    expect(canonicalRequests().every((params) => (
      params.get('sortField') === 'occurredAt' && params.get('sortDir') === 'desc' && !params.has('cursor')
    ))).toBe(true)
  })
})
