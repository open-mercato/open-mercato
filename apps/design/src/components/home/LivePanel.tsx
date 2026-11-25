'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Mail, Upload, UserRound } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Timeline } from '@open-mercato/ui/blocks/timeline'
import { KpiCard } from '@open-mercato/ui/backend/charts/KpiCard'
import { LineChart } from '@open-mercato/ui/backend/charts/LineChart'
import { TopNTable } from '@open-mercato/ui/backend/charts/TopNTable'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { DesignScope, type DesignScopeDensity, type DesignScopeMode, type DesignScopeShape } from '@open-mercato/ui/primitives/design-scope'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { StepIndicator } from '@open-mercato/ui/primitives/step-indicator'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Tag } from '@open-mercato/ui/primitives/tag'

type PanelView = 'components' | 'dashboard'

function Tile({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('min-w-0 rounded-card border border-border bg-card p-panel text-card-foreground', className)}>{children}</div>
}

const SEGMENTS = [
  { id: 'enterprise', share: 48, color: 'bg-chart-1' },
  { id: 'midMarket', share: 32, color: 'bg-chart-2' },
  { id: 'smb', share: 20, color: 'bg-chart-3' },
] as const

export function ComponentsView() {
  const t = useT()
  const [stage, setStage] = React.useState('qualified')
  return (
    <div className="@container">
    <div className="grid gap-gutter @2xl:grid-cols-2 @5xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-gutter">
        <Tile className="flex flex-col gap-y-field-stack">
          <FormField label={t('design.home.panel.email')} description={t('design.home.panel.emailHint')}>
            <Input leftIcon={<Mail />} defaultValue="anna@example.com" />
          </FormField>
          <FormField label={t('design.home.panel.stage')}>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{t('design.home.panel.stageNew')}</SelectItem>
                <SelectItem value="qualified">{t('design.home.panel.stageQualified')}</SelectItem>
                <SelectItem value="won">{t('design.home.panel.stageWon')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <div className="flex flex-col gap-3">
            <CheckboxField label={t('design.home.panel.notify')} defaultChecked />
            <SwitchField label={t('design.home.panel.autoAssign')} defaultChecked />
          </div>
        </Tile>
        <Tile className="flex flex-col gap-4">
          <StepIndicator
            steps={[
              { id: 'details', label: t('design.home.panel.stepDetails'), status: 'complete' },
              { id: 'items', label: t('design.home.panel.stepItems'), status: 'current' },
              { id: 'review', label: t('design.home.panel.stepReview'), status: 'pending' },
            ]}
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('design.home.panel.progress')}</span>
              <span className="tabular-nums">60%</span>
            </div>
            <Progress value={60} />
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge variant="success" dot>{t('design.home.panel.paid')}</StatusBadge>
            <StatusBadge variant="info" dot>{t('design.home.panel.processing')}</StatusBadge>
            <StatusBadge variant="warning" dot>{t('design.home.panel.onHold')}</StatusBadge>
            <StatusBadge variant="error" dot>{t('design.home.panel.overdue')}</StatusBadge>
          </div>
        </Tile>
      </div>
      <div className="flex min-w-0 flex-col gap-gutter">
        <Tile className="flex flex-col gap-y-field-stack">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg text-foreground">{t('design.home.panel.workspaceTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('design.home.panel.workspaceBody')}</p>
          </div>
          <FormField label={t('design.home.panel.workspaceName')}>
            <Input defaultValue="Northline Logistics" />
          </FormField>
          <Button type="button" className="w-full">{t('design.home.panel.create')}</Button>
          <Separator label={t('design.home.panel.or')} />
          <Button type="button" variant="outline" className="w-full">
            <Upload aria-hidden />
            {t('design.home.panel.import')}
          </Button>
        </Tile>
        <Tile>
          <KeyValue
            items={[
              { key: 'owner', label: t('design.home.panel.owner'), icon: <UserRound />, value: 'Maya Chen' },
              { key: 'segment', label: t('design.home.panel.segment'), value: 'Enterprise' },
              { key: 'value', label: t('design.home.panel.value'), value: '$48,000' },
            ]}
          />
        </Tile>
      </div>
      <div className="flex min-w-0 flex-col gap-gutter @2xl:col-span-2 @5xl:col-span-1">
        <Tile>
          <Timeline
            order="desc"
            items={[
              {
                id: 'home-1',
                occurredAt: '2026-11-25T09:40:00Z',
                kind: 'update',
                icon: 'pencil-line',
                title: t('design.home.panel.timelineChanged'),
                author: { name: 'Alex Smith' },
                changes: [
                  { key: 'stage', label: t('design.home.panel.stage'), icon: 'trending-up', from: t('design.home.panel.stageNew'), to: t('design.home.panel.stageQualified') },
                  { key: 'owner', label: t('design.home.panel.owner'), icon: 'user-round', to: 'Maya Chen' },
                ],
              },
              {
                id: 'home-2',
                occurredAt: '2026-11-24T08:00:00Z',
                kind: 'note',
                title: t('design.home.panel.timelineNote'),
                author: { name: 'Anna Nowak' },
                body: t('design.home.panel.timelineNoteBody'),
              },
            ]}
          />
        </Tile>
        <Alert status="information">
          <AlertTitle>{t('design.home.panel.alertTitle')}</AlertTitle>
          <AlertDescription>{t('design.home.panel.alertBody')}</AlertDescription>
        </Alert>
        <Tile className="flex flex-col gap-3">
          <p className="text-sm text-foreground">{t('design.home.panel.segmentsTitle')}</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            {SEGMENTS.map((segment) => (
              <span key={segment.id} className={segment.color} style={{ width: `${segment.share}%` }} />
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {SEGMENTS.map((segment) => (
              <li key={segment.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span aria-hidden className={`size-2 rounded-full ${segment.color}`} />
                  {t(`design.home.panel.segments.${segment.id}`)}
                </span>
                <span className="tabular-nums text-foreground">{segment.share}%</span>
              </li>
            ))}
          </ul>
        </Tile>
        <Tile className="flex flex-wrap gap-2">
          <Tag variant="info" shape="square">{t('design.home.panel.tagPriority')}</Tag>
          <Tag variant="success" shape="square">{t('design.home.panel.tagRenewal')}</Tag>
          <Tag variant="brand" shape="square">{t('design.home.panel.tagPilot')}</Tag>
          <Tag shape="square">{t('design.home.panel.tagWarehouse')}</Tag>
        </Tile>
      </div>
    </div>
    </div>
  )
}

const REVENUE = [
  { month: 'Jun', revenue: 42, target: 40 },
  { month: 'Jul', revenue: 48, target: 44 },
  { month: 'Aug', revenue: 45, target: 48 },
  { month: 'Sep', revenue: 57, target: 52 },
  { month: 'Oct', revenue: 61, target: 56 },
  { month: 'Nov', revenue: 68, target: 60 },
]

export function DashboardView() {
  const t = useT()
  const revenueLabel = t('design.home.panel.kpiRevenue')
  const targetLabel = t('design.home.panel.target')
  const customers = [
    { name: 'Northline Logistics', orders: 128, revenue: '$84,200' },
    { name: 'Acme Corp', orders: 96, revenue: '$61,750' },
    { name: 'Harbor Foods', orders: 74, revenue: '$48,300' },
    { name: 'Vertex Retail', orders: 51, revenue: '$32,900' },
  ]
  return (
    <div className="@container">
    <div className="flex flex-col gap-gutter">
      <div className="grid gap-gutter @xl:grid-cols-3">
        <KpiCard title={t('design.home.panel.kpiRevenue')} value={68400} prefix="$" trend={{ value: 11.5, direction: 'up' }} comparisonLabel={t('design.home.panel.kpiComparison')} />
        <KpiCard title={t('design.home.panel.kpiOrders')} value={349} trend={{ value: 4.2, direction: 'up' }} comparisonLabel={t('design.home.panel.kpiComparison')} />
        <KpiCard title={t('design.home.panel.kpiReturns')} value={2.1} formatValue={(value) => `${value.toFixed(1)}%`} trend={{ value: 0.4, direction: 'down' }} comparisonLabel={t('design.home.panel.kpiComparison')} />
      </div>
      <div className="grid gap-gutter @4xl:grid-cols-5">
        <LineChart
          className="@4xl:col-span-3"
          title={t('design.home.panel.revenueTrend')}
          data={REVENUE.map((row) => ({ month: row.month, [revenueLabel]: row.revenue, [targetLabel]: row.target }))}
          index="month"
          categories={[revenueLabel, targetLabel]}
          showLegend
          valueFormatter={(value) => `$${value}k`}
          showArea
        />
        <TopNTable
          className="@4xl:col-span-2"
          title={t('design.home.panel.topCustomers')}
          data={customers}
          columns={[
            { key: 'name', header: t('design.home.panel.customer') },
            { key: 'orders', header: t('design.home.panel.orders'), align: 'right' },
            { key: 'revenue', header: t('design.home.panel.kpiRevenue'), align: 'right' },
          ]}
        />
      </div>
    </div>
    </div>
  )
}

export function LivePanel() {
  const t = useT()
  const [view, setView] = React.useState<PanelView>('components')
  const [mode, setMode] = React.useState<DesignScopeMode>('light')
  const [density, setDensity] = React.useState<DesignScopeDensity>('default')
  const [shape, setShape] = React.useState<DesignScopeShape>('default')

  return (
    <section aria-labelledby="home-panel-title" className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 id="home-panel-title" className="text-3xl tracking-tight text-foreground sm:text-4xl">{t('design.home.panel.title')}</h2>
        <p className="max-w-2xl text-base text-muted-foreground">{t('design.home.panel.lead')}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl size="sm" value={view} aria-label={t('design.home.panel.view')} onValueChange={(next) => { if (next === 'components' || next === 'dashboard') setView(next) }}>
          <SegmentedControlItem value="components">{t('design.home.panel.viewComponents')}</SegmentedControlItem>
          <SegmentedControlItem value="dashboard">{t('design.home.panel.viewDashboard')}</SegmentedControlItem>
        </SegmentedControl>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl size="sm" value={mode} aria-label={t('design.home.panel.mode')} onValueChange={(next) => { if (next === 'light' || next === 'dark') setMode(next) }}>
            <SegmentedControlItem value="light">{t('design.home.panel.modeLight')}</SegmentedControlItem>
            <SegmentedControlItem value="dark">{t('design.home.panel.modeDark')}</SegmentedControlItem>
          </SegmentedControl>
          <SegmentedControl size="sm" value={density} aria-label={t('design.home.panel.density')} onValueChange={(next) => { if (next === 'default' || next === 'compact') setDensity(next) }}>
            <SegmentedControlItem value="default">{t('design.home.panel.densityDefault')}</SegmentedControlItem>
            <SegmentedControlItem value="compact">{t('design.home.panel.densityCompact')}</SegmentedControlItem>
          </SegmentedControl>
          <SegmentedControl size="sm" value={shape} aria-label={t('design.home.panel.shape')} onValueChange={(next) => { if (next === 'default' || next === 'round' || next === 'sharp') setShape(next) }}>
            <SegmentedControlItem value="default">{t('design.home.panel.shapeDefault')}</SegmentedControlItem>
            <SegmentedControlItem value="round">{t('design.home.panel.shapeRound')}</SegmentedControlItem>
            <SegmentedControlItem value="sharp">{t('design.home.panel.shapeSharp')}</SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>
      <DesignScope
        mode={mode}
        density={density}
        shape={shape}
        data-home-panel={view}
        className="rounded-card border border-border p-panel sm:p-card"
      >
        {view === 'components' ? <ComponentsView /> : <DashboardView />}
      </DesignScope>
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <Link href="/create/">{t('design.home.panel.openCreator')}<ArrowRight aria-hidden className="size-4" /></Link>
        </Button>
      </div>
    </section>
  )
}
