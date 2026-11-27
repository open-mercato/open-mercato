'use client'

import * as React from 'react'
import { Inbox, SearchX } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { BulkActionBar } from '@open-mercato/ui/blocks/bulk-action-bar'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { Kanban, type KanbanCard, type KanbanColumn } from '@open-mercato/ui/blocks/kanban'
import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { ScreenFrame, wait } from './frame'

type Translate = ReturnType<typeof useT>
type RequestStatus = 'open' | 'in-progress' | 'done'
type RequestPriority = 'high' | 'normal'

type ServiceRequest = {
  id: string
  title: string
  customer: string
  owner: string
  status: RequestStatus
  priority: RequestPriority
  due: string
}

type ChipId = 'priority-high' | 'due-soon'

export type RecordListScreenProps = {
  initialQuery?: string
  initialQuickFilterIds?: string[]
  initialChipIds?: ChipId[]
  initialSelectedIds?: string[]
}

const CURRENT_USER = 'Mira Sandoval'
const DUE_SOON_LIMIT = '2026-12-05'
const STATUS_ORDER: RequestStatus[] = ['open', 'in-progress', 'done']
const STATUS_TONE: Record<RequestStatus, StatusBadgeVariant> = { open: 'neutral', 'in-progress': 'info', done: 'success' }
const HIT_AREA_CLASS = 'relative after:absolute after:-inset-2'

function buildRequests(t: Translate): ServiceRequest[] {
  const prefix = 'design_system.gallery.screens.recordList.requests'
  return [
    { id: 'req-1041', title: t(`${prefix}.coolerRepair`, 'Walk-in cooler repair'), customer: 'Alder Bakery', owner: CURRENT_USER, status: 'open', priority: 'high', due: '2026-12-02' },
    { id: 'req-1040', title: t(`${prefix}.printerSetup`, 'Label printer setup'), customer: 'Brightwater Clinic', owner: 'Tomas Reyes', status: 'in-progress', priority: 'normal', due: '2026-12-04' },
    { id: 'req-1039', title: t(`${prefix}.annualInspection`, 'Annual safety inspection'), customer: 'Copperline Studio', owner: CURRENT_USER, status: 'open', priority: 'normal', due: '2026-12-09' },
    { id: 'req-1038', title: t(`${prefix}.scannerReplacement`, 'Handheld scanner replacement'), customer: 'Dunmore Freight', owner: 'Ines Okafor', status: 'in-progress', priority: 'high', due: '2026-12-03' },
    { id: 'req-1037', title: t(`${prefix}.networkOutage`, 'Front desk network outage'), customer: 'Elm Street Dental', owner: 'Tomas Reyes', status: 'open', priority: 'high', due: '2026-12-01' },
    { id: 'req-1036', title: t(`${prefix}.keyCards`, 'Key card reader calibration'), customer: 'Fernhill Hotel', owner: CURRENT_USER, status: 'done', priority: 'normal', due: '2026-11-27' },
    { id: 'req-1035', title: t(`${prefix}.freezerAlarm`, 'Freezer alarm keeps triggering'), customer: 'Glasswing Labs', owner: 'Ines Okafor', status: 'open', priority: 'normal', due: '2026-12-11' },
    { id: 'req-1034', title: t(`${prefix}.projectorMount`, 'Projector mount installation'), customer: 'Harborview School', owner: 'Tomas Reyes', status: 'done', priority: 'normal', due: '2026-11-25' },
  ]
}

function statusLabels(t: Translate): Record<RequestStatus, string> {
  return {
    open: t('design_system.gallery.screens.recordList.status.open', 'Open'),
    'in-progress': t('design_system.gallery.screens.recordList.status.inProgress', 'In progress'),
    done: t('design_system.gallery.screens.recordList.status.done', 'Done'),
  }
}

function matchesChip(request: ServiceRequest, chipId: ChipId): boolean {
  if (chipId === 'priority-high') return request.priority === 'high'
  return request.due <= DUE_SOON_LIMIT
}

function matchesQuickFilter(request: ServiceRequest, filterId: string): boolean {
  if (filterId === 'mine') return request.owner === CURRENT_USER
  return request.status !== 'done'
}

function isRequestStatus(value: string): value is RequestStatus {
  return STATUS_ORDER.some((status) => status === value)
}

function textOf(card: KanbanCard, key: string): string {
  const value = card[key]
  return typeof value === 'string' ? value : ''
}

function renderRequestCard(card: KanbanCard): React.ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-foreground">{textOf(card, 'title')}</span>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{textOf(card, 'customer')}</span>
        <Avatar size="sm" label={textOf(card, 'owner')} className="font-normal" />
      </div>
    </div>
  )
}

export function RecordListScreen({
  initialQuery = '',
  initialQuickFilterIds = [],
  initialChipIds = [],
  initialSelectedIds = [],
}: RecordListScreenProps) {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [requests, setRequests] = React.useState<ServiceRequest[]>(() => buildRequests(t))
  const [query, setQuery] = React.useState(initialQuery)
  const [quickFilterIds, setQuickFilterIds] = React.useState<string[]>(initialQuickFilterIds)
  const [chipIds, setChipIds] = React.useState<ChipId[]>(initialChipIds)
  const [view, setView] = React.useState('table')
  const [selectedIds, setSelectedIds] = React.useState<string[]>(initialSelectedIds)
  const createdCount = React.useRef(0)

  const labels = statusLabels(t)
  const dueFormat = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  )
  const chipLabels: Record<ChipId, string> = {
    'priority-high': t('design_system.gallery.screens.recordList.chips.priorityHigh', 'Priority: High'),
    'due-soon': t('design_system.gallery.screens.recordList.chips.dueSoon', 'Due: this week'),
  }

  const needle = query.trim().toLowerCase()
  const visible = requests.filter(
    (request) =>
      (needle === '' || `${request.title} ${request.customer}`.toLowerCase().includes(needle)) &&
      quickFilterIds.every((filterId) => matchesQuickFilter(request, filterId)) &&
      chipIds.every((chipId) => matchesChip(request, chipId)),
  )
  const visibleIds = visible.map((request) => request.id)
  const selected = selectedIds.filter((id) => visibleIds.includes(id))
  const isFiltered = needle !== '' || quickFilterIds.length > 0 || chipIds.length > 0
  const allSelected = visible.length > 0 && selected.length === visible.length

  const clearFilters = () => {
    setQuery('')
    setQuickFilterIds([])
    setChipIds([])
  }

  const toggleRow = (id: string, next: boolean) =>
    setSelectedIds((current) => (next ? [...current, id] : current.filter((selectedId) => selectedId !== id)))

  const createRequest = () => {
    createdCount.current += 1
    const request: ServiceRequest = {
      id: `req-new-${createdCount.current}`,
      title: t('design_system.gallery.screens.recordList.newRequestTitle', 'New request {number}', { number: createdCount.current }),
      customer: 'Alder Bakery',
      owner: CURRENT_USER,
      status: 'open',
      priority: 'normal',
      due: DUE_SOON_LIMIT,
    }
    setRequests((current) => [request, ...current])
  }

  const runBulkAction = async (actionKey: string) => {
    if (actionKey === 'delete') {
      const confirmed = await confirm({
        title: t('design_system.gallery.screens.recordList.deleteTitle', 'Delete {count} requests?', { count: selected.length }),
        text: t('design_system.gallery.screens.recordList.deleteText', 'Deleted requests cannot be restored.'),
        confirmText: t('design_system.gallery.screens.recordList.bulk.delete', 'Delete'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    await wait(500)
    if (actionKey === 'delete') setRequests((current) => current.filter((request) => !selected.includes(request.id)))
    if (actionKey === 'mark-done') {
      setRequests((current) => current.map((request) => (selected.includes(request.id) ? { ...request, status: 'done' } : request)))
    }
    if (actionKey === 'assign-me') {
      setRequests((current) => current.map((request) => (selected.includes(request.id) ? { ...request, owner: CURRENT_USER } : request)))
    }
    setSelectedIds([])
  }

  const boardColumns: KanbanColumn[] = STATUS_ORDER.map((status) => {
    const cards = visible.filter((request) => request.status === status)
    return { id: status, title: labels[status], count: cards.length, cards }
  })

  const emptyState =
    requests.length === 0 ? (
      <EmptyState
        icon={<Inbox aria-hidden="true" className="size-5" />}
        title={t('design_system.gallery.screens.recordList.noneTitle', 'No requests yet')}
        description={t('design_system.gallery.screens.recordList.noneDescription', 'New requests from customers will show up here.')}
      />
    ) : (
      <EmptyState
        icon={<SearchX aria-hidden="true" className="size-5" />}
        title={t('design_system.gallery.screens.recordList.emptyTitle', 'No requests match')}
        description={t('design_system.gallery.screens.recordList.emptyDescription', 'Try another search term or remove a filter.')}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            {t('design_system.gallery.screens.recordList.clearFilters', 'Clear search and filters')}
          </Button>
        }
      />
    )

  return (
    <ScreenFrame className={selected.length > 0 && view === 'table' ? 'pb-24' : undefined}>
      <EntityHeader
        title={t('design_system.gallery.screens.recordList.title', 'Service requests')}
        count={requests.length}
        subtitle={t('design_system.gallery.screens.recordList.subtitle', 'Work reported by customers, with its owner and due date.')}
        actions={[{ key: 'create', label: t('design_system.gallery.screens.recordList.create', 'New request'), icon: 'plus-square' }]}
        primaryActionKey="create"
        onAction={createRequest}
      />
      <div className="flex flex-col gap-4">
        <ListToolbar
          ariaLabel={t('design_system.gallery.screens.recordList.toolbarLabel', 'Request list tools')}
          search={{ value: query, placeholder: t('design_system.gallery.screens.recordList.searchPlaceholder', 'Search requests') }}
          onSearchChange={setQuery}
          quickFilters={[
            {
              id: 'mine',
              label: t('design_system.gallery.screens.recordList.quick.mine', 'Assigned to me'),
              icon: 'user',
              active: quickFilterIds.includes('mine'),
            },
            {
              id: 'open',
              label: t('design_system.gallery.screens.recordList.quick.notDone', 'Not done'),
              active: quickFilterIds.includes('open'),
            },
          ]}
          onQuickFilterToggle={(id, next) =>
            setQuickFilterIds((current) => (next ? [...current, id] : current.filter((filterId) => filterId !== id)))
          }
          chips={chipIds.map((chipId) => ({ id: chipId, label: chipLabels[chipId] }))}
          onChipRemove={(id) => setChipIds((current) => current.filter((chipId) => chipId !== id))}
          onClearAll={() => setChipIds([])}
          views={[
            { id: 'table', label: t('design_system.gallery.screens.recordList.views.table', 'Table'), icon: 'rows' },
            { id: 'board', label: t('design_system.gallery.screens.recordList.views.board', 'Board'), icon: 'grid-3x3' },
          ]}
          activeViewId={view}
          onViewChange={setView}
          resultSummary={
            isFiltered && visible.length > 0
              ? t('design_system.gallery.screens.recordList.matching', '{count} matching', { count: visible.length })
              : undefined
          }
        />
        {visible.length === 0 ? (
          <div className="rounded-card border border-border">{emptyState}</div>
        ) : view === 'board' ? (
          <Kanban
            columns={boardColumns}
            renderCard={renderRequestCard}
            onMove={async (cardId, toColumnId) => {
              if (!isRequestStatus(toColumnId)) return
              setRequests((current) => current.map((request) => (request.id === cardId ? { ...request, status: toColumnId } : request)))
            }}
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <Table aria-label={t('design_system.gallery.screens.recordList.title', 'Service requests')}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 font-normal">
                    <Checkbox
                      className={HIT_AREA_CLASS}
                      aria-label={t('design_system.gallery.screens.recordList.selectAll', 'Select all requests')}
                      checked={allSelected ? true : selected.length > 0 ? 'indeterminate' : false}
                      onCheckedChange={(next) => setSelectedIds(next === true ? visibleIds : [])}
                    />
                  </TableHead>
                  <TableHead className="font-normal">{t('design_system.gallery.screens.recordList.columns.request', 'Request')}</TableHead>
                  <TableHead className="hidden font-normal md:table-cell">{t('design_system.gallery.screens.recordList.columns.customer', 'Customer')}</TableHead>
                  <TableHead className="hidden font-normal lg:table-cell">{t('design_system.gallery.screens.recordList.columns.owner', 'Owner')}</TableHead>
                  <TableHead className="font-normal">{t('design_system.gallery.screens.recordList.columns.status', 'Status')}</TableHead>
                  <TableHead className="hidden text-right font-normal sm:table-cell">{t('design_system.gallery.screens.recordList.columns.due', 'Due')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((request) => {
                  const isSelected = selected.includes(request.id)
                  return (
                    <TableRow key={request.id} data-state={isSelected ? 'selected' : undefined} className={isSelected ? 'bg-muted/40' : undefined}>
                      <TableCell className="w-12">
                        <Checkbox
                          className={HIT_AREA_CLASS}
                          aria-label={t('design_system.gallery.screens.recordList.selectRow', 'Select {title}', { title: request.title })}
                          checked={isSelected}
                          onCheckedChange={(next) => toggleRow(request.id, next === true)}
                        />
                      </TableCell>
                      <TableCell className="sm:min-w-40">
                        <span className="block text-foreground">{request.title}</span>
                        <span className="block text-xs text-muted-foreground md:hidden">{request.customer}</span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{request.customer}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{request.owner}</TableCell>
                      <TableCell className="pr-4">
                        <StatusBadge variant={STATUS_TONE[request.status]} dot className="whitespace-nowrap">
                          {labels[request.status]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground sm:table-cell">
                        {dueFormat.format(new Date(`${request.due}T00:00:00Z`))}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {view === 'table' ? (
        <BulkActionBar
          ariaLabel={t('design_system.gallery.screens.recordList.bulkLabel', 'Actions for selected requests')}
          selectedCount={selected.length}
          actions={[
            { key: 'mark-done', label: t('design_system.gallery.screens.recordList.bulk.markDone', 'Mark as done'), icon: 'check-circle-2' },
            { key: 'assign-me', label: t('design_system.gallery.screens.recordList.bulk.assignMe', 'Assign to me'), icon: 'user-round' },
            { key: 'delete', label: t('design_system.gallery.screens.recordList.bulk.delete', 'Delete'), icon: 'trash-2', tone: 'destructive' },
          ]}
          onAction={runBulkAction}
          onClear={() => setSelectedIds([])}
        />
      ) : null}
      {ConfirmDialogElement}
    </ScreenFrame>
  )
}
