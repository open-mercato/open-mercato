/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EventBlock } from '../EventBlock'
import { formatTimeRangeLabel } from '../../../lib/calendar/format'
import { buildCalendarItem } from './fixtures'

const NOW_MS = new Date(2026, 7, 10, 9, 0, 0).getTime()
const LONG_TITLE = 'Quarterly business review with the regional partner team'

function renderBlock(props: Partial<React.ComponentProps<typeof EventBlock>> = {}) {
  const item = buildCalendarItem({ title: LONG_TITLE })
  renderWithProviders(
    <EventBlock
      item={item}
      top={0}
      height={32}
      insetInlineStart="0%"
      width="25%"
      conflicted={false}
      highlighted={false}
      nowMs={NOW_MS}
      {...props}
    />,
  )
  return item
}

describe('EventBlock hover title (#9620)', () => {
  it('exposes the full title and time range on hover when a narrow block cuts the title', () => {
    const item = renderBlock({ compact: true })
    const expected = `${LONG_TITLE}, ${formatTimeRangeLabel('en', item.start, item.end)}`

    const block = screen.getByRole('button', { name: expected })

    expect(block).toHaveAttribute('title', expected)
  })

  it('falls back to the untitled label', () => {
    renderWithProviders(
      <EventBlock
        item={buildCalendarItem({ title: '' })}
        top={0}
        height={32}
        insetInlineStart="0%"
        width="25%"
        conflicted={false}
        highlighted={false}
        nowMs={NOW_MS}
      />,
    )

    expect(screen.getByRole('button').getAttribute('title')).toMatch(/^Untitled, /)
  })

  it('lets a caller override the hover title', () => {
    renderBlock({ title: 'Custom hover text' })

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Custom hover text')
  })
})
