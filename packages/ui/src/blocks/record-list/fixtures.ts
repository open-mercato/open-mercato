import type { RecordListItem, RecordListProps } from '../contracts/record-list'

const noop = () => undefined

const editAndDelete: RecordListItem['actions'] = [
  { key: 'edit', label: 'Edit', icon: 'pencil-line' },
  { key: 'duplicate', label: 'Duplicate', icon: 'copy' },
  { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' },
]

const jobHistoryItems: RecordListItem[] = [
  {
    id: 'job-1',
    title: 'Warehouse team lead',
    subtitle: 'Harbor Logistics',
    meta: 'Mar 2023 to present',
    actions: editAndDelete,
  },
  {
    id: 'job-2',
    title: 'Shift coordinator',
    subtitle: 'Harbor Logistics',
    meta: 'Jan 2021 to Feb 2023',
    actions: editAndDelete,
  },
  {
    id: 'job-3',
    title: 'Order picker',
    subtitle: 'Riverside Depot',
    meta: 'Jun 2019 to Dec 2020',
    actions: editAndDelete,
  },
]

const recentOrderItems: RecordListItem[] = [
  {
    id: 'order-1042',
    title: 'Order 1042',
    href: '#order-1042',
    badge: { label: 'Paid', tone: 'success' },
    subtitle: 'Lena Brandt',
    meta: '12 Mar 2026',
    trailing: '1,240.00 EUR',
  },
  {
    id: 'order-1041',
    title: 'Order 1041',
    href: '#order-1041',
    badge: { label: 'Awaiting payment', tone: 'info' },
    subtitle: 'Tomas Reed',
    meta: '11 Mar 2026',
    trailing: '318.50 EUR',
  },
  {
    id: 'order-1040',
    title: 'Order 1040',
    href: '#order-1040',
    badge: { label: 'Cancelled', tone: 'error' },
    subtitle: 'Ines Moreau',
    meta: '10 Mar 2026',
    trailing: '89.00 EUR',
  },
  {
    id: 'order-1039',
    title: 'Order 1039',
    href: '#order-1039',
    badge: { label: 'Draft', tone: 'neutral' },
    subtitle: 'Piotr Lis',
    meta: '9 Mar 2026',
    trailing: '2,005.10 EUR',
  },
]

const unlink: RecordListItem['actions'] = [{ key: 'unlink', label: 'Unlink', icon: 'minus-circle' }]

const linkedCompanyItems: RecordListItem[] = [
  {
    id: 'company-1',
    title: 'Harbor Logistics',
    href: '#company-1',
    avatarLabel: 'Harbor Logistics',
    badge: { label: 'Primary', tone: 'info' },
    subtitle: 'Operations manager',
    meta: 'since 2021',
    actions: unlink,
  },
  {
    id: 'company-2',
    title: 'Riverside Depot',
    href: '#company-2',
    avatarLabel: 'Riverside Depot',
    subtitle: 'Advisor',
    meta: 'since 2023',
    actions: unlink,
  },
  {
    id: 'company-3',
    title: 'Blue Fjord Trading',
    href: '#company-3',
    avatarLabel: 'Blue Fjord Trading',
    subtitle: 'Board member',
    meta: 'since 2024',
    actions: unlink,
  },
]

const messageAndRemove: RecordListItem['actions'] = [
  { key: 'message', label: 'Send a message', icon: 'mail' },
  { key: 'change-role', label: 'Change role', icon: 'user-check' },
  { key: 'remove', label: 'Remove from account', icon: 'user-minus', tone: 'destructive' },
]

const peopleItems: RecordListItem[] = [
  {
    id: 'person-1',
    title: 'Lena Brandt',
    href: '#person-1',
    avatarLabel: 'Lena Brandt',
    subtitle: 'Head of purchasing',
    meta: 'lena.brandt@harbor.example',
    badge: { label: 'Decision maker', tone: 'success' },
    actions: messageAndRemove,
  },
  {
    id: 'person-2',
    title: 'Tomas Reed',
    href: '#person-2',
    avatarLabel: 'Tomas Reed',
    subtitle: 'Logistics planner',
    meta: 'tomas.reed@harbor.example',
    actions: messageAndRemove,
  },
  {
    id: 'person-3',
    title: 'Ines Moreau',
    href: '#person-3',
    avatarLabel: 'Ines Moreau',
    subtitle: 'Accounts payable',
    meta: 'ines.moreau@harbor.example',
    badge: { label: 'Billing contact', tone: 'info' },
    actions: messageAndRemove,
  },
  {
    id: 'person-4',
    title: 'Mateus Oliveira',
    href: '#person-4',
    avatarLabel: 'Mateus Oliveira',
    subtitle: 'Warehouse supervisor',
    meta: 'mateus.oliveira@harbor.example',
    actions: messageAndRemove,
  },
]

const dealItems: RecordListItem[] = [
  {
    id: 'deal-1',
    title: 'Cold storage expansion',
    href: '#deal-1',
    subtitle: 'Harbor Logistics',
    meta: 'closes 30 Apr 2026',
    description:
      'Second chamber for the northern site. The client asked for a split delivery and a longer service contract, so the offer needs a new price for installation.',
    badges: [
      { label: 'Negotiation', tone: 'info' },
      { label: 'Offer sent', tone: 'success' },
    ],
    trailing: '84,500.00 EUR',
    actions: editAndDelete,
  },
  {
    id: 'deal-2',
    title: 'Forklift fleet renewal',
    href: '#deal-2',
    subtitle: 'Riverside Depot',
    meta: 'closes 15 May 2026',
    description: 'Twelve electric trucks replacing the current lease. Waiting for the trade-in valuation.',
    badges: [
      { label: 'Qualified', tone: 'neutral' },
      { label: 'Key account', tone: 'info' },
      { label: 'Legal review', tone: 'neutral' },
      { label: 'Credit check passed', tone: 'success' },
      { label: 'Tender', tone: 'neutral' },
    ],
    trailing: '212,000.00 EUR',
    actions: editAndDelete,
  },
  {
    id: 'deal-3',
    title: 'Racking for the returns hall',
    href: '#deal-3',
    subtitle: 'Blue Fjord Trading',
    meta: 'closed 2 Mar 2026',
    description: 'Lost on delivery time. The client is open to a new offer in the autumn.',
    badges: [{ label: 'Lost', tone: 'error' }],
    trailing: '18,900.00 EUR',
    actions: editAndDelete,
  },
]

const longItems: RecordListItem[] = [
  {
    id: 'claim-1',
    title: 'Replacement of a damaged conveyor belt segment delivered with the second shipment of the spring order',
    icon: 'shield-check',
    badge: { label: 'In review', tone: 'info' },
    subtitle: 'Reported by the receiving team at the northern distribution centre',
    meta: 'due 18 Mar 2026',
    trailing: '12,480.00 EUR',
    actions: editAndDelete,
  },
  {
    id: 'claim-2',
    title: 'Missing mounting kit',
    icon: 'package-search',
    badge: { label: 'Resolved', tone: 'success' },
    subtitle: 'Riverside Depot',
    meta: 'due 21 Mar 2026',
    trailing: '45.00 EUR',
    actions: editAndDelete,
  },
]

export const recordListFixtures: Record<string, RecordListProps> = {
  childRecords: {
    title: 'Job history',
    count: 3,
    items: jobHistoryItems,
    addAction: { label: 'Add position' },
    onAdd: noop,
    onItemClick: noop,
    onItemAction: noop,
  },
  recentRecords: {
    title: 'Recent orders',
    items: recentOrderItems,
  },
  linkedRecords: {
    title: 'Companies',
    count: 3,
    items: linkedCompanyItems,
    addAction: { label: 'Link company', icon: 'link' },
    onAdd: noop,
    onItemAction: noop,
  },
  people: {
    title: 'People',
    count: 4,
    items: peopleItems,
    addAction: { label: 'Add person', icon: 'user-plus' },
    onAdd: noop,
    onItemAction: noop,
  },
  descriptionAndBadges: {
    title: 'Deals',
    count: 3,
    items: dealItems,
    onItemAction: noop,
  },
  cards: {
    title: 'Deals',
    layout: 'cards',
    items: dealItems,
    onItemAction: noop,
  },
  compact: {
    title: 'Recent orders',
    density: 'compact',
    items: recentOrderItems,
  },
  capped: {
    title: 'Recent orders',
    count: 28,
    items: recentOrderItems,
    maxItems: 3,
    onShowAll: noop,
  },
  plain: {
    ariaLabel: 'Job history',
    variant: 'plain',
    items: jobHistoryItems,
    onItemClick: noop,
    onItemAction: noop,
  },
  longContent: {
    title: 'Claims queue',
    items: longItems,
    onItemClick: noop,
    onItemAction: noop,
  },
  loading: {
    title: 'People',
    status: 'loading',
    skeleton: { rows: 4, leading: 'avatar' },
    items: [],
  },
  error: {
    title: 'Job history',
    status: 'error',
    errorMessage: 'Could not load job history',
    onRetry: noop,
    items: [],
  },
  empty: {
    title: 'Job history',
    items: [],
    emptyIcon: 'briefcase',
    emptyTitle: 'No positions yet',
    emptyDescription: 'Add the first position to start the job history.',
    addAction: { label: 'Add position' },
    onAdd: noop,
  },
}
