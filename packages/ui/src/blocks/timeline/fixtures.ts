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

const changeItems: TimelineItem[] = [
  {
    id: 'chg-1',
    occurredAt: at(0.1),
    kind: 'update',
    icon: 'pencil-line',
    title: 'changed Stage and 4 other fields in',
    author: { name: 'Alex Smith' },
    target: { label: 'Sales pipeline', icon: 'briefcase' },
    changes: [
      { key: 'stage', label: 'Stage', icon: 'trending-up', from: 'Qualified', to: 'Meeting' },
      { key: 'priority', label: 'Priority', icon: 'flag', to: 'Medium' },
      { key: 'owner', label: 'Owner', icon: 'user-round', to: 'Alex Smith' },
      { key: 'value', label: 'Estimated value', icon: 'banknote', to: '$50,000' },
      { key: 'close', label: 'Close date', icon: 'calendar', to: 'Sep 29, 2026' },
    ],
    actions: rowActions,
  },
  {
    id: 'chg-2',
    occurredAt: at(4),
    kind: 'note',
    title: 'added a note',
    author: { name: 'Anna Nowak' },
    body: 'Call went well. They want volume pricing for three warehouses and a pilot in Q1. Procurement needs the security questionnaire before the next meeting, and legal will review the master agreement in parallel. Follow up with the revised quote on Friday and loop in the regional manager for the pilot scope.',
    actions: rowActions,
  },
  {
    id: 'chg-3',
    occurredAt: at(5),
    kind: 'list',
    icon: 'list',
    title: 'Acme Corp was added to',
    target: { label: 'Enterprise accounts', icon: 'building', href: '/backend/customers' },
  },
  {
    id: 'chg-4',
    occurredAt: at(30),
    kind: 'created',
    title: 'Acme Corp was created',
  },
]

const DAY = 24 * HOUR

const periodItems: TimelineItem[] = [
  { id: 'p-1', occurredAt: at(2), kind: 'call', title: 'logged a call', author: { name: 'Anna Nowak' } },
  { id: 'p-2', occurredAt: at(20), kind: 'email', title: 'sent a follow-up', author: { name: 'Jan Kowalski' } },
  { id: 'p-3', occurredAt: new Date(baseTime - 12 * DAY).toISOString(), kind: 'meeting', title: 'Meeting scheduled' },
  { id: 'p-4', occurredAt: new Date(baseTime - 160 * DAY).toISOString(), kind: 'stage-change', title: 'Deal moved to Qualified' },
  { id: 'p-5', occurredAt: new Date(baseTime - 520 * DAY).toISOString(), kind: 'created', title: 'Acme Corp was created' },
]

const noop = (): void => undefined
const noopAsync = async (): Promise<void> => undefined

const filters = [
  { key: 'all', label: 'All', count: 3 },
  { key: 'notes', label: 'Notes', count: 1 },
  { key: 'updates', label: 'Updates', count: 1 },
  { key: 'files', label: 'Files', count: 1 },
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
  fieldChanges: {
    items: changeItems,
    order: 'desc',
    onItemAction: noop,
  },
  groupedByPeriod: {
    items: periodItems,
    order: 'desc',
    groupBy: 'period',
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
        title: 'sent quote Q-1042',
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
  error: { items: [], order: 'desc', status: 'error', errorMessage: 'Could not load activity', onRetry: noop },
  empty: { items: [], order: 'desc', status: 'empty' },
} satisfies Record<string, TimelineProps>

export type TimelineFixtureName = keyof typeof timelineFixtures
