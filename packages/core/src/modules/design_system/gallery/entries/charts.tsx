import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MarketingWidgetDemo } from '../demos/marketing-widgets'
import { marketingWidgetExampleCode } from '../demos/marketing-widgets-code.generated'
import * as React from 'react'
import {
  BarChart,
  DeltaBadge,
  KpiCard,
  LineChart,
  PieChart,
  Sparkline,
  TopNTable,
  type TopNTableColumn,
} from '@open-mercato/ui/backend/charts'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// ---------------------------------------------------------------------------
// Inline mock datasets — realistic dashboard shapes, no API calls. All charts
// pick up the DS palette (`--chart-1`…`--chart-5`) natively; no color props.
// ---------------------------------------------------------------------------
function KpiCardEntryDeltaBadgePreview() {
  const t = useT()
  return (
    <div className="flex items-center gap-3">
      <DeltaBadge direction="up" value={12.4} />
      <DeltaBadge direction="down" value={4.7} />
      <DeltaBadge direction="unchanged" value={0} />
      <DeltaBadge direction="up" value={38} unit={t('design_system.gallery.samples.content.pts')} />
    </div>
  )
}
function SparklineEntryDefaultPreview() {
  const t = useT()
  return (
    <span className="text-muted-foreground">
      <Sparkline values={weeklyOrdersTrend} ariaLabel={t('design_system.gallery.samples.content.weeklyOrdersTrend')} />
    </span>
  )
}
function SparklineEntrySemanticColorPreview() {
  const t = useT()
  return (
    <div className="flex items-center gap-6">
      <span className="text-primary">
        <Sparkline values={weeklyOrdersTrend} ariaLabel={t('design_system.gallery.samples.content.ordersTrendingUp')} />
      </span>
      <span className="text-destructive">
        <Sparkline
          values={[...weeklyOrdersTrend].reverse()}
          ariaLabel={t('design_system.gallery.samples.content.returnsTrendingDown')}
        />
      </span>
    </div>
  )
}
function SparklineEntrySizesPreview() {
  const t = useT()
  return (
    <div className="flex items-end gap-6 text-muted-foreground">
      <Sparkline
        values={weeklyOrdersTrend}
        ariaLabel={t('design_system.gallery.samples.content.smallTrend')}
        width={64}
        height={20}
      />
      <Sparkline values={weeklyOrdersTrend} ariaLabel={t('design_system.gallery.samples.content.defaultTrend')} />
      <Sparkline
        values={weeklyOrdersTrend}
        ariaLabel={t('design_system.gallery.samples.content.largeTrend')}
        width={160}
        height={40}
      />
    </div>
  )
}
function KpiCardEntryTrendDirectionsPreview() {
  const t = useT()
  return (
    <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard
        title={t('design_system.gallery.samples.content.revenue')}
        value={67300}
        prefix="€"
        trend={{
          value: 14.8,
          direction: 'up',
        }}
        comparisonLabel={t('design_system.gallery.samples.content.vsPreviousMonth')}
      />
      <KpiCard
        title={t('design_system.gallery.samples.content.cancelledOrders')}
        value={22}
        trend={{
          value: 6.1,
          direction: 'down',
        }}
        comparisonLabel={t('design_system.gallery.samples.content.vsPreviousMonth')}
      />
      <KpiCard
        title={t('design_system.gallery.samples.content.activeCustomers')}
        value={1284}
        trend={{
          value: 0,
          direction: 'unchanged',
        }}
        comparisonLabel={t('design_system.gallery.samples.content.vsPreviousMonth')}
      />
    </div>
  )
}
function KpiCardEntrySuffixAndFooterPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xs">
      <KpiCard
        title={t('design_system.gallery.samples.content.averageOrderValue')}
        value={86.4}
        prefix="€"
        suffix={t('design_system.gallery.samples.content.net')}
        trend={{
          value: 3.2,
          direction: 'up',
        }}
        footer={
          <span className="text-muted-foreground">
            <Sparkline
              values={weeklyOrdersTrend}
              ariaLabel={t('design_system.gallery.samples.content.weeklyOrdersTrend')}
            />
          </span>
        }
      />
    </div>
  )
}
function KpiCardEntryStatesPreview() {
  const t = useT()
  return (
    <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard title={t('design_system.gallery.samples.content.loading')} value={null} loading />
      <KpiCard
        title={t('design_system.gallery.samples.content.error')}
        value={null}
        error={t('design_system.gallery.samples.content.failedToLoadMetric')}
      />
      <KpiCard title={t('design_system.gallery.samples.content.noData')} value={null} />
    </div>
  )
}
function BarChartEntryBasicPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <BarChart
        title={t('design_system.gallery.samples.content.revenueByMonth')}
        data={revenueByMonth(t)}
        index="month"
        categories={['revenue']}
        showLegend={false}
      />
    </div>
  )
}
function BarChartEntryHorizontalPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <BarChart
        title={t('design_system.gallery.samples.content.revenueByChannel')}
        data={revenueByChannel(t)}
        index="channel"
        categories={['revenue']}
        layout="horizontal"
        showLegend={false}
      />
    </div>
  )
}
function BarChartEntryMultiSeriesPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <BarChart
        title={t('design_system.gallery.samples.content.ordersByMonth')}
        data={ordersByMonth(t)}
        index="month"
        categories={['online', 'retail']}
        categoryLabels={{
          online: t('design_system.gallery.samples.content.online'),
          retail: t('design_system.gallery.samples.content.retail'),
        }}
      />
    </div>
  )
}
function LineChartEntryBasicPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <LineChart
        title={t('design_system.gallery.samples.content.revenueByMonth')}
        data={revenueByMonth(t)}
        index="month"
        categories={['revenue']}
        showLegend={false}
      />
    </div>
  )
}
function LineChartEntryAreaPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <LineChart
        title={t('design_system.gallery.samples.content.revenueByMonth')}
        data={revenueByMonth(t)}
        index="month"
        categories={['revenue']}
        showArea
        showLegend={false}
      />
    </div>
  )
}
function LineChartEntryMultiSeriesPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <LineChart
        title={t('design_system.gallery.samples.content.ordersByMonth')}
        data={ordersByMonth(t)}
        index="month"
        categories={['online', 'retail']}
        categoryLabels={{
          online: t('design_system.gallery.samples.content.online'),
          retail: t('design_system.gallery.samples.content.retail'),
        }}
        curveType="monotone"
      />
    </div>
  )
}
function PieChartEntryPiePreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <PieChart title={t('design_system.gallery.samples.content.ordersByStatus')} data={ordersByStatus(t)} />
    </div>
  )
}
function PieChartEntryDonutPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <PieChart
        title={t('design_system.gallery.samples.content.ordersByStatus')}
        data={ordersByStatus(t)}
        variant="donut"
      />
    </div>
  )
}
function TopNTableEntryBasicPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <TopNTable
        title={t('design_system.gallery.samples.content.topProducts')}
        data={topProducts(t)}
        columns={topProductColumns(t)}
      />
    </div>
  )
}
function TopNTableEntryMaxRowsPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <TopNTable
        title={t('design_system.gallery.samples.content.top3Products')}
        data={topProducts(t)}
        columns={topProductColumns(t)}
        maxRows={3}
      />
    </div>
  )
}
function TopNTableEntryEmptyPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-xl">
      <TopNTable
        title={t('design_system.gallery.samples.content.topProducts')}
        data={[]}
        columns={topProductColumns(t)}
        emptyMessage={t('design_system.gallery.samples.content.noSalesInThisPeriod')}
      />
    </div>
  )
}
const revenueByMonth = (t: ReturnType<typeof useT>) => [
  {
    month: t('design_system.gallery.samples.content.jan'),
    revenue: 48200,
  },
  {
    month: t('design_system.gallery.samples.content.feb'),
    revenue: 51400,
  },
  {
    month: t('design_system.gallery.samples.content.mar'),
    revenue: 47900,
  },
  {
    month: t('design_system.gallery.samples.content.apr'),
    revenue: 61200,
  },
  {
    month: t('design_system.gallery.samples.content.may'),
    revenue: 58600,
  },
  {
    month: t('design_system.gallery.samples.content.jun'),
    revenue: 67300,
  },
]
const revenueByChannel = (t: ReturnType<typeof useT>) => [
  {
    channel: t('design_system.gallery.samples.content.onlineStore'),
    revenue: 182400,
  },
  {
    channel: t('design_system.gallery.samples.content.marketplace'),
    revenue: 96800,
  },
  {
    channel: t('design_system.gallery.samples.content.retail'),
    revenue: 64200,
  },
  {
    channel: t('design_system.gallery.samples.content.wholesale'),
    revenue: 41500,
  },
]
const ordersByMonth = (t: ReturnType<typeof useT>) => [
  {
    month: t('design_system.gallery.samples.content.jan'),
    online: 320,
    retail: 180,
  },
  {
    month: t('design_system.gallery.samples.content.feb'),
    online: 348,
    retail: 164,
  },
  {
    month: t('design_system.gallery.samples.content.mar'),
    online: 331,
    retail: 196,
  },
  {
    month: t('design_system.gallery.samples.content.apr'),
    online: 402,
    retail: 214,
  },
  {
    month: t('design_system.gallery.samples.content.may'),
    online: 389,
    retail: 205,
  },
  {
    month: t('design_system.gallery.samples.content.jun'),
    online: 446,
    retail: 232,
  },
]
const ordersByStatus = (t: ReturnType<typeof useT>) => [
  {
    name: t('design_system.gallery.samples.content.completed'),
    value: 268,
  },
  {
    name: t('design_system.gallery.samples.content.processing'),
    value: 84,
  },
  {
    name: t('design_system.gallery.samples.content.pendingPayment'),
    value: 37,
  },
  {
    name: t('design_system.gallery.samples.content.cancelled'),
    value: 22,
  },
]
const weeklyOrdersTrend = [12, 18, 14, 22, 19, 27, 24, 31, 28, 35, 33, 41]
type TopProductRow = {
  product: string
  orders: number
  revenue: number
  [key: string]: unknown
}
const topProducts = (t: ReturnType<typeof useT>): TopProductRow[] => [
  {
    product: t('design_system.gallery.samples.content.auroraDeskLamp'),
    orders: 412,
    revenue: 28840,
  },
  {
    product: t('design_system.gallery.samples.content.birchSideTable'),
    orders: 366,
    revenue: 47580,
  },
  {
    product: t('design_system.gallery.samples.content.linenThrowPillow'),
    orders: 341,
    revenue: 11935,
  },
  {
    product: t('design_system.gallery.samples.content.oakBookshelf'),
    orders: 214,
    revenue: 53500,
  },
  {
    product: t('design_system.gallery.samples.content.ceramicVaseSet'),
    orders: 198,
    revenue: 8910,
  },
]
const formatCurrency = (value: number) => `€${value.toLocaleString('en-US')}`
const topProductColumns = (t: ReturnType<typeof useT>): TopNTableColumn<TopProductRow>[] => [
  {
    key: 'product',
    header: t('design_system.gallery.samples.content.product'),
  },
  {
    key: 'orders',
    header: t('design_system.gallery.samples.content.orders'),
    align: 'right',
  },
  {
    key: 'revenue',
    header: t('design_system.gallery.samples.content.revenue'),
    align: 'right',
    formatter: (value) => formatCurrency(value as number),
  },
]
const kpiCardEntry: GalleryEntry = {
  id: 'kpi-card',
  title: 'KpiCard',
  importPath: '@open-mercato/ui/backend/charts',
  variants: [
    {
      id: 'trend-directions',
      title: 'Trend directions',
      render: () => <KpiCardEntryTrendDirectionsPreview />,
      code: `import { KpiCard } from '@open-mercato/ui/backend/charts'

<KpiCard
  title="Revenue"
  value={67300}
  prefix="€"
  trend={{ value: 14.8, direction: 'up' }}
  comparisonLabel="vs. previous month"
/>`,
    },
    {
      id: 'suffix-and-footer',
      title: 'Suffix and footer slot',
      render: () => <KpiCardEntrySuffixAndFooterPreview />,
      code: `import { KpiCard, Sparkline } from '@open-mercato/ui/backend/charts'

<KpiCard
  title="Average order value"
  value={86.4}
  prefix="€"
  suffix="net"
  trend={{ value: 3.2, direction: 'up' }}
  footer={<Sparkline values={weeklyTrend} ariaLabel="Weekly orders trend" />}
/>`,
    },
    {
      id: 'states',
      title: 'Loading, error and empty states',
      render: () => <KpiCardEntryStatesPreview />,
      code: `import { KpiCard } from '@open-mercato/ui/backend/charts'

<KpiCard title="Loading" value={null} loading />
<KpiCard title="Error" value={null} error="Failed to load metric" />
<KpiCard title="No data" value={null} />`,
    },
    {
      id: 'delta-badge',
      title: 'DeltaBadge (standalone)',
      render: () => <KpiCardEntryDeltaBadgePreview />,
      code: `import { DeltaBadge } from '@open-mercato/ui/backend/charts'

<DeltaBadge direction="up" value={12.4} />
<DeltaBadge direction="down" value={4.7} />
<DeltaBadge direction="unchanged" value={0} />
<DeltaBadge direction="up" value={38} unit=" pts" />`,
    },
  ],
}
const sparklineEntry: GalleryEntry = {
  id: 'sparkline',
  title: 'Sparkline',
  importPath: '@open-mercato/ui/backend/charts',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <SparklineEntryDefaultPreview />,
      code: `import { Sparkline } from '@open-mercato/ui/backend/charts'

<Sparkline values={[12, 18, 14, 22, 19, 27, 24, 31]} ariaLabel="Weekly orders trend" />`,
    },
    {
      id: 'semantic-color',
      title: 'Colored via currentColor',
      render: () => <SparklineEntrySemanticColorPreview />,
      code: `import { Sparkline } from '@open-mercato/ui/backend/charts'

// Sparkline strokes with currentColor — set a semantic text token on the wrapper.
<span className="text-primary">
  <Sparkline values={values} ariaLabel="Orders trending up" />
</span>`,
    },
    {
      id: 'sizes',
      title: 'Custom width and height',
      render: () => <SparklineEntrySizesPreview />,
      code: `import { Sparkline } from '@open-mercato/ui/backend/charts'

<Sparkline values={values} ariaLabel="Small trend" width={64} height={20} />
<Sparkline values={values} ariaLabel="Default trend" />
<Sparkline values={values} ariaLabel="Large trend" width={160} height={40} />`,
    },
  ],
}
const barChartEntry: GalleryEntry = {
  id: 'bar-chart',
  title: 'BarChart',
  importPath: '@open-mercato/ui/backend/charts',
  variants: [
    {
      id: 'basic',
      title: 'Basic (revenue by month)',
      render: () => <BarChartEntryBasicPreview />,
      code: `import { BarChart } from '@open-mercato/ui/backend/charts'

<BarChart
  title="Revenue by month"
  data={revenueByMonth}
  index="month"
  categories={['revenue']}
  showLegend={false}
/>`,
    },
    {
      id: 'horizontal',
      title: 'Horizontal layout',
      render: () => <BarChartEntryHorizontalPreview />,
      code: `import { BarChart } from '@open-mercato/ui/backend/charts'

<BarChart
  title="Revenue by channel"
  data={revenueByChannel}
  index="channel"
  categories={['revenue']}
  layout="horizontal"
  showLegend={false}
/>`,
    },
    {
      id: 'multi-series',
      title: 'Multiple series with legend',
      render: () => <BarChartEntryMultiSeriesPreview />,
      code: `import { BarChart } from '@open-mercato/ui/backend/charts'

<BarChart
  title="Orders by month"
  data={ordersByMonth}
  index="month"
  categories={['online', 'retail']}
  categoryLabels={{ online: 'Online', retail: 'Retail' }}
/>`,
    },
  ],
}
const lineChartEntry: GalleryEntry = {
  id: 'line-chart',
  title: 'LineChart',
  importPath: '@open-mercato/ui/backend/charts',
  variants: [
    {
      id: 'basic',
      title: 'Basic (revenue by month)',
      render: () => <LineChartEntryBasicPreview />,
      code: `import { LineChart } from '@open-mercato/ui/backend/charts'

<LineChart
  title="Revenue by month"
  data={revenueByMonth}
  index="month"
  categories={['revenue']}
  showLegend={false}
/>`,
    },
    {
      id: 'area',
      title: 'Area fill',
      render: () => <LineChartEntryAreaPreview />,
      code: `import { LineChart } from '@open-mercato/ui/backend/charts'

<LineChart
  title="Revenue by month"
  data={revenueByMonth}
  index="month"
  categories={['revenue']}
  showArea
  showLegend={false}
/>`,
    },
    {
      id: 'multi-series',
      title: 'Multiple series, monotone curve',
      render: () => <LineChartEntryMultiSeriesPreview />,
      code: `import { LineChart } from '@open-mercato/ui/backend/charts'

<LineChart
  title="Orders by month"
  data={ordersByMonth}
  index="month"
  categories={['online', 'retail']}
  categoryLabels={{ online: 'Online', retail: 'Retail' }}
  curveType="monotone"
/>`,
    },
  ],
}
const pieChartEntry: GalleryEntry = {
  id: 'pie-chart',
  title: 'PieChart',
  importPath: '@open-mercato/ui/backend/charts',
  variants: [
    {
      id: 'pie',
      title: 'Pie (orders by status)',
      render: () => <PieChartEntryPiePreview />,
      code: `import { PieChart } from '@open-mercato/ui/backend/charts'

<PieChart title="Orders by status" data={ordersByStatus} />`,
    },
    {
      id: 'donut',
      title: 'Donut',
      render: () => <PieChartEntryDonutPreview />,
      code: `import { PieChart } from '@open-mercato/ui/backend/charts'

<PieChart title="Orders by status" data={ordersByStatus} variant="donut" />`,
    },
  ],
}
const topNTableEntry: GalleryEntry = {
  id: 'top-n-table',
  title: 'TopNTable',
  importPath: '@open-mercato/ui/backend/charts',
  variants: [
    {
      id: 'basic',
      title: 'Top products by revenue',
      render: () => <TopNTableEntryBasicPreview />,
      code: `import { TopNTable, type TopNTableColumn } from '@open-mercato/ui/backend/charts'

const columns: TopNTableColumn<TopProductRow>[] = [
  { key: 'product', header: 'Product' },
  { key: 'orders', header: 'Orders', align: 'right' },
  { key: 'revenue', header: 'Revenue', align: 'right', formatter: (v) => formatCurrency(v as number) },
]

<TopNTable title="Top products" data={topProducts} columns={columns} />`,
    },
    {
      id: 'max-rows',
      title: 'Capped with maxRows',
      render: () => <TopNTableEntryMaxRowsPreview />,
      code: `import { TopNTable } from '@open-mercato/ui/backend/charts'

<TopNTable title="Top 3 products" data={topProducts} columns={columns} maxRows={3} />`,
    },
    {
      id: 'empty',
      title: 'Empty state',
      render: () => <TopNTableEntryEmptyPreview />,
      code: `import { TopNTable } from '@open-mercato/ui/backend/charts'

<TopNTable title="Top products" data={[]} columns={columns} emptyMessage="No sales in this period" />`,
    },
  ],
}
const marketingWidgetsEntry: GalleryEntry = {
  id: 'marketing-widgets',
  title: 'Marketing & Sales Widgets',
  importPath: '@open-mercato/ui/primitives/card',
  figmaNodeId: '164628:1734',
  variants: [
    {
      id: 'total-sales',
      title: 'total-sales',
      render: () => <MarketingWidgetDemo kind="total-sales" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="total-sales" />'),
    },
    {
      id: 'total-visitors',
      title: 'total-visitors',
      render: () => <MarketingWidgetDemo kind="total-visitors" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="total-visitors" />'),
    },
    {
      id: 'conversion-rate',
      title: 'conversion-rate',
      render: () => <MarketingWidgetDemo kind="conversion-rate" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="conversion-rate" />'),
    },
    {
      id: 'user-retention',
      title: 'user-retention',
      render: () => <MarketingWidgetDemo kind="user-retention" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="user-retention" />'),
    },
    {
      id: 'weekly-visitors',
      title: 'weekly-visitors',
      render: () => <MarketingWidgetDemo kind="weekly-visitors" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="weekly-visitors" />'),
    },
    {
      id: 'visitor-channels',
      title: 'visitor-channels',
      render: () => <MarketingWidgetDemo kind="visitor-channels" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="visitor-channels" />'),
    },
    {
      id: 'geography',
      title: 'geography',
      render: () => <MarketingWidgetDemo kind="geography" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="geography" />'),
    },
    {
      id: 'realtime-visitors',
      title: 'realtime-visitors',
      render: () => <MarketingWidgetDemo kind="realtime-visitors" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="realtime-visitors" />'),
    },
    {
      id: 'marketing-channels',
      title: 'marketing-channels',
      render: () => <MarketingWidgetDemo kind="marketing-channels" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="marketing-channels" />'),
    },
    {
      id: 'product-performance',
      title: 'product-performance',
      render: () => <MarketingWidgetDemo kind="product-performance" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="product-performance" />'),
    },
    {
      id: 'shipping-tracking',
      title: 'shipping-tracking',
      render: () => <MarketingWidgetDemo kind="shipping-tracking" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="shipping-tracking" />'),
    },
    {
      id: 'my-products',
      title: 'my-products',
      render: () => <MarketingWidgetDemo kind="my-products" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="my-products" />'),
    },
    {
      id: 'product-categories',
      title: 'product-categories',
      render: () => <MarketingWidgetDemo kind="product-categories" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="product-categories" />'),
    },
    {
      id: 'customer-segments',
      title: 'customer-segments',
      render: () => <MarketingWidgetDemo kind="customer-segments" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="customer-segments" />'),
    },
    {
      id: 'sales-channels',
      title: 'sales-channels',
      render: () => <MarketingWidgetDemo kind="sales-channels" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="sales-channels" />'),
    },
    {
      id: 'campaign-data',
      title: 'campaign-data',
      render: () => <MarketingWidgetDemo kind="campaign-data" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="campaign-data" />'),
    },
    {
      id: 'support-analytics',
      title: 'support-analytics',
      render: () => <MarketingWidgetDemo kind="support-analytics" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="support-analytics" />'),
    },
    {
      id: 'recent-activities',
      title: 'recent-activities',
      render: () => <MarketingWidgetDemo kind="recent-activities" />,
      code: marketingWidgetExampleCode('<MarketingWidgetDemo kind="recent-activities" />'),
    },
  ],
}
export const entries: GalleryEntry[] = [
  marketingWidgetsEntry,
  kpiCardEntry,
  sparklineEntry,
  barChartEntry,
  lineChartEntry,
  pieChartEntry,
  topNTableEntry,
]
