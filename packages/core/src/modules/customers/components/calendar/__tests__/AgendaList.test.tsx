/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AgendaList } from '../AgendaList'
import type { CalendarItem } from '../types'

function buildItem(): CalendarItem {
  const start = new Date('2026-08-10T12:00:00.000Z')
  const end = new Date('2026-08-10T13:00:00.000Z')
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

function renderAgenda(locale: string) {
  const anchor = new Date('2026-08-10T00:00:00.000Z')
  return renderWithProviders(
    <AgendaList anchor={anchor} horizonDays={0} items={[buildItem()]} onItemClick={jest.fn()} />,
    { locale },
  )
}

describe('AgendaList — locale-aware date/time formatting (#5116)', () => {
  afterEach(() => {
    cleanup()
  })

  it('formats the day-group heading using the application locale, not the browser/OS locale', () => {
    const en = renderAgenda('en')
    const enHeading = en.container.querySelector('.font-semibold.text-foreground')
    const enText = enHeading?.textContent ?? ''
    en.unmount()

    const pl = renderAgenda('pl')
    const plHeading = pl.container.querySelector('.font-semibold.text-foreground')
    const plText = plHeading?.textContent ?? ''
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
    expect(enText.toUpperCase()).toContain('MON')
    expect(plText.toLowerCase()).toContain('pon')
  })

  it('formats the event start time using the application locale, not the browser/OS locale', () => {
    const en = renderAgenda('en')
    const enTime = en.container.querySelector('.leading-4')
    const enText = enTime?.textContent ?? ''
    en.unmount()

    const pl = renderAgenda('pl')
    const plTime = pl.container.querySelector('.leading-4')
    const plText = plTime?.textContent ?? ''
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
  })
})
