'use client'

import * as React from 'react'
import { SearchX } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { Kanban, applyMove, type KanbanCard, type KanbanColumn } from '@open-mercato/ui/blocks/kanban'
import { ListToolbar } from '@open-mercato/ui/blocks/list-toolbar'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { ScreenFrame, wait } from './frame'

type Translate = ReturnType<typeof useT>
type ColumnState = 'loading' | 'error'

export type BoardScreenProps = {
  initialColumnStates?: Record<string, ColumnState>
}

const CURRENT_USER = 'Mira Sandoval'

function buildColumns(t: Translate): KanbanColumn[] {
  const prefix = 'design_system.gallery.screens.board'
  return [
    {
      id: 'new',
      title: t(`${prefix}.stages.new`, 'New'),
      cards: [
        { id: 'deal-31', title: t(`${prefix}.deals.maintenancePlan`, 'Maintenance plan'), company: 'Alder Bakery', amount: 4800, owner: CURRENT_USER },
        { id: 'deal-32', title: t(`${prefix}.deals.scannerFleet`, 'Scanner fleet renewal'), company: 'Dunmore Freight', amount: 12600, owner: 'Tomas Reyes' },
        { id: 'deal-33', title: t(`${prefix}.deals.alarmUpgrade`, 'Alarm system upgrade'), company: 'Glasswing Labs', amount: 7300, owner: 'Ines Okafor' },
      ],
    },
    {
      id: 'qualified',
      title: t(`${prefix}.stages.qualified`, 'Qualified'),
      cards: [
        { id: 'deal-21', title: t(`${prefix}.deals.treatmentRooms`, 'Two treatment rooms'), company: 'Brightwater Clinic', amount: 18900, owner: CURRENT_USER },
        { id: 'deal-22', title: t(`${prefix}.deals.receptionRefit`, 'Reception refit'), company: 'Fernhill Hotel', amount: 9400, owner: 'Ines Okafor' },
      ],
    },
    {
      id: 'proposal',
      title: t(`${prefix}.stages.proposal`, 'Proposal sent'),
      cards: [
        { id: 'deal-11', title: t(`${prefix}.deals.classroomKit`, 'Classroom projector kit'), company: 'Harborview School', amount: 6200, owner: 'Tomas Reyes' },
        { id: 'deal-12', title: t(`${prefix}.deals.studioNetwork`, 'Studio network rebuild'), company: 'Copperline Studio', amount: 15400, owner: CURRENT_USER },
      ],
    },
    {
      id: 'won',
      title: t(`${prefix}.stages.won`, 'Won'),
      cards: [
        { id: 'deal-01', title: t(`${prefix}.deals.frontDesk`, 'Front desk terminals'), company: 'Elm Street Dental', amount: 5100, owner: 'Ines Okafor' },
      ],
    },
  ]
}

function textOf(card: KanbanCard, key: string): string {
  const value = card[key]
  return typeof value === 'string' ? value : ''
}

function amountOf(card: KanbanCard): number {
  return typeof card.amount === 'number' ? card.amount : 0
}

export function BoardScreen({ initialColumnStates = {} }: BoardScreenProps) {
  const t = useT()
  const locale = useLocale()
  const [columns, setColumns] = React.useState<KanbanColumn[]>(() => buildColumns(t))
  const [columnStates, setColumnStates] = React.useState<Record<string, ColumnState>>(initialColumnStates)
  const [query, setQuery] = React.useState('')
  const [onlyMine, setOnlyMine] = React.useState(false)
  const [view, setView] = React.useState('board')
  const createdCount = React.useRef(0)

  const money = React.useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    [locale],
  )
  const needle = query.trim().toLowerCase()
  const matches = (card: KanbanCard) =>
    (needle === '' || `${textOf(card, 'title')} ${textOf(card, 'company')}`.toLowerCase().includes(needle)) &&
    (!onlyMine || textOf(card, 'owner') === CURRENT_USER)

  const allLoaded = Object.keys(columnStates).length === 0
  const boardColumns: KanbanColumn[] = columns.map((column) => {
    const state = columnStates[column.id]
    if (state === 'loading') return { id: column.id, title: column.title, status: 'loading', cards: [] }
    if (state === 'error') {
      return {
        id: column.id,
        title: column.title,
        status: 'error',
        errorMessage: t('design_system.gallery.screens.board.columnError', 'Could not load this stage'),
        cards: [],
      }
    }
    const cards = column.cards.filter(matches)
    return {
      id: column.id,
      title: column.title,
      count: cards.length,
      summary: money.format(cards.reduce((total, card) => total + amountOf(card), 0)),
      cards,
    }
  })
  const visibleDeals = boardColumns.flatMap((column) => column.cards.map((card) => ({ card, stage: column.title })))
  const totalDeals = columns.reduce((total, column) => total + column.cards.length, 0)

  const createDeal = () => {
    createdCount.current += 1
    const deal: KanbanCard = {
      id: `deal-new-${createdCount.current}`,
      title: t('design_system.gallery.screens.board.newDealTitle', 'New deal {number}', { number: createdCount.current }),
      company: 'Alder Bakery',
      amount: 2500,
      owner: CURRENT_USER,
    }
    setColumns((current) => current.map((column, index) => (index === 0 ? { ...column, cards: [deal, ...column.cards] } : column)))
  }

  const retryColumns = async () => {
    setColumnStates((current) => Object.fromEntries(Object.keys(current).map((columnId) => [columnId, 'loading' as const])))
    await wait(800)
    setColumnStates({})
  }

  const renderDeal = (card: KanbanCard): React.ReactNode => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-foreground">{textOf(card, 'title')}</span>
        <span className="text-xs text-muted-foreground">{textOf(card, 'company')}</span>
      </div>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="text-sm tabular-nums text-foreground">{money.format(amountOf(card))}</span>
        <Avatar size="sm" label={textOf(card, 'owner')} className="font-normal" />
      </div>
    </div>
  )

  return (
    <ScreenFrame>
      <EntityHeader
        title={t('design_system.gallery.screens.board.title', 'Sales pipeline')}
        count={allLoaded ? totalDeals : undefined}
        subtitle={t('design_system.gallery.screens.board.subtitle', 'Deals by stage, with the total value in each one.')}
        actions={[{ key: 'create', label: t('design_system.gallery.screens.board.create', 'New deal'), icon: 'plus-square' }]}
        primaryActionKey="create"
        onAction={createDeal}
      />
      <div className="flex min-w-0 flex-col gap-4">
        <ListToolbar
          ariaLabel={t('design_system.gallery.screens.board.toolbarLabel', 'Pipeline tools')}
          search={{ value: query, placeholder: t('design_system.gallery.screens.board.searchPlaceholder', 'Search deals') }}
          onSearchChange={setQuery}
          quickFilters={[{ id: 'mine', label: t('design_system.gallery.screens.board.quick.mine', 'My deals'), icon: 'user', active: onlyMine }]}
          onQuickFilterToggle={(_filterId, next) => setOnlyMine(next)}
          views={[
            { id: 'table', label: t('design_system.gallery.screens.board.views.table', 'Table'), icon: 'rows' },
            { id: 'board', label: t('design_system.gallery.screens.board.views.board', 'Board'), icon: 'grid-3x3' },
          ]}
          activeViewId={view}
          onViewChange={setView}
        />
        {view === 'board' ? (
          <Kanban
            columns={boardColumns}
            renderCard={renderDeal}
            onMove={async (cardId, toColumnId, toIndex) => {
              setColumns((current) => applyMove(current, cardId, toColumnId, toIndex))
            }}
            onRetryColumn={() => void retryColumns()}
          />
        ) : visibleDeals.length === 0 ? (
          <div className="rounded-card border border-border">
            <EmptyState
              icon={<SearchX aria-hidden="true" className="size-5" />}
              title={t('design_system.gallery.screens.board.emptyTitle', 'No deals match')}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                    setOnlyMine(false)
                  }}
                >
                  {t('design_system.gallery.screens.board.clearFilters', 'Clear search and filters')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <Table aria-label={t('design_system.gallery.screens.board.title', 'Sales pipeline')}>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-normal">{t('design_system.gallery.screens.board.columns.deal', 'Deal')}</TableHead>
                  <TableHead className="hidden font-normal sm:table-cell">{t('design_system.gallery.screens.board.columns.company', 'Company')}</TableHead>
                  <TableHead className="font-normal">{t('design_system.gallery.screens.board.columns.stage', 'Stage')}</TableHead>
                  <TableHead className="hidden font-normal md:table-cell">{t('design_system.gallery.screens.board.columns.owner', 'Owner')}</TableHead>
                  <TableHead className="text-right font-normal">{t('design_system.gallery.screens.board.columns.amount', 'Amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleDeals.map(({ card, stage }) => (
                  <TableRow key={card.id}>
                    <TableCell className="sm:min-w-40">
                      <span className="block text-foreground">{textOf(card, 'title')}</span>
                      <span className="block text-xs text-muted-foreground sm:hidden">{textOf(card, 'company')}</span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{textOf(card, 'company')}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{stage}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{textOf(card, 'owner')}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-foreground">{money.format(amountOf(card))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ScreenFrame>
  )
}
