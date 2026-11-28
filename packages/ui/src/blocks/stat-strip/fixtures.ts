import type { StatItem, StatStripProps } from '../contracts/stat-strip'

const noop = () => undefined

const captionItems: StatItem[] = [
  { id: 'open-orders', label: 'Open orders', value: '128', caption: 'Awaiting fulfilment' },
  { id: 'revenue', label: 'Revenue', value: '48\u00a0200.00 EUR', caption: 'Last 30 days' },
  { id: 'average-order', label: 'Average order', value: '376.56 EUR', caption: 'Per paid order' },
  { id: 'returns', label: 'Returns', value: '7', caption: 'Opened this month' },
]

const deltaItems: StatItem[] = [
  {
    id: 'revenue',
    label: 'Revenue',
    value: '48\u00a0200.00 EUR',
    caption: 'vs previous 30 days',
    delta: { direction: 'up', label: '12%', sentiment: 'positive' },
  },
  {
    id: 'refunds',
    label: 'Refunds',
    value: '1\u00a0940.00 EUR',
    caption: 'vs previous 30 days',
    delta: { direction: 'up', label: '8%', sentiment: 'negative' },
  },
  {
    id: 'response-time',
    label: 'First response time',
    value: '2 h 10 min',
    caption: 'vs previous 30 days',
    delta: { direction: 'down', label: '25 min', sentiment: 'positive' },
  },
  {
    id: 'win-rate',
    label: 'Win rate',
    value: '31%',
    caption: 'vs previous quarter',
    delta: { direction: 'flat', label: '0 pts' },
  },
]

const trendItems: StatItem[] = [
  {
    id: 'revenue',
    label: 'Revenue',
    value: '48\u00a0200.00 EUR',
    caption: 'vs previous 30 days',
    delta: { direction: 'up', label: '12%', sentiment: 'positive' },
    trend: [31.2, 33.8, 32.1, 35.4, 34.9, 37.6, 36.2, 39.8, 41.5, 40.3, 44.7, 48.2],
  },
  {
    id: 'orders',
    label: 'Paid orders',
    value: '128',
    caption: 'vs previous 30 days',
    delta: { direction: 'up', label: '9', sentiment: 'positive' },
    trend: [96, 104, 99, 110, 108, 103, 114, 119, 112, 121, 125, 128],
  },
  {
    id: 'refund-rate',
    label: 'Refund rate',
    value: '4.1%',
    caption: 'vs previous 30 days',
    delta: { direction: 'up', label: '0.6 pts', sentiment: 'negative' },
    trend: [3.1, 3.0, 3.3, 3.2, 3.5, 3.4, 3.3, 3.7, 3.6, 3.9, 3.8, 4.1],
  },
  {
    id: 'basket',
    label: 'Average basket',
    value: '376.56 EUR',
    caption: 'vs previous 30 days',
    delta: { direction: 'flat', label: '0.2%' },
    trend: [374, 379, 371, 377, 380, 373, 376, 372, 378, 375, 379, 376.56],
  },
]

const filterItems: StatItem[] = [
  { id: 'all', label: 'All claims', value: '214', caption: 'Opened this year' },
  { id: 'open', label: 'Open', value: '38', caption: 'In progress' },
  { id: 'overdue', label: 'Overdue', value: '5', caption: 'Past the response date', tone: 'error' },
  { id: 'archived', label: 'Archived', value: '0', caption: 'Nothing archived yet', disabled: true },
  { id: 'handling-time', label: 'Average handling time', value: '3 d 4 h', caption: 'Across closed claims', interactive: false },
]

const iconItems: StatItem[] = [
  { id: 'products', label: 'Products', value: '1\u00a0284', icon: 'boxes' },
  { id: 'in-stock', label: 'In stock', value: '1\u00a0102', icon: 'package-check', tone: 'success' },
  { id: 'in-transit', label: 'In transit', value: '46', icon: 'truck' },
  { id: 'out-of-stock', label: 'Out of stock', value: '9', icon: 'package-x', tone: 'error' },
]

const badgeItems: StatItem[] = [
  { id: 'on-hand', label: 'On hand', value: '420 pcs', caption: 'Across 3 locations', badge: { label: 'Healthy', tone: 'success' } },
  { id: 'reserved', label: 'Reserved', value: '64 pcs', caption: 'For 12 open orders', badge: { label: 'Rising', tone: 'info' } },
  { id: 'expiring', label: 'Expiring soon', value: '18 pcs', caption: 'Within 14 days', badge: { label: 'Check', tone: 'info' } },
]

const actionItems: StatItem[] = [
  {
    id: 'on-hand',
    label: 'On hand',
    value: '420 pcs',
    caption: 'Across 3 locations',
    action: { label: 'View stock', href: '/backend/inventory/stock' },
  },
  {
    id: 'reserved',
    label: 'Reserved',
    value: '64 pcs',
    caption: 'For 12 open orders',
    action: { label: 'View orders', href: '/backend/sales/orders' },
  },
  {
    id: 'incoming',
    label: 'Incoming',
    value: '150 pcs',
    caption: 'Expected in 6 days',
    action: { label: 'View deliveries', href: '/backend/inventory/deliveries' },
  },
  { id: 'reorder-point', label: 'Reorder point', value: '80 pcs', caption: 'Set for this product' },
]

const sixItems: StatItem[] = [
  { id: 'runs', label: 'Runs', value: '1\u00a0204' },
  { id: 'succeeded', label: 'Succeeded', value: '1\u00a0150' },
  { id: 'failed', label: 'Failed', value: '31', tone: 'error' },
  { id: 'waiting', label: 'Waiting', value: '23' },
  { id: 'average-time', label: 'Average time', value: '42 s' },
  { id: 'cost', label: 'Cost', value: '86.40 EUR' },
]

const longItems: StatItem[] = [
  {
    id: 'pipeline',
    label: 'Weighted pipeline value across all regions and teams',
    value: '12 480 250.75 EUR',
    caption: 'Converted at the rates from the first day of the month',
    delta: { direction: 'up', label: '1\u00a0204\u00a0300.00 EUR', sentiment: 'positive' },
    trend: [9.8, 10.1, 10.4, 10.2, 10.9, 11.3, 11.1, 11.8, 12.1, 12.5],
  },
  {
    id: 'longest-open',
    label: 'Longest open negotiation',
    value: 'Northfield Distribution Partners',
    caption: 'Open for 184 days',
    badge: { label: 'Needs attention', tone: 'info' },
  },
  { id: 'deals', label: 'Active deals', value: '87', action: { label: 'Open the pipeline board' } },
]

export const statStripFixtures: Record<string, StatStripProps> = {
  captions: { items: captionItems, ariaLabel: 'Sales summary' },
  deltas: { items: deltaItems, ariaLabel: 'Performance compared with the previous period' },
  trends: { items: trendItems, ariaLabel: 'Sales over the last 30 days' },
  filters: { items: filterItems, selectedId: 'open', onItemClick: noop, ariaLabel: 'Claims by state' },
  links: {
    items: captionItems.map((item) => ({ ...item, href: `/backend/reports/${item.id}` })),
    ariaLabel: 'Sales reports',
  },
  actions: { items: actionItems, onItemAction: noop, ariaLabel: 'Stock for this product' },
  icons: { items: iconItems, ariaLabel: 'Catalog overview' },
  badges: { items: badgeItems, ariaLabel: 'Stock for this product' },
  plain: { items: trendItems, variant: 'plain', ariaLabel: 'Sales over the last 30 days' },
  compact: { items: deltaItems, size: 'compact', ariaLabel: 'Performance compared with the previous period' },
  six: { items: sixItems, ariaLabel: 'Automation runs' },
  long: { items: longItems, onItemAction: noop, ariaLabel: 'Pipeline summary' },
  loading: { items: [], status: 'loading', skeletonCount: 4 },
  error: { items: [], status: 'error', errorMessage: 'Could not load the sales figures', onRetry: noop },
  empty: { items: [], status: 'empty' },
}
