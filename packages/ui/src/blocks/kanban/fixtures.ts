import * as React from 'react'
import { Plus } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import type { KanbanCard, KanbanCardRenderState, KanbanColumn, KanbanProps } from '../contracts/kanban'

function textField(card: KanbanCard, key: string): string {
  const value = card[key]
  return typeof value === 'string' ? value : ''
}

function numberField(card: KanbanCard, key: string): number {
  const value = card[key]
  return typeof value === 'number' ? value : 0
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function formatAmount(value: number): string {
  return currency.format(value)
}

function renderDeal(card: KanbanCard, _state: KanbanCardRenderState): React.ReactNode {
  const owner = textField(card, 'owner')
  const closeDate = textField(card, 'closeDate')
  return React.createElement(
    'div',
    { className: 'flex flex-col gap-2' },
    React.createElement(
      'div',
      { className: 'flex flex-col gap-0.5' },
      React.createElement('span', { className: 'text-sm text-foreground' }, textField(card, 'title')),
      React.createElement('span', { className: 'text-xs text-muted-foreground' }, textField(card, 'company')),
    ),
    React.createElement(
      'div',
      { className: 'flex items-center justify-between gap-2' },
      React.createElement('span', { className: 'text-sm tabular-nums text-foreground' }, formatAmount(numberField(card, 'amount'))),
      React.createElement(
        'span',
        { className: 'flex items-center gap-2' },
        closeDate
          ? React.createElement('span', { className: 'text-xs text-muted-foreground' }, closeDate)
          : null,
        owner ? React.createElement(Avatar, { size: 'sm', label: owner }) : null,
      ),
    ),
  )
}

const priorityVariant = { high: 'error', normal: 'neutral', low: 'muted' } as const
type Priority = keyof typeof priorityVariant

function priorityOf(card: KanbanCard): Priority {
  const value = textField(card, 'priority')
  return value === 'high' || value === 'low' ? value : 'normal'
}

function renderTask(card: KanbanCard, _state: KanbanCardRenderState): React.ReactNode {
  const priority = priorityOf(card)
  const assignee = textField(card, 'assignee')
  return React.createElement(
    'div',
    { className: 'flex flex-col gap-2' },
    React.createElement('span', { className: 'text-sm text-foreground' }, textField(card, 'title')),
    React.createElement(
      'div',
      { className: 'flex items-center justify-between gap-2' },
      React.createElement(
        Badge,
        { variant: priorityVariant[priority], size: 20 },
        textField(card, 'priorityLabel'),
      ),
      React.createElement(
        'span',
        { className: 'flex items-center gap-2 text-xs text-muted-foreground' },
        textField(card, 'estimate'),
        assignee ? React.createElement(Avatar, { size: 'sm', label: assignee }) : null,
      ),
    ),
  )
}

const dealsByStage: Record<string, KanbanCard[]> = {
  lead: [
    { id: 'deal-101', title: 'Warehouse scanners rollout', company: 'Nordlicht Logistics', amount: 18400, owner: 'Anna Nowak' },
    { id: 'deal-102', title: 'POS terminals for 12 stores', company: 'Verde Market', amount: 26500, owner: 'Jan Kowalski' },
    { id: 'deal-103', title: 'Annual support renewal', company: 'Baltic Foods', amount: 9800, owner: 'Maria Wisniewska' },
  ],
  qualified: [
    { id: 'deal-201', title: 'B2B portal pilot', company: 'Kestrel Tools', amount: 42000, owner: 'Anna Nowak', closeDate: 'Dec 12' },
    { id: 'deal-202', title: 'Inventory sync integration', company: 'Oakline Furniture', amount: 15200, owner: 'Piotr Zielinski' },
  ],
  proposal: [
    { id: 'deal-301', title: 'Multi-warehouse upgrade', company: 'Atlas Parts', amount: 67000, owner: 'Jan Kowalski', closeDate: 'Dec 20' },
  ],
  negotiation: [
    { id: 'deal-401', title: 'Subscription billing module', company: 'Lumen Studio', amount: 31500, owner: 'Maria Wisniewska', closeDate: 'Nov 30' },
    { id: 'deal-402', title: 'Field service licences', company: 'Harbor Energy', amount: 23900, owner: 'Piotr Zielinski' },
  ],
  won: [
    { id: 'deal-501', title: 'Returns portal', company: 'Fjord Outdoor', amount: 12700, owner: 'Anna Nowak', closeDate: 'Nov 18' },
  ],
}

const stageTitles: Record<string, string> = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
}

const stageTotals: Record<string, number> = { lead: 24, qualified: 8, proposal: 5, negotiation: 3, won: 12 }

function sumOf(cards: KanbanCard[]): number {
  return cards.reduce((total, card) => total + numberField(card, 'amount'), 0)
}

function pipelineColumns(options: { summaries?: boolean } = {}): KanbanColumn[] {
  return Object.keys(stageTitles).map((stageId) => ({
    id: stageId,
    title: stageTitles[stageId],
    count: stageTotals[stageId],
    summary: options.summaries ? formatAmount(sumOf(dealsByStage[stageId])) : undefined,
    cards: dealsByStage[stageId],
  }))
}

function dealCanMove(cardId: string, toColumnId: string): true | { reason: string } {
  if (toColumnId !== 'won') return true
  const deal = Object.values(dealsByStage)
    .flat()
    .find((card) => card.id === cardId)
  if (deal && textField(deal, 'closeDate')) return true
  return { reason: 'Add a close date before marking the deal as won' }
}

const taskColumns: KanbanColumn[] = [
  {
    id: 'todo',
    title: 'To do',
    count: 4,
    cards: [
      { id: 'task-1', title: 'Prepare Q1 price list', assignee: 'Anna Nowak', priority: 'high', priorityLabel: 'High', estimate: '3h' },
      { id: 'task-2', title: 'Update shipping zones', assignee: 'Jan Kowalski', priority: 'normal', priorityLabel: 'Normal', estimate: '1h' },
      { id: 'task-3', title: 'Clean up duplicate customers', priority: 'low', priorityLabel: 'Low', estimate: '2h' },
      { id: 'task-4', title: 'Review supplier contract', assignee: 'Maria Wisniewska', priority: 'normal', priorityLabel: 'Normal', estimate: '45m' },
    ],
  },
  {
    id: 'in-progress',
    title: 'In progress',
    count: 2,
    cards: [
      { id: 'task-5', title: 'Migrate product images', assignee: 'Piotr Zielinski', priority: 'high', priorityLabel: 'High', estimate: '5h' },
      { id: 'task-6', title: 'Draft holiday campaign', assignee: 'Anna Nowak', priority: 'normal', priorityLabel: 'Normal', estimate: '2h' },
    ],
  },
  {
    id: 'review',
    title: 'Review',
    count: 1,
    cards: [
      { id: 'task-7', title: 'Approve new tax rates', assignee: 'Jan Kowalski', priority: 'high', priorityLabel: 'High', estimate: '30m' },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    count: 9,
    cards: [
      { id: 'task-8', title: 'Set up returns workflow', assignee: 'Maria Wisniewska', priority: 'low', priorityLabel: 'Low', estimate: '4h' },
    ],
  },
]

const noop = (): void => undefined
const noopAsync = async (): Promise<void> => undefined
const neverSettles = (): Promise<void> => new Promise<void>(() => undefined)
const slowLoad = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 1200))

const pipelineBase = {
  onMove: noopAsync,
  canMove: dealCanMove,
  onCardOpen: noop,
  renderCard: renderDeal,
}

const tasksBase = {
  onMove: noopAsync,
  onCardOpen: noop,
  renderCard: renderTask,
}

function addCardFooter(label: string) {
  return (column: KanbanColumn) =>
    React.createElement(
      Button,
      { type: 'button', variant: 'ghost', size: 'sm', className: 'w-full justify-start', 'aria-label': `${label}: ${column.title}` },
      React.createElement(Plus, { 'aria-hidden': true }),
      label,
    )
}

const addStageColumn = React.createElement(
  'div',
  { className: 'flex w-72 items-center justify-center rounded-card border-2 border-dashed border-border p-3' },
  React.createElement(
    Button,
    { type: 'button', variant: 'ghost', size: 'sm' },
    React.createElement(Plus, { 'aria-hidden': true }),
    'Add stage',
  ),
)

export const kanbanFixtures = {
  default: {
    ...pipelineBase,
    columns: pipelineColumns(),
  },
  withSummaries: {
    ...pipelineBase,
    columns: pipelineColumns({ summaries: true }),
  },
  reorderable: {
    ...tasksBase,
    reorderable: true,
    columns: taskColumns,
  },
  emptyColumn: {
    ...tasksBase,
    columns: taskColumns.map((column) => (column.id === 'review' ? { ...column, count: 0, cards: [] } : column)),
    emptyColumn: (column: KanbanColumn) =>
      React.createElement(
        'p',
        { className: 'rounded-card border-2 border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground' },
        `Nothing in ${column.title} yet`,
      ),
  },
  showMore: {
    ...pipelineBase,
    columns: pipelineColumns({ summaries: true }).map((column) => ({
      ...column,
      hasMore: (column.count ?? 0) > column.cards.length,
      remaining: Math.max(0, (column.count ?? 0) - column.cards.length),
    })),
    onLoadMoreColumn: slowLoad,
  },
  pending: {
    ...tasksBase,
    columns: taskColumns,
    onMove: neverSettles,
  },
  columnError: {
    ...pipelineBase,
    columns: pipelineColumns().map((column) => {
      if (column.id === 'proposal') return { ...column, status: 'error' as const, errorMessage: 'Could not load deals in Proposal', cards: [] }
      if (column.id === 'negotiation') return { ...column, status: 'loading' as const, cards: [] }
      return column
    }),
  },
  withTrailingAndFooter: {
    ...pipelineBase,
    columns: pipelineColumns({ summaries: true }),
    columnFooter: addCardFooter('Add deal'),
    trailing: addStageColumn,
  },
  loading: { ...pipelineBase, columns: [], status: 'loading' },
  error: { ...pipelineBase, columns: [], status: 'error', errorMessage: 'Could not load the pipeline' },
  empty: { ...pipelineBase, columns: [], status: 'empty' },
} satisfies Record<string, KanbanProps>

export type KanbanFixtureName = keyof typeof kanbanFixtures
