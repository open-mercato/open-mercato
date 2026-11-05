/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EventPeekPopover } from '../EventPeekPopover'
import type { CalendarItem } from '../types'

const dict = {
  'customers.calendar.peek.edit': 'Edit',
  'customers.calendar.peek.editForbidden': "You don't have permission to edit events",
  'customers.calendar.peek.join': 'Join',
  'customers.calendar.grid.untitled': 'Untitled',
}

function buildItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  const start = new Date('2026-06-26T10:00:00.000Z')
  const end = new Date('2026-06-26T11:00:00.000Z')
  return {
    id: 'item-1',
    title: 'Quarterly review',
    interactionType: 'meeting',
    category: 'meeting',
    status: 'planned',
    start,
    end,
    allDay: false,
    location: null,
    platform: null,
    locationKind: null,
    participants: [],
    ownerUserId: null,
    entityId: null,
    dealId: null,
    color: null,
    isRecurringOccurrence: false,
    updatedAt: null,
    raw: { id: 'item-1', interactionType: 'meeting', status: 'planned' },
    ...overrides,
  }
}

type PopoverOverrides = Partial<React.ComponentProps<typeof EventPeekPopover>>

function renderPopoverWith(overrides: PopoverOverrides = {}) {
  return renderWithProviders(
    <EventPeekPopover
      item={buildItem()}
      open
      joinUrl={null}
      aiSummaries={false}
      canManage
      onOpenChange={jest.fn()}
      onJoin={jest.fn()}
      onEdit={jest.fn()}
      {...overrides}
    >
      <button type="button">trigger</button>
    </EventPeekPopover>,
    { dict },
  )
}

function renderPopover(canManage: boolean, onEdit: jest.Mock, onOpenChange: jest.Mock) {
  return renderPopoverWith({ canManage, onEdit, onOpenChange })
}

describe('EventPeekPopover — edit permission gating (#3649)', () => {
  it('opens the editor when the user can manage interactions', () => {
    const onEdit = jest.fn()
    const onOpenChange = jest.fn()
    renderPopover(true, onEdit, onOpenChange)

    const editButton = screen.getByRole('button', { name: 'Edit' })
    expect(editButton).not.toBeDisabled()

    fireEvent.click(editButton)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('disables the Edit button and never calls onEdit when the user cannot manage interactions', () => {
    const onEdit = jest.fn()
    const onOpenChange = jest.fn()
    renderPopover(false, onEdit, onOpenChange)

    const editButton = screen.getByRole('button', { name: 'Edit' })
    expect(editButton).toBeDisabled()

    fireEvent.click(editButton)
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('EventPeekPopover — Join affordance is independent of AI summaries (#5153)', () => {
  it('renders Join for a joinable event even when AI summaries are disabled', () => {
    const onJoin = jest.fn()
    renderPopoverWith({ joinUrl: 'https://meet.example.com/abc', aiSummaries: false, onJoin })

    const joinButton = screen.getByRole('button', { name: 'Join' })
    fireEvent.click(joinButton)
    expect(onJoin).toHaveBeenCalledTimes(1)
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('renders Join for a joinable event when AI summaries are enabled', () => {
    renderPopoverWith({ joinUrl: 'https://meet.example.com/abc', aiSummaries: true })

    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
  })

  it('hides Join when the event has no meeting URL', () => {
    renderPopoverWith({ joinUrl: null, aiSummaries: true })

    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
  })
})

describe('EventPeekPopover — configurable popover side (#5153)', () => {
  it('defaults to the right side so existing callers are unchanged', () => {
    renderPopoverWith()

    expect(screen.getByText('Quarterly review').closest('[data-side]')).toHaveAttribute('data-side', 'right')
  })

  it('honours an explicit side for wide triggers', () => {
    renderPopoverWith({ side: 'bottom' })

    expect(screen.getByText('Quarterly review').closest('[data-side]')).toHaveAttribute('data-side', 'bottom')
  })
})

describe('EventPeekPopover — Cancel event action', () => {
  it('closes the peek, then cancels the planned event', () => {
    const calls: string[] = []
    const onOpenChange = jest.fn(() => calls.push('close'))
    const onCancel = jest.fn(() => {
      calls.push('cancel')
    })
    renderPopoverWith({ onCancel, onOpenChange })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
    expect(calls).toEqual(['close', 'cancel'])
  })

  it.each(['done', 'canceled'] as const)('is not offered for a %s event', (status) => {
    renderPopoverWith({ item: buildItem({ status }), onCancel: jest.fn() })

    expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument()
  })

  it('is not offered to a user who cannot manage interactions', () => {
    renderPopoverWith({ canManage: false, onCancel: jest.fn() })

    expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument()
  })

  it('is not offered when the host passes no cancel handler', () => {
    renderPopoverWith()

    expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument()
  })
})

describe('EventPeekPopover — status badges', () => {
  it('shows Done for a done event', () => {
    renderPopoverWith({ item: buildItem({ status: 'done' }) })

    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByText('Canceled')).not.toBeInTheDocument()
  })

  it('shows Canceled and strikes the title through for a canceled event', () => {
    renderPopoverWith({ item: buildItem({ status: 'canceled' }) })

    expect(screen.getByText('Canceled')).toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
    expect(screen.getByText('Quarterly review').className).toContain('line-through')
  })

  it('shows no status badge for a planned event', () => {
    renderPopoverWith()

    expect(screen.queryByText('Done')).not.toBeInTheDocument()
    expect(screen.queryByText('Canceled')).not.toBeInTheDocument()
    expect(screen.getByText('Quarterly review').className).not.toContain('line-through')
  })
})

describe('EventPeekPopover — Open event button', () => {
  it('closes the peek and opens the editor', () => {
    const onEdit = jest.fn()
    const onOpenChange = jest.fn()
    renderPopoverWith({ onEdit, onOpenChange })

    fireEvent.click(screen.getByRole('button', { name: 'Open event' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('is hidden from a user who cannot manage interactions', () => {
    renderPopoverWith({ canManage: false })

    expect(screen.queryByRole('button', { name: 'Open event' })).not.toBeInTheDocument()
  })
})

describe('EventPeekPopover — AI summaries setting', () => {
  const summarized = buildItem({
    location: 'zoom.us/j/1',
    locationKind: 'platform',
    platform: 'zoom',
    participants: [{ userId: 'user-1', name: 'Ada Lovelace' }],
  })

  it('shows the platform and attendee rows when the setting is on', () => {
    renderPopoverWith({ item: summarized, aiSummaries: true })

    expect(screen.getByText('Zoom')).toBeInTheDocument()
    expect(screen.getByText('1 attendee')).toBeInTheDocument()
  })

  it('shows them by default when the host does not pass the setting', () => {
    renderPopoverWith({ item: summarized, aiSummaries: undefined })

    expect(screen.getByText('Zoom')).toBeInTheDocument()
    expect(screen.getByText('1 attendee')).toBeInTheDocument()
  })

  it('hides the platform and attendee rows when the setting is off', () => {
    renderPopoverWith({ item: summarized, aiSummaries: false })

    expect(screen.queryByText('Zoom')).not.toBeInTheDocument()
    expect(screen.queryByText('1 attendee')).not.toBeInTheDocument()
  })

  it('keeps a venue row when the setting is off, because the setting never covered venues', () => {
    renderPopoverWith({
      item: buildItem({ location: 'Head office', locationKind: 'venue' }),
      aiSummaries: false,
    })

    expect(screen.getByText('Head office')).toBeInTheDocument()
  })
})
