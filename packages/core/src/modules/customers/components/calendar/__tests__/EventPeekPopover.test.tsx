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

function buildItem(): CalendarItem {
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
