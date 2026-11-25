'use client'

import * as React from 'react'
import { Activity, BarChart3, Building2, ChevronLeft, ChevronRight, Download, Handshake, Home, Layers, Mail, Phone, Plus, Settings, SlidersHorizontal, UsersRound } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Timeline } from '@open-mercato/ui/blocks/timeline'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { ComponentsView, DashboardView } from '@/components/home/LivePanel'

export type PreviewScreen = 'list' | 'record' | 'dashboard' | 'components'

const NAV = [
  { id: 'home', icon: Home, screens: ['dashboard'] },
  { id: 'customers', icon: UsersRound, screens: ['list', 'record'] },
  { id: 'companies', icon: Building2, screens: [] },
  { id: 'deals', icon: Handshake, screens: [] },
  { id: 'reports', icon: BarChart3, screens: [] },
  { id: 'settings', icon: Settings, screens: ['components'] },
] as const

type CustomerStatus = 'active' | 'lead' | 'onHold'

const STATUS_VARIANT: Record<CustomerStatus, 'success' | 'info' | 'warning'> = { active: 'success', lead: 'info', onHold: 'warning' }

const CUSTOMERS: Array<{ id: string; name: string; email: string; company: string; status: CustomerStatus; owner: string; value: string; segment: 'enterprise' | 'midMarket' | 'smb' }> = [
  { id: 'c1', name: 'Maya Chen', email: 'maya@northline.example', company: 'Northline Logistics', status: 'active', owner: 'Alex Smith', value: '$84,200', segment: 'enterprise' },
  { id: 'c2', name: 'Jonas Weber', email: 'jonas@acme.example', company: 'Acme Corp', status: 'lead', owner: 'Anna Nowak', value: '$61,750', segment: 'midMarket' },
  { id: 'c3', name: 'Priya Patel', email: 'priya@brightside.example', company: 'Brightside Retail', status: 'active', owner: 'Alex Smith', value: '$48,900', segment: 'midMarket' },
  { id: 'c4', name: 'Omar Haddad', email: 'omar@harbor.example', company: 'Harbor Foods', status: 'onHold', owner: 'Laura Perez', value: '$23,400', segment: 'smb' },
  { id: 'c5', name: 'Elena Rossi', email: 'elena@studio-nove.example', company: 'Studio Nove', status: 'lead', owner: 'Anna Nowak', value: '$12,800', segment: 'smb' },
  { id: 'c6', name: 'Wei Zhang', email: 'wei@lumen.example', company: 'Lumen Energy', status: 'active', owner: 'Laura Perez', value: '$97,300', segment: 'enterprise' },
]

const SEGMENT_VARIANT = { enterprise: 'brand', midMarket: 'info', smb: 'neutral' } as const

function Brand({ logo }: { logo: string | null }) {
  const t = useT()
  return logo ? (
    <img src={logo} alt={t('design.create.logoAlt')} className="h-7 max-w-32 object-contain" />
  ) : (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">N</span>
      <span className="truncate text-sm text-foreground">Northline</span>
    </span>
  )
}

export function AppFrame({ screen, logo, children }: { screen: PreviewScreen; logo: string | null; children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="@container bg-background text-foreground">
      <div className="flex min-h-96">
        <nav aria-label={t('design.create.app.navigation')} className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-3 @3xl:flex">
          <div className="flex h-10 items-center px-2"><Brand logo={logo} /></div>
          <span className="px-2 pt-3 pb-1 text-xs text-muted-foreground">{t('design.create.app.workspace')}</span>
          {NAV.map(({ id, icon: Icon, screens }) => {
            const active = (screens as readonly string[]).includes(screen)
            return (
              <span key={id} aria-current={active ? 'page' : undefined} className={cn('flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm', active ? 'bg-muted text-foreground' : 'text-muted-foreground')}>
                <Icon aria-hidden className={cn('size-4', active && 'text-primary')} />
                {t(`design.create.app.nav.${id}`)}
              </span>
            )
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-panel">
            <div className="flex min-w-0 items-center gap-3">
              <span className="@3xl:hidden"><Brand logo={logo} /></span>
              <span className="hidden truncate text-sm text-muted-foreground @3xl:inline">{t(`design.create.app.crumb.${screen}`)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline">{t('design.create.sampleInvite')}</Button>
              <Avatar size="sm" label="Maya Chen" />
            </div>
          </header>
          <div className="min-w-0 flex-1 p-panel @3xl:p-card">{children}</div>
        </div>
      </div>
    </div>
  )
}

function ListScreen() {
  const t = useT()
  const [tab, setTab] = React.useState('all')
  const [selected, setSelected] = React.useState<Record<string, boolean>>({ c1: true })
  const [query, setQuery] = React.useState('')
  const rows = CUSTOMERS.filter((customer) => (tab === 'all' || customer.status === tab) && `${customer.name} ${customer.company}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-2xl tracking-tight text-foreground">{t('design.create.app.customers')}</h3>
          <p className="text-sm text-muted-foreground">{t('design.create.app.customersLead')}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline"><Download aria-hidden />{t('design.create.app.export')}</Button>
          <Button type="button"><Plus aria-hidden />{t('design.create.app.newCustomer')}</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={setTab} variant="underline">
          <TabsList aria-label={t('design.create.app.statusFilter')}>
            <TabsTrigger value="all" count={CUSTOMERS.length}>{t('design.create.app.tabAll')}</TabsTrigger>
            <TabsTrigger value="active">{t('design.create.app.status.active')}</TabsTrigger>
            <TabsTrigger value="lead">{t('design.create.app.status.lead')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex w-full items-center gap-2 @2xl:w-auto">
          <SearchInput className="min-w-0 flex-1 @2xl:w-64" value={query} onChange={setQuery} placeholder={t('design.create.app.search')} aria-label={t('design.create.app.search')} />
          <Button type="button" variant="outline"><SlidersHorizontal aria-hidden />{t('design.create.app.filters')}</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><span className="sr-only">{t('design.create.app.select')}</span></TableHead>
              <TableHead>{t('design.create.app.col.customer')}</TableHead>
              <TableHead className="hidden @3xl:table-cell">{t('design.create.app.col.company')}</TableHead>
              <TableHead>{t('design.create.app.col.status')}</TableHead>
              <TableHead className="hidden @4xl:table-cell">{t('design.create.app.col.segment')}</TableHead>
              <TableHead className="hidden @7xl:table-cell">{t('design.create.app.col.owner')}</TableHead>
              <TableHead className="hidden text-right whitespace-nowrap @lg:table-cell">{t('design.create.app.col.value')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((customer) => (
              <TableRow key={customer.id} data-state={selected[customer.id] ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox checked={selected[customer.id] ?? false} aria-label={`${t('design.create.app.select')} ${customer.name}`} onCheckedChange={(checked) => setSelected((current) => ({ ...current, [customer.id]: checked === true }))} />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-3">
                    <Avatar size="sm" label={customer.name} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-foreground">{customer.name}</span>
                      <span className="hidden truncate text-xs text-muted-foreground @md:block">{customer.email}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap @3xl:table-cell">{customer.company}</TableCell>
                <TableCell className="whitespace-nowrap"><StatusBadge variant={STATUS_VARIANT[customer.status]} dot>{t(`design.create.app.status.${customer.status}`)}</StatusBadge></TableCell>
                <TableCell className="hidden whitespace-nowrap @4xl:table-cell"><Tag variant={SEGMENT_VARIANT[customer.segment]}>{t(`design.home.panel.segments.${customer.segment}`)}</Tag></TableCell>
                <TableCell className="hidden whitespace-nowrap @7xl:table-cell">{customer.owner}</TableCell>
                <TableCell className="hidden text-right tabular-nums @lg:table-cell">{customer.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? <p className="p-card text-center text-sm text-muted-foreground">{t('design.create.app.noRows')}</p> : null}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('design.create.app.rowCount', { visible: rows.length, total: CUSTOMERS.length })}</span>
        <span className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled><ChevronLeft aria-hidden />{t('design.create.app.previous')}</Button>
          <Button type="button" size="sm" variant="outline">{t('design.create.app.next')}<ChevronRight aria-hidden /></Button>
        </span>
      </div>
    </div>
  )
}

function RecordScreen() {
  const t = useT()
  const [tab, setTab] = React.useState('overview')
  return (
    <div className="flex flex-col gap-gutter">
      <EntityHeader
        title="Maya Chen"
        subtitle="Northline Logistics"
        avatar={{ initials: 'MC' }}
        badge={{ label: t('design.create.app.status.active'), tone: 'success' }}
        meta={[
          { key: 'owner', label: t('design.create.app.col.owner'), value: 'Alex Smith' },
          { key: 'value', label: t('design.create.app.col.value'), value: '$84,200' },
        ]}
        actions={[
          { key: 'email', label: t('design.create.app.sendEmail') },
          { key: 'deal', label: t('design.create.app.newDeal') },
        ]}
        primaryActionKey="deal"
        onAction={() => undefined}
      />
      <Tabs value={tab} onValueChange={setTab} variant="underline">
        <TabsList aria-label={t('design.create.app.recordTabs')}>
          <TabsTrigger value="overview">{t('design.create.app.tabOverview')}</TabsTrigger>
          <TabsTrigger value="deals" count={3}>{t('design.create.app.nav.deals')}</TabsTrigger>
          <TabsTrigger value="files">{t('design.create.app.tabFiles')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-gutter @4xl:grid-cols-5">
        <section aria-label={t('design.create.app.details')} className="rounded-card border border-border bg-card p-panel @4xl:col-span-2">
          <h4 className="mb-3 text-base text-foreground">{t('design.create.app.details')}</h4>
          <KeyValue
            items={[
              { key: 'email', label: t('design.create.app.email'), icon: <Mail aria-hidden className="size-4" />, value: 'maya@northline.example' },
              { key: 'phone', label: t('design.create.app.phone'), icon: <Phone aria-hidden className="size-4" />, value: '+1 212 555 0142' },
              { key: 'company', label: t('design.create.app.col.company'), icon: <Building2 aria-hidden className="size-4" />, value: 'Northline Logistics' },
              { key: 'segment', label: t('design.create.app.col.segment'), icon: <Layers aria-hidden className="size-4" />, value: <Tag variant="brand">{t('design.home.panel.segments.enterprise')}</Tag> },
              { key: 'status', label: t('design.create.app.col.status'), icon: <Activity aria-hidden className="size-4" />, value: <StatusBadge variant="success" dot>{t('design.create.app.status.active')}</StatusBadge> },
            ]}
          />
        </section>
        <section aria-label={t('design.create.app.activity')} className="rounded-card border border-border bg-card p-panel @4xl:col-span-3">
          <h4 className="mb-3 text-base text-foreground">{t('design.create.app.activity')}</h4>
          <Timeline
            order="desc"
            groupBy="none"
            items={[
              {
                id: 'record-1',
                occurredAt: '2026-11-25T09:40:00Z',
                kind: 'update',
                icon: 'pencil-line',
                title: t('design.home.panel.timelineChanged'),
                author: { name: 'Alex Smith' },
                changes: [{ key: 'stage', label: t('design.home.panel.stage'), icon: 'trending-up', from: t('design.home.panel.stageNew'), to: t('design.home.panel.stageQualified') }],
              },
              { id: 'record-2', occurredAt: '2026-11-24T08:00:00Z', kind: 'note', title: t('design.home.panel.timelineNote'), author: { name: 'Anna Nowak' }, body: t('design.home.panel.timelineNoteBody') },
            ]}
          />
        </section>
      </div>
    </div>
  )
}

export function PreviewScreenContent({ screen }: { screen: PreviewScreen }) {
  if (screen === 'list') return <ListScreen />
  if (screen === 'record') return <RecordScreen />
  if (screen === 'dashboard') return <DashboardView />
  return <ComponentsView />
}
