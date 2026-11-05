/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { DealTimelineItem } from '../../../../../../lib/dealsTimelineTypes'
import { TimelineDealCard } from '../TimelineDealCard'

const mockUseDraggable = jest.fn()

jest.mock('@dnd-kit/core', () => ({
  useDraggable: (args: unknown) => mockUseDraggable(args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) => {
    const template = fallback ?? key
    return params ? template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? '')) : template
  },
}))

const deal: DealTimelineItem = {
  id: 'deal-1',
  title: 'LIMS migration',
  status: 'open',
  valueAmount: 91000,
  valueCurrency: 'EUR',
  probability: 65,
  expectedCloseAt: '2026-11-02',
  pipelineId: 'p1',
  pipelineStageId: 's1',
  pipelineStage: 'Proposal',
  ownerUserId: 'u1',
  updatedAt: '2026-10-23T09:12:44.120Z',
  primaryCompany: { id: 'c1', label: 'Veridian Labs' },
  primaryPerson: null,
}

function renderCard(props: Partial<React.ComponentProps<typeof TimelineDealCard>> = {}) {
  const onOpen = jest.fn()
  render(
    <TimelineDealCard
      item={deal}
      laneKey="u1"
      column={1}
      todayKey="2026-11-05"
      accentClass="bg-status-info-icon"
      canDrag
      canOpenInNewTab
      onOpen={onOpen}
      {...props}
    />,
  )
  return { onOpen, card: screen.getByRole('button') }
}

describe('TimelineDealCard', () => {
  beforeEach(() => {
    mockUseDraggable.mockReturnValue({ attributes: {}, listeners: {}, setNodeRef: jest.fn(), isDragging: false })
  })

  it('opens the drawer on click and Enter', () => {
    const { onOpen, card } = renderCard()
    fireEvent.click(card)
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen.mock.calls[0][0]).toBe(deal)
  })

  it('composes the aria-label with the overdue state', () => {
    const { card } = renderCard()
    const label = card.getAttribute('aria-label') ?? ''
    expect(label).toContain('LIMS migration')
    expect(label).toContain('Veridian Labs')
    expect(label).toContain('overdue')
  })

  it('opens the deal page in a new tab on a modified click for managers only', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    const { onOpen, card } = renderCard()
    fireEvent.click(card, { metaKey: true })
    expect(open).toHaveBeenCalledWith('/backend/customers/deals/deal-1', '_blank', 'noopener')
    expect(onOpen).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('falls back to the drawer for a modified click without manage access', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    const { onOpen, card } = renderCard({ canOpenInNewTab: false })
    fireEvent.click(card, { ctrlKey: true })
    expect(open).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('disables dragging and explains why for read-only users and closed deals', () => {
    renderCard({ canDrag: false, dragDisabledHint: 'Closed deals can’t be rescheduled from the timeline.', item: { ...deal, status: 'win' } })
    expect(mockUseDraggable).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }))
    expect(screen.getByRole('button').getAttribute('title')).toBe('Closed deals can’t be rescheduled from the timeline.')
    expect(screen.getByText('Won')).toBeTruthy()
  })
})
