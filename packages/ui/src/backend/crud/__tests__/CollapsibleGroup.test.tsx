/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { CollapsibleGroup } from '../CollapsibleGroup'

const LONG_TITLE = 'My roles with QA Invitation 0123456789ab'

function renderGroup(chevronPosition: 'left' | 'right') {
  render(
    <CollapsibleGroup groupId="roles" title={LONG_TITLE} pageType="test-page" chevronPosition={chevronPosition}>
      <p>content</p>
    </CollapsibleGroup>,
  )
  return screen.getByRole('button', { name: LONG_TITLE })
}

describe('CollapsibleGroup heading', () => {
  it.each(['left', 'right'] as const)(
    'lets a long title wrap inside its row with the chevron on the %s',
    (chevronPosition) => {
      const trigger = renderGroup(chevronPosition)
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
    const trigger = renderGroup('right')

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.textContent).toBe(LONG_TITLE)
  })
})
