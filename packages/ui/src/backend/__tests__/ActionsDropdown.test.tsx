/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, fireEvent } from '@testing-library/react'
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

function getTrigger() {
  return screen.getByRole('button', { name: TRIGGER_LABEL })
}

function getHoverZone() {
  const wrapper = getTrigger().parentElement
  if (!wrapper) throw new Error('[internal] ActionsDropdown trigger has no wrapper element')
  return wrapper
}

function openMenu() {
  fireEvent.click(getTrigger())
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

// Regression coverage for the mouse-click bug: the wrapper opens the menu on
// `mouseenter`, and a real mouse click is always preceded by one, so the
// trigger's plain toggle immediately closed the menu again. Keyboard
// activation never emits `mouseenter`, which is why only mouse users were hit.
describe('ActionsDropdown mouse interaction', () => {
  const ITEMS: ActionItem[] = [{ id: 'mark-all-unread', label: LONG_POLISH_LABEL, onSelect: jest.fn() }]

  it('opens on a mouse click that follows the browser-emitted mouseenter', () => {
    renderDropdown(ITEMS)

    fireEvent.mouseEnter(getHoverZone())
    fireEvent.click(getTrigger())

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('opens on a click with no preceding hover (keyboard activation path)', () => {
    renderDropdown(ITEMS)

    fireEvent.click(getTrigger())

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('still closes on the second click after a hover-then-click open', () => {
    renderDropdown(ITEMS)

    fireEvent.mouseEnter(getHoverZone())
    fireEvent.click(getTrigger())
    fireEvent.click(getTrigger())

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('still closes on the second click when the menu was opened by click alone', () => {
    renderDropdown(ITEMS)

    fireEvent.click(getTrigger())
    fireEvent.click(getTrigger())

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on hover and closes again only after the mouse-leave grace period', () => {
    jest.useFakeTimers()
    try {
      renderDropdown(ITEMS)

      fireEvent.mouseEnter(getHoverZone())
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')

      fireEvent.mouseLeave(getHoverZone())
      act(() => { jest.advanceTimersByTime(149) })
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')

      act(() => { jest.advanceTimersByTime(1) })
      expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps the menu open when the pointer moves from the trigger into the menu', () => {
    jest.useFakeTimers()
    try {
      renderDropdown(ITEMS)

      fireEvent.mouseEnter(getHoverZone())
      const menu = screen.getByRole('menu')
      fireEvent.mouseLeave(getHoverZone(), { relatedTarget: menu })
      act(() => { jest.advanceTimersByTime(500) })

      expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
    } finally {
      jest.useRealTimers()
    }
  })

  it('closes on Escape and returns focus to the trigger after a hover-then-click open', () => {
    renderDropdown(ITEMS)

    fireEvent.mouseEnter(getHoverZone())
    fireEvent.click(getTrigger())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
    expect(getTrigger()).toHaveFocus()
  })
})
