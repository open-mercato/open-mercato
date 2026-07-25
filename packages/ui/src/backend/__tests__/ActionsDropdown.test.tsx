/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { ActionsDropdown, type ActionItem } from '../forms/ActionsDropdown'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

// Regression coverage for issue #3580: in the Polish locale the long
// "Oznacz wszystko jako nieprzeczytane" label overflowed the conversation
// actions dropdown because the menu used a fixed `w-52` width and the items
// inherited `whitespace-nowrap` from the Button primitive, clipping the label.
const LONG_POLISH_LABEL = 'Oznacz wszystko jako nieprzeczytane'
const TRIGGER_LABEL = 'Conversation actions'

function renderDropdown(items: ActionItem[]) {
  return renderWithProviders(
    <ActionsDropdown items={items} triggerMode="icon" ariaLabel={TRIGGER_LABEL} />,
    { dict: {} },
  )
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: TRIGGER_LABEL }))
}

describe('ActionsDropdown', () => {
  it('grows to fit long labels instead of clipping them with a fixed width (issue #3580)', () => {
    renderDropdown([{ id: 'mark-all-unread', label: LONG_POLISH_LABEL, onSelect: jest.fn() }])

    openMenu()

    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('w-max')
    expect(menu.className).toContain('max-w-xs')
    expect(menu.className).toContain('min-w-52')
    // The original bug was a hard `w-52` cap that truncated longer localized labels.
    expect(menu.className).not.toMatch(/(^|\s)w-52(\s|$)/)

    expect(screen.getByText(LONG_POLISH_LABEL)).toBeInTheDocument()
  })

  it('lets long menu-item labels wrap to a second line instead of staying on one clipped line', () => {
    renderDropdown([{ id: 'mark-all-unread', label: LONG_POLISH_LABEL, onSelect: jest.fn() }])

    openMenu()

    const item = screen.getByRole('menuitem', { name: LONG_POLISH_LABEL })
    expect(item.className).toContain('whitespace-normal')
    expect(item.className).toContain('h-auto')
    expect(item.className).not.toMatch(/(^|\s)whitespace-nowrap(\s|$)/)
  })

  it('still invokes the action handler when a menu item is clicked', () => {
    const onSelect = jest.fn()
    renderDropdown([{ id: 'mark-all-unread', label: LONG_POLISH_LABEL, onSelect }])

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: LONG_POLISH_LABEL }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
