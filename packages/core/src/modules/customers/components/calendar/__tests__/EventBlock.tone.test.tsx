/** @jest-environment jsdom */
import * as React from 'react'
import { render } from '@testing-library/react'
import { EventAccentBar, resolveEventTone, type EventTone } from '../EventBlock'
import { buildCalendarItem } from './fixtures'

const NOW_MS = new Date(2026, 7, 10, 9, 0, 0).getTime()

describe('EventTone compatibility', () => {
  it('accepts a tone built from the three class names alone and falls back to the neutral accent', () => {
    const legacyTone: EventTone = {
      surfaceClassName: 'bg-muted',
      titleClassName: 'text-foreground',
      subClassName: 'text-muted-foreground',
    }
    const { container } = render(<EventAccentBar color={legacyTone.accentColor ?? null} />)
    const bar = container.querySelector('span')
    expect(bar).toHaveClass('bg-muted-foreground/60')
    expect(bar?.getAttribute('style')).toBeNull()
  })

  it('still resolves the type color as the accent for a planned, colored event', () => {
    const tone = resolveEventTone(buildCalendarItem({ color: '#2563eb' }), NOW_MS)
    expect(tone.accentColor).toBe('#2563eb')
  })

  it('resolves a null accent for a planned event without a type color', () => {
    const tone = resolveEventTone(buildCalendarItem({ color: null }), NOW_MS)
    expect(tone.accentColor).toBeNull()
  })
})
