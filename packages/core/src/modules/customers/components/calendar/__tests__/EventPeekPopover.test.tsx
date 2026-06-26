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

function renderPopover(canManage: boolean, onEdit: jest.Mock, onOpenChange: jest.Mock) {
  return renderWithProviders(
    <EventPeekPopover
      item={buildItem()}
      open
      joinUrl={null}
      aiSummaries={false}
      canManage={canManage}
      onOpenChange={onOpenChange}
      onJoin={jest.fn()}
      onEdit={onEdit}
    >
      <button type="button">trigger</button>
    </EventPeekPopover>,
    { dict },
  )
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
