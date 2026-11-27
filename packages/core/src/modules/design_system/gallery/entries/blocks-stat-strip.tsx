import * as React from 'react'
import { StatStrip } from '@open-mercato/ui/blocks/stat-strip'
import { statStripFixtures } from '@open-mercato/ui/blocks/stat-strip/fixtures'
import { statStripPropsSchema } from '@open-mercato/ui/blocks/contracts/stat-strip'
import type { GalleryEntry } from '../types'

function FilterExample() {
  const [selectedId, setSelectedId] = React.useState('open')
  return <StatStrip {...statStripFixtures.filters} selectedId={selectedId} onItemClick={setSelectedId} />
}

function RetryExample() {
  const [attempts, setAttempts] = React.useState(0)
  return (
    <StatStrip
      {...statStripFixtures.error}
      errorMessage={attempts === 0 ? 'Could not load the sales figures' : `Could not load the sales figures (${attempts + 1} attempts)`}
      onRetry={() => setAttempts((current) => current + 1)}
    />
  )
}

const statStripCode = (props: string) => `import { StatStrip } from '@open-mercato/ui/blocks/stat-strip'

<StatStrip
${props}
/>`

export const statStripEntry: GalleryEntry = {
  id: 'stat-strip',
  title: 'StatStrip',
  importPath: '@open-mercato/ui/blocks/stat-strip',
  contract: {
    schema: statStripPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/stat-strip',
    implementationPath: '@open-mercato/ui/blocks/stat-strip/StatStrip',
  },
  descriptionKey: 'design_system.entries.stat-strip.description',
  keywords: ['kpi', 'metrics', 'figures', 'summary', 'stats', 'totals', 'counters', 'filter tiles', 'trend', 'sparkline'],
  usage: {
    do: [
      'Use one strip above a list or at the top of a detail screen for three to six figures that summarise it',
      'Format numbers, money and durations in the host and pass the finished string as value; keep digit groups together with a non-breaking space',
      'Set sentiment on a change indicator: a rise in refunds is negative, a drop in response time is positive',
      'Pass trend with the same period the change indicator compares, oldest point first',
      'Pass onItemClick and selectedId when the tiles filter the list below; a second click on the selected tile should clear the filter in the host',
      'Set interactive to false on a tile that only informs, so a strip can mix filter tiles with plain figures',
      'Use action for one follow-up step that belongs to a single figure, such as opening the stock list',
      'Use variant="plain" when the strip already sits inside a card, dialog or drawer',
      'Pass skeletonCount equal to the number of tiles the screen will show so loading does not shift the layout',
      'Say in the caption why a disabled tile cannot be used',
    ],
    dont: [
      'Do not wrap the card variant in another bordered container or put a border on single tiles',
      'Do not repeat a figure that the list header or the page title already shows',
      'Do not use trend for a chart people need to read values from; link the tile to the report instead',
      'Do not show a trend without a change indicator: the line is hidden from assistive technology and from narrow tiles',
      'Do not show more than one row of figures on a list page; pick the ones people act on',
      'Do not use tone for decoration; reserve it for a figure that needs attention',
    ],
  },
  accessibility: [
    'The strip is a labelled group with a list inside, so screen readers announce how many figures it holds',
    'A change indicator is an arrow plus text on a tinted chip and carries a spoken phrase such as "up 12%"; colour only adds the meaning',
    'A trend line is decoration and hidden from assistive technology; the change indicator carries its meaning',
    'A tile with href is a link and marks the current one with aria-current; a tile with onItemClick is a button with aria-pressed',
    'Clickable tiles are reached with Tab, activated with Enter or Space and show the focus ring inside the tile, so the frame never cuts it off',
    'The selected tile is marked by a fill, an accent bar and a darker label, not by colour alone',
    'A tile with an action stays plain content; only the action link is in the tab order',
    'A disabled tile is skipped by the keyboard and announced as unavailable',
    'A tone is shown as a dot or a tinted icon next to the label; the label and caption must say what needs attention',
    'While loading the strip is marked busy and announces Loading once; skeleton tiles are hidden from assistive technology',
  ],
  faq: [
    {
      question: 'Why does a plain click on a link tile not navigate?',
      answer:
        'When a tile has both href and onItemClick, a plain click is handed to onItemClick so the host can navigate with its router. Clicks with a modifier key still open the href.',
    },
    {
      question: 'Why is the trend line missing on a narrow tile?',
      answer:
        'The line is drawn only when it fits next to the figure. On a narrow tile or beside a long value it is left out, and the change indicator still tells the direction.',
    },
    {
      question: 'Why is a tile with an action not clickable as a whole?',
      answer:
        'A link inside a link cannot be reached with the keyboard. When a tile has an action, the action is the only control and the tile stays plain content.',
    },
    {
      question: 'Why do the tiles stay in two columns on a wide screen?',
      answer:
        'Columns follow the width of the strip, not of the window. A tile is never narrower than about 190 px, so four tiles need a strip of 770 px and six need 1150 px. Give the strip the full width of its section or lower the columns value.',
    },
  ],
  tokens: [
    '--card',
    '--border',
    '--radius-card',
    '--muted',
    '--muted-foreground',
    '--accent-indigo',
    '--shadow-focus',
    '--status-success-bg',
    '--status-success-text',
    '--status-success-icon',
    '--status-error-bg',
    '--status-error-text',
    '--status-error-icon',
    '--status-info-icon',
  ],
  variants: [
    {
      id: 'captions',
      title: 'Figures with captions',
      description: 'Four figures in one frame with hairline dividers. The figure is the anchor; the label above and the caption below stay quiet.',
      render: () => <StatStrip {...statStripFixtures.captions} />,
      code: statStripCode(`  ariaLabel="Sales summary"
  items={[
    { id: 'open-orders', label: 'Open orders', value: '128', caption: 'Awaiting fulfilment' },
    { id: 'revenue', label: 'Revenue', value: formatMoney(revenue), caption: 'Last 30 days' },
    { id: 'average-order', label: 'Average order', value: formatMoney(average), caption: 'Per paid order' },
    { id: 'returns', label: 'Returns', value: '7', caption: 'Opened this month' },
  ]}`),
    },
    {
      id: 'deltas',
      title: 'Change indicators',
      description: 'A tinted chip with an arrow and the change, then what it is compared with. Direction and meaning are separate: a rise can be good or bad, a drop can be good, and no change stays neutral.',
      render: () => <StatStrip {...statStripFixtures.deltas} />,
      code: statStripCode(`  items={[
    { id: 'revenue', label: 'Revenue', value: '48 200.00 EUR', caption: 'vs previous 30 days',
      delta: { direction: 'up', label: '12%', sentiment: 'positive' } },
    { id: 'refunds', label: 'Refunds', value: '1 940.00 EUR', caption: 'vs previous 30 days',
      delta: { direction: 'up', label: '8%', sentiment: 'negative' } },
    { id: 'response-time', label: 'First response time', value: '2 h 10 min', caption: 'vs previous 30 days',
      delta: { direction: 'down', label: '25 min', sentiment: 'positive' } },
    { id: 'win-rate', label: 'Win rate', value: '31%', caption: 'vs previous quarter',
      delta: { direction: 'flat', label: '0 pts' } },
  ]}`),
    },
    {
      id: 'trends',
      title: 'With trend lines',
      description: 'A small line at the right edge shows how the figure moved over the period. It takes the colour of the change indicator and is left out when the tile is too narrow.',
      render: () => <StatStrip {...statStripFixtures.trends} />,
      code: statStripCode(`  ariaLabel="Sales over the last 30 days"
  items={[
    { id: 'revenue', label: 'Revenue', value: '48 200.00 EUR', caption: 'vs previous 30 days',
      delta: { direction: 'up', label: '12%', sentiment: 'positive' },
      trend: [31.2, 33.8, 32.1, 35.4, 34.9, 37.6, 36.2, 39.8, 41.5, 40.3, 44.7, 48.2] },
    { id: 'refund-rate', label: 'Refund rate', value: '4.1%', caption: 'vs previous 30 days',
      delta: { direction: 'up', label: '0.6 pts', sentiment: 'negative' },
      trend: refundRateByWeek },
  ]}`),
    },
    {
      id: 'filters',
      title: 'Clickable tiles',
      description: 'Tiles act as filters for the list below. One is selected, one is disabled and the last one is a plain figure that cannot be clicked. Hover or focus a tile to see the cue.',
      render: () => <FilterExample />,
      code: statStripCode(`  ariaLabel="Claims by state"
  selectedId={filter}
  onItemClick={setFilter}
  items={[
    { id: 'all', label: 'All claims', value: '214', caption: 'Opened this year' },
    { id: 'open', label: 'Open', value: '38', caption: 'In progress' },
    { id: 'overdue', label: 'Overdue', value: '5', caption: 'Past the response date', tone: 'error' },
    { id: 'archived', label: 'Archived', value: '0', caption: 'Nothing archived yet', disabled: true },
    { id: 'handling-time', label: 'Average handling time', value: '3 d 4 h', caption: 'Across closed claims', interactive: false },
  ]}`),
    },
    {
      id: 'actions',
      title: 'With a tile action',
      description: 'A quiet link at the bottom of a tile opens the place where the figure comes from. A tile with an action is not clickable as a whole.',
      render: () => <StatStrip {...statStripFixtures.actions} />,
      code: statStripCode(`  ariaLabel="Stock for this product"
  onItemAction={(itemId) => router.push(stockLinks[itemId])}
  items={[
    { id: 'on-hand', label: 'On hand', value: '420 pcs', caption: 'Across 3 locations',
      action: { label: 'View stock', href: '/backend/inventory/stock' } },
    { id: 'reserved', label: 'Reserved', value: '64 pcs', caption: 'For 12 open orders',
      action: { label: 'View orders', href: '/backend/sales/orders' } },
    { id: 'incoming', label: 'Incoming', value: '150 pcs', caption: 'Expected in 6 days',
      action: { label: 'View deliveries', href: '/backend/inventory/deliveries' } },
    { id: 'reorder-point', label: 'Reorder point', value: '80 pcs', caption: 'Set for this product' },
  ]}`),
    },
    {
      id: 'icons',
      title: 'With icons',
      description: 'An icon sits before the label. A tone tints the icon and never the figure.',
      render: () => <StatStrip {...statStripFixtures.icons} />,
      code: statStripCode(`  items={[
    { id: 'products', label: 'Products', value: '1 284', icon: 'boxes' },
    { id: 'in-stock', label: 'In stock', value: '1 102', icon: 'package-check', tone: 'success' },
    { id: 'in-transit', label: 'In transit', value: '46', icon: 'truck' },
    { id: 'out-of-stock', label: 'Out of stock', value: '9', icon: 'package-x', tone: 'error' },
  ]}`),
    },
    {
      id: 'badges',
      title: 'With badges',
      description: 'A small badge next to the value names the state of the figure.',
      render: () => <StatStrip {...statStripFixtures.badges} />,
      code: statStripCode(`  items={[
    { id: 'on-hand', label: 'On hand', value: '420 pcs', caption: 'Across 3 locations', badge: { label: 'Healthy', tone: 'success' } },
    { id: 'reserved', label: 'Reserved', value: '64 pcs', caption: 'For 12 open orders', badge: { label: 'Rising', tone: 'info' } },
    { id: 'expiring', label: 'Expiring soon', value: '18 pcs', caption: 'Within 14 days', badge: { label: 'Check', tone: 'info' } },
  ]}`),
    },
    {
      id: 'plain',
      title: 'Plain variant',
      description: 'No frame and no dividers, for a strip that already sits inside a card, dialog or drawer. Trend lines and change chips work the same.',
      render: () => <StatStrip {...statStripFixtures.plain} />,
      code: statStripCode(`  variant="plain"
  items={items}`),
    },
    {
      id: 'compact',
      title: 'Compact size',
      description: 'Smaller values and tighter padding for dense screens and side panels.',
      render: () => <StatStrip {...statStripFixtures.compact} />,
      code: statStripCode(`  size="compact"
  items={items}`),
    },
    {
      id: 'six',
      title: 'Six tiles, automatic columns',
      description: 'Columns follow the width of the strip: six in a row when there is room, then three, then two. A tone without an icon shows as a dot before the label.',
      render: () => <StatStrip {...statStripFixtures.six} />,
      code: statStripCode(`  columns="auto"
  items={sixItems}`),
    },
    {
      id: 'long',
      title: 'Long labels and values',
      description: 'Labels, values and captions wrap inside their tile between words; nothing is cut off and the trend line gives way to a long figure.',
      render: () => <StatStrip {...statStripFixtures.long} />,
      code: statStripCode(`  onItemAction={openBoard}
  items={[
    { id: 'pipeline', label: 'Weighted pipeline value across all regions and teams', value: '12 480 250.75 EUR',
      caption: 'Converted at the rates from the first day of the month',
      delta: { direction: 'up', label: '1 204 300.00 EUR', sentiment: 'positive' }, trend: pipelineByMonth },
    { id: 'longest-open', label: 'Longest open negotiation', value: 'Northfield Distribution Partners',
      caption: 'Open for 184 days', badge: { label: 'Needs attention', tone: 'info' } },
    { id: 'deals', label: 'Active deals', value: '87', action: { label: 'Open the pipeline board' } },
  ]}`),
    },
    {
      id: 'narrow',
      title: 'Narrow container',
      description: 'In a narrow container the tiles wrap into two columns, an odd last tile takes the full row and trend lines are left out where they do not fit.',
      render: () => (
        <div className="flex w-full max-w-sm flex-col gap-6">
          <StatStrip {...statStripFixtures.trends} />
          <StatStrip {...statStripFixtures.badges} />
        </div>
      ),
      code: `import { StatStrip } from '@open-mercato/ui/blocks/stat-strip'

<aside className="max-w-sm">
  <StatStrip items={items} />
</aside>`,
    },
    {
      id: 'loading',
      title: 'Loading',
      description: 'Skeleton tiles mirror the label, the figure and the supporting line. skeletonCount sets how many are drawn.',
      render: () => <StatStrip {...statStripFixtures.loading} />,
      code: statStripCode(`  status="loading"
  skeletonCount={4}
  items={[]}`),
    },
    {
      id: 'error',
      title: 'Error with retry',
      render: () => <RetryExample />,
      code: statStripCode(`  status="error"
  errorMessage="Could not load the sales figures"
  onRetry={reload}
  items={[]}`),
    },
    {
      id: 'empty',
      title: 'Empty',
      render: () => <StatStrip {...statStripFixtures.empty} />,
      code: statStripCode(`  status="empty"
  items={[]}`),
    },
  ],
}
