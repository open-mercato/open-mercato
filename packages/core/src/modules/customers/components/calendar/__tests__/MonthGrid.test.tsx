/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MonthGrid } from '../MonthGrid'

function renderGrid(locale: string) {
  const anchor = new Date('2026-08-10T12:00:00.000Z')
  return renderWithProviders(
    <MonthGrid anchor={anchor} items={[]} onItemClick={jest.fn()} onDayOpen={jest.fn()} />,
    { locale },
  )
}

describe('MonthGrid — locale-aware date formatting (#5116)', () => {
  afterEach(() => {
    cleanup()
  })

  it('formats the weekday header row using the application locale, not the browser/OS locale', () => {
    const en = renderGrid('en')
    const enHeader = en.container.querySelector('.h-9')
    const enText = enHeader?.textContent ?? ''
    en.unmount()

    const pl = renderGrid('pl')
    const plHeader = pl.container.querySelector('.h-9')
    const plText = plHeader?.textContent ?? ''
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
    expect(enText.toUpperCase()).toContain('MON')
    expect(plText.toUpperCase()).toContain('PON')
  })

  it('formats the day-cell full date label using the application locale, not the browser/OS locale', () => {
    const en = renderGrid('en')
    const enButton = en.container.querySelector('button[aria-label]')
    const enLabel = enButton?.getAttribute('aria-label') ?? ''
    en.unmount()

    const pl = renderGrid('pl')
    const plButton = pl.container.querySelector('button[aria-label]')
    const plLabel = plButton?.getAttribute('aria-label') ?? ''
    pl.unmount()

    expect(enLabel).not.toBe('')
    expect(plLabel).not.toBe('')
    expect(plLabel).not.toBe(enLabel)
  })
})
