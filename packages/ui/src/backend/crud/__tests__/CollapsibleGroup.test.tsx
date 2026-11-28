/** @jest-environment jsdom */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleGroup } from '../CollapsibleGroup'

const LONG_TITLE = 'My roles with QA Invitation 0123456789ab'

function renderLongTitle(chevronPosition: 'left' | 'right') {
  renderWithProviders(
    <CollapsibleGroup groupId="roles" title={LONG_TITLE} pageType="test-page" chevronPosition={chevronPosition}>
      <p>content</p>
    </CollapsibleGroup>,
  )
  return screen.getByRole('button', { name: LONG_TITLE })
}

describe('CollapsibleGroup', () => {
  it('keeps accepting the deprecated fieldCount prop without rendering it', () => {
    renderWithProviders(
      <CollapsibleGroup groupId="details" pageType="test-page" title="Details" fieldCount={7}>
        <span>Group content</span>
      </CollapsibleGroup>,
    )
    expect(screen.getByRole('button', { name: /Details/ })).toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })

  it.each(['left', 'right'] as const)(
    'lets a long title wrap inside its row with the chevron on the %s',
    (chevronPosition) => {
      const trigger = renderLongTitle(chevronPosition)
      const title = screen.getByText(LONG_TITLE)

      expect(trigger.className).toContain('min-w-0')
      expect(trigger.className).toContain('whitespace-normal')
      expect(trigger.className).toContain('h-auto')
      expect(title.className).toContain('min-w-0')
      expect(title.className).toContain('break-words')
      expect(title.parentElement?.className).toContain('min-w-0')
    },
  )

  it('keeps the whole title as the accessible name', () => {
    const trigger = renderLongTitle('right')

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.textContent).toBe(LONG_TITLE)
  })
})
