import * as React from 'react'
import type { TimelineItem, TimelineProps } from '../contracts/timeline'

const HOUR = 60 * 60 * 1000
const baseTime = new Date('2026-11-24T12:00:00Z').getTime()

function at(hoursAgo: number): string {
  return new Date(baseTime - hoursAgo * HOUR).toISOString()
}

const rowActions = [
  { key: 'edit', label: 'Edit', icon: 'pencil-line' },
  { key: 'pin', label: 'Pin to top', icon: 'bookmark', disabled: true, disabledReason: 'Already pinned' },
  { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' as const },
]

const mixedItems: TimelineItem[] = [
  {
    id: 'note-1',
    occurredAt: at(0.2),
    kind: 'note',
    title: 'added a note',
    author: { name: 'Anna Nowak' },
    body: 'Customer asked for a revised quote with volume pricing.',
    actions: rowActions,
  },
  {
    id: 'system-1',
    occurredAt: at(3),
    kind: 'stage-change',
    icon: 'trending-up',
    title: 'Deal moved to Negotiation',
    status: { label: 'Negotiation', tone: 'info' },
  },
  {
    id: 'file-1',
    occurredAt: at(26),
    kind: 'file',
    title: 'uploaded a document',
    author: { name: 'Jan Kowalski' },
    attachments: [
      { name: 'offer-2026-11.pdf', format: '240 KB' },
      { name: 'price-list.xlsx', format: '88 KB' },
    ],
    actions: rowActions,
  },
  {
    id: 'status-1',
    occurredAt: at(52),
    kind: 'approval',
    icon: 'check-circle-2',
    title: 'Discount approval finished',
    status: { label: 'Approved', tone: 'success' },
  },
  {
    id: 'email-1',
    occurredAt: at(120),
    kind: 'email',
    title: 'sent an email',
    author: { name: 'Maria Wisniewska' },
    status: { label: 'Bounced', tone: 'error' },
    actions: rowActions,
  },
]

const groupedItems: TimelineItem[] = [
  { id: 'g-1', occurredAt: at(0.5), kind: 'call', title: 'logged a call', author: { name: 'Anna Nowak' } },
  { id: 'g-2', occurredAt: at(1.5), kind: 'note', icon: 'sticky-note', title: 'Reminder created' },
  { id: 'g-3', occurredAt: at(30), kind: 'email', title: 'sent a follow-up', author: { name: 'Jan Kowalski' } },
  { id: 'g-4', occurredAt: at(200), kind: 'meeting', icon: 'calendar', title: 'Meeting scheduled' },
]

const noop = (): void => undefined
const noopAsync = async (): Promise<void> => undefined

const filters = [
  { key: 'all', label: 'All', count: 12 },
  { key: 'notes', label: 'Notes', count: 5 },
  { key: 'emails', label: 'Emails', count: 4 },
  { key: 'files', label: 'Files', count: 3 },
]

export const timelineFixtures = {
  default: {
    items: mixedItems,
    order: 'desc',
    onItemAction: noop,
  },
  groupedByDay: {
    items: groupedItems,
    order: 'desc',
    groupBy: 'day',
  },
  withFilters: {
    items: mixedItems.slice(0, 3),
    order: 'desc',
    filters,
    activeFilterKey: 'all',
    onFilterChange: noop,
    onItemAction: noop,
  },
  withMore: {
    items: groupedItems.slice(0, 3),
    order: 'desc',
    hasMore: true,
    onLoadMore: noopAsync,
  },
  customBody: {
    items: [
      {
        id: 'c-1',
        occurredAt: at(2),
        kind: 'quote',
        icon: 'file-text',
        title: 'Quote Q-1042 sent',
        author: { name: 'Anna Nowak' },
      },
    ],
    order: 'desc',
    renderItemBody: (item: TimelineItem) =>
      React.createElement('p', { className: 'text-sm text-muted-foreground' }, `Custom body for ${item.id}`),
  },
  readOnly: {
    items: mixedItems.map((item) => ({ ...item, actions: undefined })),
    order: 'desc',
  },
  loading: { items: [], order: 'desc', status: 'loading' },
  error: { items: [], order: 'desc', status: 'error', errorMessage: 'Could not load activity' },
  empty: { items: [], order: 'desc', status: 'empty' },
} satisfies Record<string, TimelineProps>

export type TimelineFixtureName = keyof typeof timelineFixtures
