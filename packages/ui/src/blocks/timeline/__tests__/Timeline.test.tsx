/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { timelinePropsSchema } from '../../contracts/timeline'
import type { TimelineItem, TimelineProps } from '../../contracts/timeline'
import { Timeline } from '../Timeline'
import { timelineFixtures } from '../fixtures'

const dict = {
  'ui.blocks.timeline.today': 'Today',
  'ui.blocks.timeline.yesterday': 'Yesterday',
  'ui.blocks.timeline.showMore': 'Show more',
  'ui.blocks.timeline.itemActions': 'Item actions',
  'ui.blocks.timeline.filters': 'Filter activity',
  'ui.blocks.timeline.loading': 'Loading activity',
  'ui.blocks.timeline.error': 'Could not load activity',
  'ui.blocks.timeline.empty': 'No activity yet',
  'ui.blocks.timeline.downloadAttachment': 'Download',
}

function renderTimeline(props: Partial<TimelineProps> & Pick<TimelineProps, 'items'>) {
  return renderWithProviders(<Timeline order="desc" {...props} />, { dict })
}

const items: TimelineItem[] = [
  {
    id: 'a',
    occurredAt: '2026-11-24T10:00:00Z',
    kind: 'note',
    title: 'added a note',
    author: { name: 'Anna Nowak' },
    actions: [
      { key: 'edit', label: 'Edit' },
      { key: 'delete', label: 'Delete', tone: 'destructive' },
    ],
  },
  { id: 'b', occurredAt: '2026-11-23T10:00:00Z', kind: 'stage', icon: 'phone', title: 'Call logged' },
  { id: 'c', occurredAt: '2026-11-20T10:00:00Z', kind: 'stage', title: 'Stage changed' },
]

describe('Timeline', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('renders items in the given order', () => {
    const { container } = renderTimeline({ items })
    const ids = Array.from(container.querySelectorAll('[data-timeline-item-id]')).map((node) =>
      node.getAttribute('data-timeline-item-id'),
    )
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('renders author and title without bold weight', () => {
    const { container } = renderTimeline({ items })
    const author = container.querySelector('[data-slot="timeline-item-author"]') as HTMLElement
    const title = container.querySelector('[data-slot="timeline-item-title"]') as HTMLElement
    expect(author.textContent).toBe('Anna Nowak')
    expect(title.textContent).toBe('added a note')
    const row = container.querySelector('[data-slot="activity-feed-item-title"]') as HTMLElement
    for (const node of [author, title, row, ...Array.from(row.querySelectorAll('*'))]) {
      expect(node.className).not.toMatch(/font-(semibold|bold)/)
    }
  })

  it('renders a time element with an ISO dateTime and a full date title', () => {
    const { container } = renderTimeline({ items })
    const time = container.querySelector('time') as HTMLTimeElement
    expect(time.getAttribute('datetime')).toBe('2026-11-24T10:00:00Z')
    expect(time.getAttribute('title')).toBeTruthy()
  })

  it('uses a lucide icon in a circle when there is no author', () => {
    const { container } = renderTimeline({ items })
    const icons = container.querySelectorAll('[data-slot="timeline-item-icon"]')
    expect(icons).toHaveLength(2)
    expect(icons[0].querySelector('svg')).not.toBeNull()
  })

  it('calls onItemAction from the kebab menu', async () => {
    const onItemAction = jest.fn()
    renderTimeline({ items, onItemAction })
    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }))
    fireEvent.click(await screen.findByText('Delete'))
    await waitFor(() => expect(onItemAction).toHaveBeenCalledWith('a', 'delete'))
  })

  it('renders an icon for a menu action with a resolvable icon name', async () => {
    const iconItems: TimelineItem[] = [
      {
        id: 'i',
        occurredAt: '2026-11-24T10:00:00Z',
        kind: 'note',
        title: 'added a note',
        actions: [
          { key: 'edit', label: 'Edit', icon: 'star' },
          { key: 'plain', label: 'Plain', icon: 'not-a-real-icon' },
        ],
      },
    ]
    renderTimeline({ items: iconItems, onItemAction: jest.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }))
    const withIcon = await screen.findByRole('option', { name: /Edit/ })
    expect(withIcon.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('option', { name: /Plain/ }).querySelector('svg')).toBeNull()
  })

  it('calls onFilterChange and marks the active chip', () => {
    const onFilterChange = jest.fn()
    renderTimeline({
      items,
      filters: [
        { key: 'all', label: 'All', count: 3 },
        { key: 'notes', label: 'Notes' },
      ],
      activeFilterKey: 'all',
      onFilterChange,
    })
    const group = screen.getByRole('group', { name: 'Filter activity' })
    expect(group).toBeTruthy()
    const all = screen.getByRole('button', { name: /All/ })
    const notes = screen.getByRole('button', { name: 'Notes' })
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(all.textContent).toContain('3')
    expect(notes.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(notes)
    expect(onFilterChange).toHaveBeenCalledWith('notes')
  })

  it.each([
    ['resolve', true],
    ['reject', false],
  ])('disables Show more while loading and re-enables after %s', async (_label, shouldResolve) => {
    let settle: () => void = () => undefined
    const onLoadMore = jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = shouldResolve ? resolve : () => reject(new Error('failed'))
        }),
    )
    renderTimeline({ items, hasMore: true, onLoadMore })
    const button = screen.getByRole('button', { name: /Show more/ }) as HTMLButtonElement
    fireEvent.click(button)
    await waitFor(() => expect(button.disabled).toBe(true))
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    await act(async () => {
      settle()
    })
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('disables the kebab with a spinner while an item action is pending and recovers after rejection', async () => {
    let rejectAction: () => void = () => undefined
    const onItemAction = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAction = () => reject(new Error('failed'))
        }),
    )
    const { container } = renderTimeline({ items, onItemAction })
    const trigger = screen.getByRole('button', { name: 'Item actions' }) as HTMLButtonElement
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByText('Delete'))
    await waitFor(() => expect(trigger.disabled).toBe(true))
    expect(trigger.querySelector('[role="status"], svg.animate-spin, [data-slot="spinner"]')).not.toBeNull()
    await act(async () => {
      rejectAction()
    })
    await waitFor(() => expect(trigger.disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.textContent).not.toMatch(/failed/i)
  })

  it('renders an https attachment as a download link', () => {
    renderTimeline({
      items: [
        {
          id: 'l',
          occurredAt: '2026-11-24T10:00:00Z',
          kind: 'file',
          title: 'uploaded',
          attachments: [{ name: 'offer.pdf', href: 'https://example.com/offer.pdf' }],
        },
      ],
    })
    const link = screen.getByRole('link', { name: 'Download' })
    expect(link.getAttribute('href')).toBe('https://example.com/offer.pdf')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('renders a relative attachment link but rejects protocol-relative and script hrefs', () => {
    renderTimeline({
      items: [
        {
          id: 'm',
          occurredAt: '2026-11-24T10:00:00Z',
          kind: 'file',
          title: 'uploaded',
          attachments: [
            { name: 'rel.pdf', href: '/files/rel.pdf' },
            { name: 'proto.pdf', href: '//evil.example/x.pdf' },
            { name: 'bad.pdf', href: 'javascript:alert(1)' },
          ],
        },
      ],
    })
    const links = screen.getAllByRole('link', { name: 'Download' })
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/files/rel.pdf')
  })

  it('renders no download control for a javascript: href', () => {
    renderTimeline({
      items: [
        {
          id: 'n',
          occurredAt: '2026-11-24T10:00:00Z',
          kind: 'file',
          title: 'uploaded',
          attachments: [{ name: 'bad.pdf', href: 'javascript:alert(1)' }],
        },
      ],
    })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('bad.pdf')).toBeTruthy()
  })

  describe('day grouping', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] })
      jest.setSystemTime(new Date('2026-11-24T12:00:00Z'))
    })
    afterEach(() => {
      jest.useRealTimers()
    })

    it('renders a label above each day group', () => {
      const { container } = renderTimeline({ items, groupBy: 'day' })
      const labels = Array.from(container.querySelectorAll('[data-slot="timeline-day-label"]')).map(
        (node) => node.textContent,
      )
      expect(labels[0]).toBe('Today')
      expect(labels[1]).toBe('Yesterday')
      expect(labels).toHaveLength(3)
    })

    it('renders separate groups for non-adjacent same-day items and no heading for invalid dates', () => {
      const { container } = renderTimeline({
        items: [
          { id: 'p', occurredAt: '2026-11-24T10:00:00Z', kind: 'note', title: 'one' },
          { id: 'q', occurredAt: '2026-11-23T10:00:00Z', kind: 'note', title: 'two' },
          { id: 'r', occurredAt: '2026-11-24T09:00:00Z', kind: 'note', title: 'three' },
          { id: 's', occurredAt: 'not-a-date', kind: 'note', title: 'four' },
        ],
        groupBy: 'day',
      })
      expect(container.querySelectorAll('[data-slot="timeline-day-group"]')).toHaveLength(4)
      expect(container.querySelectorAll('[data-slot="timeline-day-label"]')).toHaveLength(3)
    })
  })

  it('renders attachments, status chip and a custom body', () => {
    const { container } = renderTimeline({
      items: [
        {
          id: 'x',
          occurredAt: '2026-11-24T10:00:00Z',
          kind: 'file',
          title: 'uploaded',
          body: 'Default body',
          attachments: [{ name: 'offer.pdf', format: 'pdf' }],
          status: { label: 'Approved', tone: 'success' },
        },
      ],
      renderItemBody: (item) => <span>Custom {item.id}</span>,
    })
    expect(screen.getByText('offer.pdf')).toBeTruthy()
    expect(container.querySelector('[data-slot="activity-feed-status-chip"][data-status="success"]')).not.toBeNull()
    expect(screen.getByText('Custom x')).toBeTruthy()
    expect(screen.queryByText('Default body')).toBeNull()
  })

  it('does not render a menu without actions', () => {
    renderTimeline({ items: [items[1]] })
    expect(screen.queryByRole('button', { name: 'Item actions' })).toBeNull()
  })

  describe('status', () => {
    it('shows the loading message', () => {
      renderTimeline({ items: [], status: 'loading' })
      expect(screen.getByText('Loading activity')).toBeTruthy()
    })

    it('shows the error message', () => {
      renderTimeline({ items: [], status: 'error', errorMessage: 'Boom' })
      expect(screen.getByRole('alert').textContent).toContain('Boom')
    })

    it('shows the empty state', () => {
      renderTimeline({ items: [], status: 'empty' })
      expect(screen.getByText('No activity yet')).toBeTruthy()
    })

    it('keeps header and filters rendered above the empty state', () => {
      renderTimeline({
        items: [],
        status: 'empty',
        header: <h2>Activity</h2>,
        filters: [{ key: 'all', label: 'All' }],
        activeFilterKey: 'all',
      })
      expect(screen.getByText('Activity')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'All' })).toBeTruthy()
      expect(screen.getByText('No activity yet')).toBeTruthy()
    })

    it('prefers a custom empty state', () => {
      renderTimeline({ items: [], status: 'empty', emptyState: <p>Custom empty</p> })
      expect(screen.getByText('Custom empty')).toBeTruthy()
    })

    it('renders the header slot', () => {
      renderTimeline({ items, header: <h2>Activity</h2> })
      expect(screen.getByText('Activity')).toBeTruthy()
    })
  })

  describe('fixtures', () => {
    it.each(Object.entries(timelineFixtures))('%s parses against the contract and renders', (_name, props) => {
      expect(timelinePropsSchema.safeParse(props).success).toBe(true)
      expect(() => renderWithProviders(<Timeline {...(props as TimelineProps)} />, { dict })).not.toThrow()
    })
  })
})
