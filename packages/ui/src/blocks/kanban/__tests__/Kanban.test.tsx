/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { kanbanPropsSchema } from '../../contracts/kanban'
import type { KanbanCard, KanbanColumn, KanbanProps } from '../../contracts/kanban'
import { Kanban } from '../Kanban'
import { kanbanFixtures } from '../fixtures'

const dict = {
  'ui.blocks.kanban.boardLabel': 'Board columns',
  'ui.blocks.kanban.cardCount': '{count} cards',
  'ui.blocks.kanban.emptyDescription': 'Add a column to start organizing cards on this board.',
  'ui.blocks.kanban.retry': 'Try again',
  'ui.blocks.kanban.columnError': 'Could not load cards',
  'ui.blocks.kanban.columnLoading': 'Loading cards',
  'ui.blocks.kanban.dnd.cancelled': 'Moving the card was cancelled.',
  'ui.blocks.kanban.dnd.dropped': 'The card was dropped into {column}.',
  'ui.blocks.kanban.dnd.droppedOutside': 'The card was dropped outside the columns and returned to its place.',
  'ui.blocks.kanban.dnd.instructions': 'Drag a card with the pointer to move it to another column.',
  'ui.blocks.kanban.dnd.over': 'The card is over {column}.',
  'ui.blocks.kanban.dnd.overNothing': 'The card is not over a column.',
  'ui.blocks.kanban.dnd.pickedUp': 'Picked up card {position} of {total} from {column}.',
  'ui.blocks.kanban.empty': 'No columns to show',
  'ui.blocks.kanban.emptyColumn': 'No cards',
  'ui.blocks.kanban.error': 'Could not load the board',
  'ui.blocks.kanban.loading': 'Loading board',
  'ui.blocks.kanban.moveCard': 'Move card',
  'ui.blocks.kanban.moveTo': 'Move to',
  'ui.blocks.kanban.moved': 'The card was moved to {column}.',
  'ui.blocks.kanban.rejected': 'The card cannot move to {column}: {reason}',
  'ui.blocks.kanban.reverted': 'The move was undone.',
  'ui.blocks.kanban.showMore': 'Show more ({count})',
  'ui.blocks.kanban.showMoreNoCount': 'Show more',
}

function renderCard(card: KanbanCard, state: { pending: boolean; dragging: boolean }) {
  return (
    <span data-testid={`card-${card.id}`} data-pending={String(state.pending)}>
      {String(card.title)}
    </span>
  )
}

const baseColumns: KanbanColumn[] = [
  { id: 'lead', title: 'Lead', count: 2, cards: [{ id: 'd-1', title: 'Scanners' }, { id: 'd-2', title: 'Terminals' }] },
  { id: 'won', title: 'Won', count: 0, cards: [] },
  { id: 'lost', title: 'Lost', cards: [] },
]

function renderBoard(props: Partial<KanbanProps> = {}) {
  const merged: KanbanProps = {
    columns: baseColumns,
    onMove: jest.fn(async () => undefined),
    renderCard,
    ...props,
  }
  return renderWithProviders(<Kanban {...merged} />, { dict })
}

function columnEl(container: HTMLElement, columnId: string): HTMLElement {
  return container.querySelector(`[data-kanban-column-id="${columnId}"]`) as HTMLElement
}

function cardIdsIn(container: HTMLElement, columnId: string): string[] {
  return Array.from(columnEl(container, columnId).querySelectorAll('[data-kanban-card-id]')).map(
    (node) => node.getAttribute('data-kanban-card-id') as string,
  )
}

function moveButtonOf(container: HTMLElement, cardId: string): HTMLButtonElement {
  const card = container.querySelector(`[data-kanban-card-id="${cardId}"]`) as HTMLElement
  return within(card).getByRole('button', { name: 'Move card' }) as HTMLButtonElement
}

async function openMoveMenu(container: HTMLElement, cardId: string) {
  fireEvent.click(moveButtonOf(container, cardId))
  return screen.findByText('Move to')
}

describe('Kanban', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it.each(Object.entries(kanbanFixtures))('fixture %s parses against the contract and renders', (_name, fixture) => {
    expect(kanbanPropsSchema.safeParse(fixture).success).toBe(true)
    const { container } = renderWithProviders(<Kanban {...(fixture as KanbanProps)} />, { dict })
    expect(container.firstChild).not.toBeNull()
  })

  it('renders columns with title, count badge and summary without bold weight', () => {
    const { container } = renderBoard({
      columns: [{ ...baseColumns[0], summary: 'EUR 44,900' }, baseColumns[1]],
    })
    const lead = columnEl(container, 'lead')
    expect(within(lead).getByRole('heading', { name: 'Lead' }).className).not.toMatch(/font-(semibold|bold)/)
    expect(within(lead).getByText('2 cards')).toBeTruthy()
    expect(lead.querySelector('[data-slot="kanban-column-summary"]')?.textContent).toBe('EUR 44,900')
    expect(screen.getByRole('region', { name: 'Lead' })).toBe(lead)
  })

  it('replaces the header with columnHeader and keeps the region label', () => {
    renderBoard({ columnHeader: (column) => <div data-testid={`header-${column.id}`}>Custom {column.title}</div> })
    expect(screen.getByTestId('header-lead').textContent).toBe('Custom Lead')
    expect(screen.queryByRole('heading', { name: 'Lead' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Lead' })).toBeTruthy()
  })

  it('moves a card through the Move to menu and calls onMove with index 0', async () => {
    const onMove = jest.fn(async () => undefined)
    const { container } = renderBoard({ onMove })
    await openMoveMenu(container, 'd-2')
    expect(screen.queryByRole('option', { name: /Lead/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Won/ }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('d-2', 'won', 0))
    expect(screen.getByText('The card was moved to Won.')).toBeTruthy()
  })

  it('keeps the card in the target column, dims it and disables its move while pending', async () => {
    let settle: () => void = () => undefined
    const onMove = jest.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    const { container } = renderBoard({ onMove })
    await openMoveMenu(container, 'd-1')
    fireEvent.click(screen.getByRole('option', { name: /Won/ }))
    await waitFor(() => expect(cardIdsIn(container, 'won')).toEqual(['d-1']))
    expect(cardIdsIn(container, 'lead')).toEqual(['d-2'])
    const card = container.querySelector('[data-kanban-card-id="d-1"]') as HTMLElement
    expect(card.className).not.toContain('opacity-60')
    expect(card.querySelector('[data-slot="kanban-card-content"]')?.className).toContain('opacity-60')
    expect(card.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByTestId('card-d-1').getAttribute('data-pending')).toBe('true')
    expect(within(card).queryByRole('button', { name: 'Move card' })).toBeNull()
    expect(within(card).getByRole('status')).toBeTruthy()
    expect(within(columnEl(container, 'won')).getByText('1 cards')).toBeTruthy()
    await act(async () => {
      settle()
    })
    expect(cardIdsIn(container, 'won')).toEqual(['d-1'])
    expect(cardIdsIn(container, 'lead')).toEqual(['d-2'])
    expect(card.getAttribute('aria-busy')).toBeNull()
  })

  it('keeps a resolved move until the caller updates columns after onMove resolves', async () => {
    let settle: () => void = () => undefined
    const controls: { update: (next: KanbanColumn[]) => void } = { update: () => undefined }
    function Harness() {
      const [columns, setColumns] = React.useState(baseColumns)
      React.useEffect(() => {
        controls.update = setColumns
      }, [])
      return (
        <Kanban
          columns={columns}
          renderCard={renderCard}
          onMove={() => new Promise<void>((resolve) => { settle = resolve })}
        />
      )
    }
    const { container } = renderWithProviders(<Harness />, { dict })
    await openMoveMenu(container, 'd-1')
    fireEvent.click(screen.getByRole('option', { name: /Won/ }))
    await waitFor(() => expect(cardIdsIn(container, 'won')).toEqual(['d-1']))
    await act(async () => {
      settle()
    })
    expect(cardIdsIn(container, 'won')).toEqual(['d-1'])
    const moved = baseColumns.map((column) => {
      if (column.id === 'lead') return { ...column, cards: column.cards.filter((entry) => entry.id !== 'd-1') }
      if (column.id === 'won') return { ...column, cards: [{ id: 'd-1', title: 'Scanners' }, ...column.cards] }
      return column
    })
    await act(async () => {
      controls.update(moved)
    })
    expect(cardIdsIn(container, 'won')).toEqual(['d-1'])
    expect(cardIdsIn(container, 'lead')).toEqual(['d-2'])
  })

  it('reverts the card when onMove rejects and shows no error text', async () => {
    let fail: () => void = () => undefined
    const onMove = jest.fn(() => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('Conflict 409')) }))
    const { container } = renderBoard({ onMove })
    await openMoveMenu(container, 'd-1')
    fireEvent.click(screen.getByRole('option', { name: /Lost/ }))
    await waitFor(() => expect(cardIdsIn(container, 'lost')).toEqual(['d-1']))
    await act(async () => {
      fail()
    })
    expect(cardIdsIn(container, 'lead')).toEqual(['d-1', 'd-2'])
    expect(cardIdsIn(container, 'lost')).toEqual([])
    expect(screen.queryByText(/Conflict 409/)).toBeNull()
    expect(screen.getByText('The move was undone.')).toBeTruthy()
  })

  it('disables a column rejected by canMove and shows the reason', async () => {
    const onMove = jest.fn(async () => undefined)
    const canMove = jest.fn((_cardId: string, toColumnId: string) =>
      toColumnId === 'won' ? { reason: 'Add a close date first' } : (true as const),
    )
    const { container } = renderBoard({ onMove, canMove })
    await openMoveMenu(container, 'd-1')
    const won = screen.getByRole('option', { name: /Won/ })
    expect(won.getAttribute('aria-disabled')).toBe('true')
    expect(within(won).getByText('Add a close date first')).toBeTruthy()
    fireEvent.click(won)
    expect(onMove).not.toHaveBeenCalled()
    expect(cardIdsIn(container, 'lead')).toEqual(['d-1', 'd-2'])
    expect(screen.getByRole('option', { name: /Lost/ }).getAttribute('aria-disabled')).not.toBe('true')
  })

  it('offers only ready columns as move targets so a card cannot vanish into a loading or failed column', async () => {
    const onMove = jest.fn(async () => undefined)
    const { container } = renderBoard({
      onMove,
      columns: [
        baseColumns[0],
        { id: 'won', title: 'Won', status: 'loading', cards: [] },
        { id: 'lost', title: 'Lost', status: 'error', errorMessage: 'Could not load lost deals', cards: [] },
        { id: 'parked', title: 'Parked', cards: [] },
      ],
    })
    await openMoveMenu(container, 'd-1')
    expect(screen.queryByRole('option', { name: /Won/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /Lost/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Parked/ }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('d-1', 'parked', 0))
    expect(cardIdsIn(container, 'parked')).toEqual(['d-1'])
  })

  it('opens the card on click, Enter and Space but not from the move button', () => {
    const onCardOpen = jest.fn()
    const { container } = renderBoard({ onCardOpen })
    const card = container.querySelector('[data-kanban-card-id="d-1"]') as HTMLElement
    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.click(card)
    expect(onCardOpen).toHaveBeenCalledTimes(3)
    expect(onCardOpen).toHaveBeenCalledWith('d-1')
    fireEvent.click(moveButtonOf(container, 'd-1'))
    expect(onCardOpen).toHaveBeenCalledTimes(3)
  })

  it('makes cards focusable with a focus ring and draggable semantics', () => {
    const { container } = renderBoard()
    const card = container.querySelector('[data-kanban-card-id="d-1"]') as HTMLElement
    expect(card.getAttribute('tabindex')).toBe('0')
    expect(card.getAttribute('aria-roledescription')).toBeTruthy()
    expect(card.className).toContain('focus-visible:shadow-focus')
    const actions = card.querySelector('[data-slot="kanban-card-actions"]') as HTMLElement
    expect(actions.className).toContain('[@media(hover:none)]:opacity-100')
    expect(actions.className).toContain('group-focus-within:opacity-100')
    expect(actions.className).toContain('absolute')
    expect(actions.contains(moveButtonOf(container, 'd-1'))).toBe(true)
    expect(moveButtonOf(container, 'd-1').className).toContain('size-8')
  })

  it('renders cards listed in pendingCardIds as pending without a user move', () => {
    const { container } = renderBoard({ pendingCardIds: ['d-2'] })
    const pendingCard = container.querySelector('[data-kanban-card-id="d-2"]') as HTMLElement
    const idleCard = container.querySelector('[data-kanban-card-id="d-1"]') as HTMLElement
    expect(pendingCard.getAttribute('data-pending')).toBe('true')
    expect(pendingCard.getAttribute('aria-busy')).toBe('true')
    expect(pendingCard.getAttribute('aria-disabled')).toBe('true')
    expect(pendingCard.querySelector('[data-slot="kanban-card-pending"]')).not.toBeNull()
    expect(within(pendingCard).queryByRole('button', { name: 'Move card' })).toBeNull()
    expect(screen.getByTestId('card-d-2').getAttribute('data-pending')).toBe('true')
    expect(idleCard.getAttribute('data-pending')).toBeNull()
    expect(idleCard.getAttribute('aria-disabled')).toBe('false')
    expect(within(idleCard).getByRole('button', { name: 'Move card' })).toBeTruthy()
  })

  it('merges pendingCardIds with cards that are pending after a move', async () => {
    const onMove = jest.fn(() => new Promise<void>(() => undefined))
    const { container } = renderBoard({ onMove, pendingCardIds: ['d-2'] })
    await openMoveMenu(container, 'd-1')
    fireEvent.click(screen.getByRole('option', { name: /Won/ }))
    await waitFor(() => expect(cardIdsIn(container, 'won')).toEqual(['d-1']))
    expect(container.querySelectorAll('[data-slot="kanban-card"][data-pending="true"]')).toHaveLength(2)
  })

  it('shows the grip only on reorderable boards and never on a pending card', () => {
    const plain = renderBoard()
    expect(plain.container.querySelector('[data-slot="kanban-card-grip"]')).toBeNull()
    plain.unmount()
    const { container } = renderBoard({ reorderable: true, pendingCardIds: ['d-2'] })
    const grip = container.querySelector('[data-kanban-card-id="d-1"] [data-slot="kanban-card-grip"]') as HTMLElement
    expect(grip.getAttribute('aria-hidden')).toBe('true')
    expect(grip.className).toContain('absolute')
    expect(grip.className).toContain('[@media(hover:none)]:opacity-100')
    expect(container.querySelector('[data-kanban-card-id="d-2"] [data-slot="kanban-card-grip"]')).toBeNull()
  })

  it('labels the scroll region and marks the overflowing edge', () => {
    const { container } = renderBoard()
    const board = container.querySelector('[data-slot="kanban-board"]') as HTMLElement
    expect(screen.getByRole('group', { name: 'Board columns' })).toBe(board)
    expect(board.getAttribute('tabindex')).toBeNull()
    const fadeEnd = container.querySelector('[data-slot="kanban-scroll-fade-end"]') as HTMLElement
    const fadeStart = container.querySelector('[data-slot="kanban-scroll-fade-start"]') as HTMLElement
    expect(fadeEnd.className).toContain('opacity-0')
    Object.defineProperty(board, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(board, 'scrollWidth', { configurable: true, value: 900 })
    fireEvent.scroll(board)
    expect(board.getAttribute('tabindex')).toBe('0')
    expect(board.getAttribute('data-overflow-end')).toBe('true')
    expect(fadeEnd.className).toContain('opacity-100')
    expect(fadeStart.className).toContain('opacity-0')
    board.scrollLeft = 600
    fireEvent.scroll(board)
    expect(board.getAttribute('data-overflow-end')).toBeNull()
    expect(fadeEnd.className).toContain('opacity-0')
    expect(fadeStart.className).toContain('opacity-100')
  })

  it('hides the count badge for a zero count and for columns that are not ready', () => {
    const { container } = renderBoard({
      columns: [
        baseColumns[0],
        baseColumns[1],
        { id: 'lost', title: 'Lost', count: 7, status: 'error', cards: [] },
        { id: 'parked', title: 'Parked', count: 4, status: 'loading', cards: [] },
      ],
    })
    expect(columnEl(container, 'lead').querySelector('[data-slot="kanban-column-count"]')).not.toBeNull()
    expect(columnEl(container, 'won').querySelector('[data-slot="kanban-column-count"]')).toBeNull()
    expect(columnEl(container, 'lost').querySelector('[data-slot="kanban-column-count"]')).toBeNull()
    expect(columnEl(container, 'parked').querySelector('[data-slot="kanban-column-count"]')).toBeNull()
  })

  it('offers a retry action on a failed column only when onRetryColumn is passed', () => {
    const failed: KanbanColumn[] = [baseColumns[0], { id: 'won', title: 'Won', status: 'error', cards: [] }]
    const first = renderBoard({ columns: failed })
    expect(screen.getByText('Could not load cards')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    first.unmount()
    const onRetryColumn = jest.fn()
    const { container } = renderBoard({ columns: failed, onRetryColumn })
    fireEvent.click(within(columnEl(container, 'won')).getByRole('button', { name: 'Try again' }))
    expect(onRetryColumn).toHaveBeenCalledWith('won')
  })

  it('renders skeleton cards for a loading column', () => {
    const { container } = renderBoard({
      columns: [baseColumns[0], { id: 'won', title: 'Won', status: 'loading', cards: [] }],
    })
    const loading = columnEl(container, 'won').querySelector('[data-slot="kanban-column-loading"]') as HTMLElement
    expect(loading.getAttribute('aria-busy')).toBe('true')
    expect(loading.querySelectorAll('[data-slot="kanban-skeleton-card"]').length).toBeGreaterThan(0)
  })

  it('renders the board loading state as skeleton columns', () => {
    const { container } = renderBoard({ status: 'loading' })
    const root = container.querySelector('[data-slot="kanban"]') as HTMLElement
    expect(root.getAttribute('aria-busy')).toBe('true')
    expect(root.querySelectorAll('[data-slot="kanban-skeleton-column"]').length).toBeGreaterThan(1)
    expect(root.querySelectorAll('[data-slot="kanban-skeleton-card"]').length).toBeGreaterThan(1)
  })

  it('offers a board retry when onRetry is passed and describes the empty board', () => {
    const onRetry = jest.fn()
    const failed = renderBoard({ status: 'error', onRetry })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    failed.unmount()
    const plain = renderBoard({ status: 'error' })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    plain.unmount()
    renderBoard({ status: 'empty' })
    expect(screen.getByText('Add a column to start organizing cards on this board.')).toBeTruthy()
  })

  it('keeps fixture counts equal to the visible cards unless the column pages', () => {
    Object.entries(kanbanFixtures).forEach(([, fixture]) => {
      ;(fixture as KanbanProps).columns.forEach((column) => {
        if (column.hasMore || column.count === undefined) return
        expect(column.count).toBe(column.cards.length)
      })
    })
    expect(kanbanFixtures.showMore.columns.some((column) => column.hasMore)).toBe(true)
    expect(kanbanFixtures.pending.pendingCardIds.length).toBeGreaterThan(0)
  })

  it.each([
    ['resolve', true],
    ['reject', false],
  ])('shows Show more (N), spins while loading and recovers after %s', async (_label, shouldResolve) => {
    let settle: () => void = () => undefined
    const onLoadMoreColumn = jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = shouldResolve ? resolve : () => reject(new Error('failed'))
        }),
    )
    const { container } = renderBoard({
      columns: [{ ...baseColumns[0], count: 30, remaining: 28, hasMore: true }, baseColumns[1]],
      onLoadMoreColumn,
    })
    const button = screen.getByRole('button', { name: /Show more \(28\)/ }) as HTMLButtonElement
    fireEvent.click(button)
    expect(onLoadMoreColumn).toHaveBeenCalledWith('lead')
    await waitFor(() => expect(button.disabled).toBe(true))
    expect(within(columnEl(container, 'lead')).getAllByRole('status').length).toBeGreaterThan(0)
    await act(async () => {
      settle()
    })
    expect(button.disabled).toBe(false)
  })

  it('falls back to Show more without a remaining count', () => {
    renderBoard({ columns: [{ ...baseColumns[0], hasMore: true }], onLoadMoreColumn: jest.fn(async () => undefined) })
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
  })

  it('renders empty columns with the default text or emptyColumn', () => {
    const { container, unmount } = renderBoard()
    expect(within(columnEl(container, 'won')).getByText('No cards')).toBeTruthy()
    unmount()
    renderBoard({ emptyColumn: (column) => <p>Drop deals into {column.title}</p> })
    expect(screen.getByText('Drop deals into Won')).toBeTruthy()
  })

  it('renders per-column loading and error states without replacing the board', () => {
    const { container } = renderBoard({
      columns: [
        baseColumns[0],
        { id: 'won', title: 'Won', status: 'error', errorMessage: 'Could not load won deals', cards: [] },
        { id: 'lost', title: 'Lost', status: 'loading', cards: [] },
      ],
      columnFooter: (column) => <button type="button">Add to {column.title}</button>,
    })
    expect(within(columnEl(container, 'won')).getByText('Could not load won deals')).toBeTruthy()
    expect(within(columnEl(container, 'lost')).getByText('Loading cards')).toBeTruthy()
    expect(cardIdsIn(container, 'lead')).toEqual(['d-1', 'd-2'])
    expect(screen.getByRole('button', { name: 'Add to Lead' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to Won' })).toBeNull()
  })

  it('renders the trailing slot after the columns', () => {
    const { container } = renderBoard({ trailing: <button type="button">Add stage</button> })
    const board = container.querySelector('[data-slot="kanban-board"]') as HTMLElement
    expect(board.lastElementChild?.getAttribute('data-slot')).toBe('kanban-trailing')
    expect(board.className).toContain('overflow-x-auto')
    expect(board.className).toContain('snap-x')
  })

  it.each([
    ['loading', { status: 'loading' as const }, 'Loading board'],
    ['error', { status: 'error' as const }, 'Could not load the board'],
    ['error with message', { status: 'error' as const, errorMessage: 'Pipeline unavailable' }, 'Pipeline unavailable'],
    ['empty', { status: 'empty' as const }, 'No columns to show'],
    ['no columns', { columns: [] }, 'No columns to show'],
  ])('renders the board %s state', (_label, patch, text) => {
    const { container } = renderBoard(patch)
    expect(screen.getByText(text)).toBeTruthy()
    expect(container.querySelector('[data-slot="kanban-board"]')).toBeNull()
  })

  it('renders a custom emptyState slot', () => {
    renderBoard({ status: 'empty', emptyState: <p>Create your first stage</p> })
    expect(screen.getByText('Create your first stage')).toBeTruthy()
  })

  it('exposes a polite live region for announcements', () => {
    const { container } = renderBoard()
    const region = container.querySelector('[data-slot="kanban-live-region"]') as HTMLElement
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('role')).toBe('status')
  })
})
