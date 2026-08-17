/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AgendaList } from '../AgendaList'
import { buildCalendarItem } from './fixtures'

const AGENDA_ANCHOR = new Date(2026, 7, 10, 0, 0, 0)

function renderAgenda(locale: string) {
  return renderWithProviders(
    <AgendaList anchor={AGENDA_ANCHOR} horizonDays={0} items={[buildCalendarItem()]} onItemClick={jest.fn()} />,
    { locale },
  )
}

function dayGroupHeadingText(container: HTMLElement): string {
  const heading = container.querySelector('button')?.previousElementSibling
  return heading?.querySelector('span')?.textContent ?? ''
}

function eventRowLabel(container: HTMLElement): string {
  return container.querySelector('button[aria-label]')?.getAttribute('aria-label') ?? ''
}

describe('AgendaList — locale-aware date/time formatting (#5116)', () => {
  afterEach(() => {
    cleanup()
  })

  it('formats the day-group heading using the application locale, not the browser/OS locale', () => {
    const en = renderAgenda('en')
    const enText = dayGroupHeadingText(en.container)
    en.unmount()

    const pl = renderAgenda('pl')
    const plText = dayGroupHeadingText(pl.container)
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
    expect(enText.toUpperCase()).toContain('MON')
    expect(plText.toLowerCase()).toContain('pon')
  })

  it('formats the event start and end times using the application locale, not the browser/OS locale', () => {
    const en = renderAgenda('en')
    const enText = eventRowLabel(en.container)
    en.unmount()

    const pl = renderAgenda('pl')
    const plText = eventRowLabel(pl.container)
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
  })
})
