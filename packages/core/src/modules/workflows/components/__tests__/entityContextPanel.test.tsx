/**
 * @jest-environment jsdom
 */

/**
 * The one panel both work surfaces render (spec §6.2).
 *
 * The task detail's right column and the record-page pending-work widget are
 * the same component fed by two pure mappers, so what is asserted here is what
 * neither surface may get wrong: a bound record deep-links when its type has a
 * detail page, DEGRADES to a labelled row when it does not or when the id is
 * missing, and every work chip carries an icon and a label rather than colour
 * alone.
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="icon-AlertTriangle" />,
  ArrowDown: () => <span data-testid="icon-ArrowDown" />,
  ArrowUp: () => <span data-testid="icon-ArrowUp" />,
  CheckCircle2: () => <span data-testid="icon-CheckCircle2" />,
  Circle: () => <span data-testid="icon-Circle" />,
  Clock: () => <span data-testid="icon-Clock" />,
  Flame: () => <span data-testid="icon-Flame" />,
  Loader: () => <span data-testid="icon-Loader" />,
  Minus: () => <span data-testid="icon-Minus" />,
  XCircle: () => <span data-testid="icon-XCircle" />,
}))

import {
  EntityContextPanel,
  bindingsToEntityContextItems,
  workItemsToEntityContextItems,
} from '../work-inbox/EntityContextPanel'

const LINK_LABEL = 'Open record'
const NO_LINK = 'No detail page'

function renderPanel(items: ReturnType<typeof bindingsToEntityContextItems>) {
  return render(
    <EntityContextPanel
      title="About what"
      items={items}
      emptyLabel="Nothing linked"
      linkLabel={LINK_LABEL}
    />,
  )
}

describe('bindings → panel items', () => {
  test('deep-links a record whose type has a detail page', () => {
    const items = bindingsToEntityContextItems(
      [{ entityType: 'customers:person', entityId: 'person-1', label: 'Ada Lovelace' }],
      { noLink: NO_LINK },
    )
    renderPanel(items)

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText(LINK_LABEL).getAttribute('href')).toBe(
      '/backend/customers/people-v2/person-1',
    )
  })

  test('degrades when the record type has no detail page', () => {
    const items = bindingsToEntityContextItems(
      [{ entityType: 'inventory:bin', entityId: 'bin-1', label: 'Bin 1' }],
      { noLink: NO_LINK },
    )
    renderPanel(items)

    expect(screen.queryByText(LINK_LABEL)).toBeNull()
    expect(screen.getByText(NO_LINK)).toBeTruthy()
  })

  test('degrades when the binding carries no id at all', () => {
    const items = bindingsToEntityContextItems(
      [{ entityType: 'customers:person', entityId: '', label: 'Unknown customer' }],
      { noLink: NO_LINK },
    )
    renderPanel(items)

    expect(screen.queryByText(LINK_LABEL)).toBeNull()
    expect(screen.getByText(NO_LINK)).toBeTruthy()
  })

  test('falls back to the record type when the author wrote no label', () => {
    const items = bindingsToEntityContextItems(
      [{ entityType: 'customers:deal', entityId: 'deal-1' }],
      { noLink: NO_LINK },
    )
    expect(items[0].title).toBe('customers:deal')
  })

  test('renders the empty state when the task is about nothing', () => {
    renderPanel(bindingsToEntityContextItems([], { noLink: NO_LINK }))
    expect(screen.getByText('Nothing linked')).toBeTruthy()
  })
})

describe('work items → panel items', () => {
  const labels = {
    status: (status: string) => `status:${status}`,
    priority: (priority: string) => `priority:${priority}`,
    overdue: 'Overdue',
    due: (formatted: string) => `Due ${formatted}`,
  }

  test('pairs every chip with an icon and a label, never colour alone', () => {
    const items = workItemsToEntityContextItems(
      [
        {
          id: 'task-1',
          title: 'Approve refund',
          status: 'PENDING',
          priority: 'high',
          dueDate: '2026-07-01T10:00:00.000Z',
          overdue: true,
          detailHref: '/backend/tasks/task-1',
        },
      ],
      labels,
    )

    render(
      <EntityContextPanel
        title="Pending work"
        items={items}
        emptyLabel="Nothing open"
        linkLabel="Open task"
      />,
    )

    expect(screen.getByText('status:PENDING')).toBeTruthy()
    expect(screen.getByText('priority:high')).toBeTruthy()
    expect(screen.getByText('Overdue')).toBeTruthy()
    // Clock = PENDING, ArrowUp = high, AlertTriangle = overdue.
    expect(screen.getByTestId('icon-Clock')).toBeTruthy()
    expect(screen.getByTestId('icon-ArrowUp')).toBeTruthy()
    expect(screen.getByTestId('icon-AlertTriangle')).toBeTruthy()
    expect(screen.getByText('Open task').getAttribute('href')).toBe('/backend/tasks/task-1')
  })

  test('omits the priority chip for unprioritized work rather than inventing one', () => {
    const items = workItemsToEntityContextItems(
      [
        {
          id: 'task-2',
          title: 'Check address',
          status: 'IN_PROGRESS',
          priority: null,
          dueDate: null,
          overdue: false,
          detailHref: '/backend/tasks/task-2',
        },
      ],
      labels,
    )
    expect(items[0].chips).toHaveLength(1)
    expect(items[0].subtitle).toBeNull()
  })
})
