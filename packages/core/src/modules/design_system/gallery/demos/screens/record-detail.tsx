'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EntityHeader, entityHeaderTabIds } from '@open-mercato/ui/blocks/entity-header'
import { KeyValue, type KeyValueItem } from '@open-mercato/ui/blocks/key-value'
import { Timeline, type TimelineItem } from '@open-mercato/ui/blocks/timeline'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScreenFrame } from './frame'

type Translate = ReturnType<typeof useT>
type DetailTab = 'overview' | 'activity'

export type RecordDetailScreenProps = {
  initialTab?: DetailTab
  loading?: boolean
}

const CUSTOMER_NAME = 'Brightwater Clinic'
const LATEST_ACTIVITY_COUNT = 3
const SECTION_CLASS = 'flex min-w-0 flex-col gap-4 rounded-card border border-border p-card'
const SECTION_TITLE_CLASS = 'text-base text-foreground'

function buildDetails(t: Translate): KeyValueItem[] {
  const prefix = 'design_system.gallery.screens.recordDetail.fields'
  return [
    { key: 'email', label: t(`${prefix}.email`, 'Email'), value: 'office@brightwater.example', editable: true, editor: 'text' },
    { key: 'phone', label: t(`${prefix}.phone`, 'Phone'), value: '+1 555 0142', editable: true, editor: 'text' },
    {
      key: 'terms',
      label: t(`${prefix}.terms`, 'Payment terms'),
      value: 'net-30',
      editable: true,
      editor: 'select',
      options: [
        { value: 'net-14', label: t(`${prefix}.termsNet14`, '14 days') },
        { value: 'net-30', label: t(`${prefix}.termsNet30`, '30 days') },
        { value: 'net-60', label: t(`${prefix}.termsNet60`, '60 days') },
      ],
    },
    { key: 'tax-id', label: t(`${prefix}.taxId`, 'Tax ID'), value: 'BW-204-771' },
    {
      key: 'address',
      label: t(`${prefix}.address`, 'Billing address'),
      value: t(`${prefix}.addressValue`, '18 Quarry Lane, Riverton'),
      editable: true,
      editor: 'textarea',
    },
    {
      key: 'notes',
      label: t(`${prefix}.notes`, 'Notes'),
      value: t(`${prefix}.notesValue`, 'Deliveries through the side entrance before 10:00.'),
      editable: true,
      editor: 'textarea',
    },
  ]
}

function buildActivity(t: Translate): TimelineItem[] {
  const prefix = 'design_system.gallery.screens.recordDetail.activity'
  return [
    {
      id: 'act-5',
      occurredAt: '2026-11-26T14:20:00Z',
      kind: 'note',
      title: t(`${prefix}.noteTitle`, 'added a note'),
      author: { name: 'Mira Sandoval' },
      body: t(`${prefix}.noteBody`, 'Asked for a quote covering two more treatment rooms.'),
    },
    {
      id: 'act-4',
      occurredAt: '2026-11-26T09:05:00Z',
      kind: 'update',
      icon: 'pencil-line',
      title: t(`${prefix}.updateTitle`, 'updated billing settings'),
      author: { name: 'Tomas Reyes' },
      changes: [
        {
          key: 'terms',
          label: t('design_system.gallery.screens.recordDetail.fields.terms', 'Payment terms'),
          from: t('design_system.gallery.screens.recordDetail.fields.termsNet14', '14 days'),
          to: t('design_system.gallery.screens.recordDetail.fields.termsNet30', '30 days'),
        },
      ],
    },
    {
      id: 'act-3',
      occurredAt: '2026-11-24T16:40:00Z',
      kind: 'call',
      icon: 'phone-call',
      title: t(`${prefix}.callTitle`, 'logged a call'),
      author: { name: 'Mira Sandoval' },
    },
    {
      id: 'act-2',
      occurredAt: '2026-11-20T11:15:00Z',
      kind: 'approval',
      icon: 'check-circle-2',
      title: t(`${prefix}.approvalTitle`, 'Credit limit review finished'),
      status: { label: t(`${prefix}.approved`, 'Approved'), tone: 'success' },
    },
    {
      id: 'act-1',
      occurredAt: '2026-11-12T08:30:00Z',
      kind: 'created',
      title: t(`${prefix}.createdTitle`, 'Customer record created'),
    },
  ]
}

function matchesActivityFilter(item: TimelineItem, filterKey: string): boolean {
  if (filterKey === 'notes') return item.kind === 'note' || item.kind === 'call'
  if (filterKey === 'changes') return item.kind === 'update' || item.kind === 'approval' || item.kind === 'created'
  return true
}

export function RecordDetailScreen({ initialTab = 'overview', loading = false }: RecordDetailScreenProps) {
  const t = useT()
  const generatedId = React.useId()
  const idBase = `screen-detail-${generatedId.replace(/[^\w-]/g, '')}`
  const [activeTab, setActiveTab] = React.useState<string>(initialTab)
  const [details, setDetails] = React.useState<KeyValueItem[]>(() => buildDetails(t))
  const [activity, setActivity] = React.useState<TimelineItem[]>(() => buildActivity(t))
  const [activityFilter, setActivityFilter] = React.useState('all')
  const [archived, setArchived] = React.useState(false)
  const status = loading ? 'loading' : undefined
  const panelIds = entityHeaderTabIds(idBase, activeTab)

  const runHeaderAction = (actionKey: string) => {
    if (actionKey === 'archive') {
      setArchived((current) => !current)
      return
    }
    setActivity((current) => [
      {
        id: `act-new-${current.length + 1}`,
        occurredAt: new Date().toISOString(),
        kind: 'call',
        icon: 'phone-call',
        title: t('design_system.gallery.screens.recordDetail.activity.callTitle', 'logged a call'),
        author: { name: 'Mira Sandoval' },
      },
      ...current,
    ])
  }

  return (
    <ScreenFrame width="default">
      <EntityHeader
        status={status}
        idBase={idBase}
        backLabel={t('design_system.gallery.screens.recordDetail.back', 'Customers')}
        onBack={() => undefined}
        avatar={{ initials: 'BC' }}
        title={CUSTOMER_NAME}
        badge={
          archived
            ? { label: t('design_system.gallery.screens.recordDetail.badgeArchived', 'Archived'), tone: 'neutral' }
            : { label: t('design_system.gallery.screens.recordDetail.badgeActive', 'Active'), tone: 'success' }
        }
        meta={[
          { key: 'owner', label: t('design_system.gallery.screens.recordDetail.meta.owner', 'Owner'), value: 'Mira Sandoval' },
          { key: 'segment', label: t('design_system.gallery.screens.recordDetail.meta.segment', 'Segment'), value: t('design_system.gallery.screens.recordDetail.meta.segmentValue', 'Healthcare') },
          { key: 'since', label: t('design_system.gallery.screens.recordDetail.meta.since', 'Customer since'), value: '2024' },
        ]}
        actions={[
          { key: 'log-call', label: t('design_system.gallery.screens.recordDetail.actions.logCall', 'Log a call'), icon: 'phone-call' },
          {
            key: 'archive',
            label: archived
              ? t('design_system.gallery.screens.recordDetail.actions.restore', 'Restore')
              : t('design_system.gallery.screens.recordDetail.actions.archive', 'Archive'),
            icon: 'archive',
          },
        ]}
        primaryActionKey="log-call"
        onAction={runHeaderAction}
        tabs={[
          { key: 'overview', label: t('design_system.gallery.screens.recordDetail.tabs.overview', 'Overview') },
          { key: 'activity', label: t('design_system.gallery.screens.recordDetail.tabs.activity', 'Activity'), count: activity.length },
        ]}
        activeTabKey={activeTab}
        onTabChange={setActiveTab}
        tabsLabel={t('design_system.gallery.screens.recordDetail.tabsLabel', 'Customer sections')}
      />
      <div role="tabpanel" id={panelIds.panelId} aria-labelledby={panelIds.tabId} tabIndex={0} className="rounded-card outline-none focus-visible:shadow-focus">
        {activeTab === 'overview' ? (
          <div className="grid items-start gap-gutter lg:grid-cols-5">
            <section aria-labelledby={`${idBase}-details`} className={`${SECTION_CLASS} lg:col-span-3`}>
              <h2 id={`${idBase}-details`} className={SECTION_TITLE_CLASS}>
                {t('design_system.gallery.screens.recordDetail.detailsTitle', 'Details')}
              </h2>
              <KeyValue
                status={status}
                items={details}
                columns={2}
                layout="vertical"
                onEdit={async (key, nextValue) => {
                  setDetails((current) => current.map((item) => (item.key === key ? { ...item, value: nextValue } : item)))
                }}
              />
            </section>
            <section aria-labelledby={`${idBase}-latest`} className={`${SECTION_CLASS} lg:col-span-2`}>
              <h2 id={`${idBase}-latest`} className={SECTION_TITLE_CLASS}>
                {t('design_system.gallery.screens.recordDetail.latestTitle', 'Latest activity')}
              </h2>
              <Timeline status={status} order="desc" groupBy="none" items={activity.slice(0, LATEST_ACTIVITY_COUNT)} />
              {loading ? null : (
                <Button type="button" variant="outline" size="sm" className="h-10 self-start sm:h-8" onClick={() => setActiveTab('activity')}>
                  {t('design_system.gallery.screens.recordDetail.viewAll', 'View all activity')}
                </Button>
              )}
            </section>
          </div>
        ) : (
          <Timeline
            status={status}
            order="desc"
            groupBy="day"
            items={activity.filter((item) => matchesActivityFilter(item, activityFilter))}
            filters={[
              { key: 'all', label: t('design_system.gallery.screens.recordDetail.filters.all', 'All') },
              { key: 'notes', label: t('design_system.gallery.screens.recordDetail.filters.notes', 'Notes and calls') },
              { key: 'changes', label: t('design_system.gallery.screens.recordDetail.filters.changes', 'Changes') },
            ]}
            activeFilterKey={activityFilter}
            onFilterChange={setActivityFilter}
          />
        )}
      </div>
    </ScreenFrame>
  )
}
