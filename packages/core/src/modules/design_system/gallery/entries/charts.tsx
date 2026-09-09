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

const revenueByMonth = [
  { month: 'Jan', revenue: 48200 },
  { month: 'Feb', revenue: 51400 },
  { month: 'Mar', revenue: 47900 },
  { month: 'Apr', revenue: 61200 },
  { month: 'May', revenue: 58600 },
  { month: 'Jun', revenue: 67300 },
]

const revenueByChannel = [
  { channel: 'Online store', revenue: 182400 },
  { channel: 'Marketplace', revenue: 96800 },
  { channel: 'Retail', revenue: 64200 },
  { channel: 'Wholesale', revenue: 41500 },
]

const ordersByMonth = [
  { month: 'Jan', online: 320, retail: 180 },
  { month: 'Feb', online: 348, retail: 164 },
  { month: 'Mar', online: 331, retail: 196 },
  { month: 'Apr', online: 402, retail: 214 },
  { month: 'May', online: 389, retail: 205 },
  { month: 'Jun', online: 446, retail: 232 },
]

const ordersByStatus = [
  { name: 'Completed', value: 268 },
  { name: 'Processing', value: 84 },
  { name: 'Pending payment', value: 37 },
  { name: 'Cancelled', value: 22 },
]

const weeklyOrdersTrend = [12, 18, 14, 22, 19, 27, 24, 31, 28, 35, 33, 41]

type TopProductRow = {
  product: string
  orders: number
  revenue: number
  [key: string]: unknown
}

const topProducts: TopProductRow[] = [
  { product: 'Aurora desk lamp', orders: 412, revenue: 28840 },
  { product: 'Birch side table', orders: 366, revenue: 47580 },
  { product: 'Linen throw pillow', orders: 341, revenue: 11935 },
  { product: 'Oak bookshelf', orders: 214, revenue: 53500 },
  { product: 'Ceramic vase set', orders: 198, revenue: 8910 },
]

const formatCurrency = (value: number) => `€${value.toLocaleString('en-US')}`

const topProductColumns: TopNTableColumn<TopProductRow>[] = [
  { key: 'product', header: 'Product' },
  { key: 'orders', header: 'Orders', align: 'right' },
  {
    key: 'revenue',
    header: 'Revenue',
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
      render: () => (
        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            title="Revenue"
            value={67300}
            prefix="€"
            trend={{ value: 14.8, direction: 'up' }}
            comparisonLabel="vs. previous month"
          />
          <KpiCard
            title="Cancelled orders"
            value={22}
            trend={{ value: 6.1, direction: 'down' }}
            comparisonLabel="vs. previous month"
          />
          <KpiCard
            title="Active customers"
            value={1284}
            trend={{ value: 0, direction: 'unchanged' }}
            comparisonLabel="vs. previous month"
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xs">
          <KpiCard
            title="Average order value"
            value={86.4}
            prefix="€"
            suffix="net"
            trend={{ value: 3.2, direction: 'up' }}
            footer={
              <span className="text-muted-foreground">
                <Sparkline values={weeklyOrdersTrend} ariaLabel="Weekly orders trend" />
              </span>
            }
          />
        </div>
      ),
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
      render: () => (
        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard title="Loading" value={null} loading />
          <KpiCard title="Error" value={null} error="Failed to load metric" />
          <KpiCard title="No data" value={null} />
        </div>
      ),
      code: `import { KpiCard } from '@open-mercato/ui/backend/charts'

<KpiCard title="Loading" value={null} loading />
<KpiCard title="Error" value={null} error="Failed to load metric" />
<KpiCard title="No data" value={null} />`,
    },
    {
      id: 'delta-badge',
      title: 'DeltaBadge (standalone)',
      render: () => (
        <div className="flex items-center gap-3">
          <DeltaBadge direction="up" value={12.4} />
          <DeltaBadge direction="down" value={4.7} />
          <DeltaBadge direction="unchanged" value={0} />
          <DeltaBadge direction="up" value={38} unit=" pts" />
        </div>
      ),
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
      render: () => (
        <span className="text-muted-foreground">
          <Sparkline values={weeklyOrdersTrend} ariaLabel="Weekly orders trend" />
        </span>
      ),
      code: `import { Sparkline } from '@open-mercato/ui/backend/charts'

<Sparkline values={[12, 18, 14, 22, 19, 27, 24, 31]} ariaLabel="Weekly orders trend" />`,
    },
    {
      id: 'semantic-color',
      title: 'Colored via currentColor',
      render: () => (
        <div className="flex items-center gap-6">
          <span className="text-primary">
            <Sparkline values={weeklyOrdersTrend} ariaLabel="Orders trending up" />
          </span>
          <span className="text-destructive">
            <Sparkline
              values={[...weeklyOrdersTrend].reverse()}
              ariaLabel="Returns trending down"
            />
          </span>
        </div>
      ),
      code: `import { Sparkline } from '@open-mercato/ui/backend/charts'

// Sparkline strokes with currentColor — set a semantic text token on the wrapper.
<span className="text-primary">
  <Sparkline values={values} ariaLabel="Orders trending up" />
</span>`,
    },
    {
      id: 'sizes',
      title: 'Custom width and height',
      render: () => (
        <div className="flex items-end gap-6 text-muted-foreground">
          <Sparkline values={weeklyOrdersTrend} ariaLabel="Small trend" width={64} height={20} />
          <Sparkline values={weeklyOrdersTrend} ariaLabel="Default trend" />
          <Sparkline values={weeklyOrdersTrend} ariaLabel="Large trend" width={160} height={40} />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <BarChart
            title="Revenue by month"
            data={revenueByMonth}
            index="month"
            categories={['revenue']}
            showLegend={false}
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <BarChart
            title="Revenue by channel"
            data={revenueByChannel}
            index="channel"
            categories={['revenue']}
            layout="horizontal"
            showLegend={false}
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <BarChart
            title="Orders by month"
            data={ordersByMonth}
            index="month"
            categories={['online', 'retail']}
            categoryLabels={{ online: 'Online', retail: 'Retail' }}
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <LineChart
            title="Revenue by month"
            data={revenueByMonth}
            index="month"
            categories={['revenue']}
            showLegend={false}
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <LineChart
            title="Revenue by month"
            data={revenueByMonth}
            index="month"
            categories={['revenue']}
            showArea
            showLegend={false}
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <LineChart
            title="Orders by month"
            data={ordersByMonth}
            index="month"
            categories={['online', 'retail']}
            categoryLabels={{ online: 'Online', retail: 'Retail' }}
            curveType="monotone"
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-md">
          <PieChart title="Orders by status" data={ordersByStatus} />
        </div>
      ),
      code: `import { PieChart } from '@open-mercato/ui/backend/charts'

<PieChart title="Orders by status" data={ordersByStatus} />`,
    },
    {
      id: 'donut',
      title: 'Donut',
      render: () => (
        <div className="w-full max-w-md">
          <PieChart title="Orders by status" data={ordersByStatus} variant="donut" />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <TopNTable title="Top products" data={topProducts} columns={topProductColumns} />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-xl">
          <TopNTable
            title="Top 3 products"
            data={topProducts}
            columns={topProductColumns}
            maxRows={3}
          />
        </div>
      ),
      code: `import { TopNTable } from '@open-mercato/ui/backend/charts'

<TopNTable title="Top 3 products" data={topProducts} columns={columns} maxRows={3} />`,
    },
    {
      id: 'empty',
      title: 'Empty state',
      render: () => (
        <div className="w-full max-w-xl">
          <TopNTable
            title="Top products"
            data={[]}
            columns={topProductColumns}
            emptyMessage="No sales in this period"
          />
        </div>
      ),
      code: `import { TopNTable } from '@open-mercato/ui/backend/charts'

<TopNTable title="Top products" data={[]} columns={columns} emptyMessage="No sales in this period" />`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  kpiCardEntry,
  sparklineEntry,
  barChartEntry,
  lineChartEntry,
  pieChartEntry,
  topNTableEntry,
]
