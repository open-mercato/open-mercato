/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleGroup } from '../CollapsibleGroup'

// jsdom has no layout, so these pin the classes that let the header fit a
// 320 px viewport. The measured behaviour is covered by the accessibility
// baseline: with a long title the trigger overflowed the page by up to 158 px.
describe('CollapsibleGroup header reflow', () => {
  function renderGroup(chevronPosition: 'left' | 'right') {
    renderWithProviders(
      <CollapsibleGroup
        groupId="roles"
        title="My roles with a person whose name is long"
        pageType="test-page"
        fieldCount={1}
        chevronPosition={chevronPosition}
      >
        <p>Content</p>
      </CollapsibleGroup>,
    )
    const trigger = screen.getByRole('button', { name: /My roles with a person whose name is long/ })
    const title = screen.getByText('My roles with a person whose name is long')
    return { trigger, title, label: title.parentElement as HTMLElement }
  }

  it.each(['left', 'right'] as const)('lets the trigger shrink and its title wrap (chevron %s)', (chevronPosition) => {
    const { trigger, title, label } = renderGroup(chevronPosition)

    expect(trigger).toHaveClass('min-w-0', 'whitespace-normal', 'h-auto', 'min-h-9', 'text-left')
    expect(trigger).not.toHaveClass('whitespace-nowrap', 'h-9')
    expect(label).toHaveClass('min-w-0', 'flex-wrap')
    expect(title).toHaveClass('min-w-0', 'break-words')
  })

  it('keeps the toggle state on the trigger', () => {
    const { trigger } = renderGroup('right')

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', 'collapsible-group-roles')
  })
})
