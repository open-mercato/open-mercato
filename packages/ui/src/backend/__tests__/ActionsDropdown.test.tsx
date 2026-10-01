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

// Regression coverage for issue #6445: the menu is portaled to the end of
// `document.body` and handled only Escape, so keyboard users reached its items
// only after tabbing through the page footer, and the arrow keys did nothing.
describe('ActionsDropdown — keyboard navigation (#6445)', () => {
  const ITEMS: ActionItem[] = [
    { id: 'retry', label: 'Retry from the beginning', onSelect: jest.fn() },
    { id: 'archived', label: 'Archive', disabled: true, onSelect: jest.fn() },
    { id: 'export', label: 'Export', onSelect: jest.fn() },
    { id: 'delete', label: 'Delete', destructive: true, onSelect: jest.fn() },
  ]

  function itemNamed(name: string) {
    return screen.getByRole('menuitem', { name })
  }

  function trigger() {
    return screen.getByRole('button', { name: TRIGGER_LABEL })
  }

  it('moves focus to the first enabled item when the menu opens', () => {
    renderDropdown(ITEMS)

    openMenu()

    expect(itemNamed('Retry from the beginning')).toHaveFocus()
  })

  it('walks the enabled items with ArrowDown/ArrowUp, wrapping and skipping disabled ones', () => {
    renderDropdown(ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(itemNamed('Export')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(itemNamed('Delete')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(itemNamed('Retry from the beginning')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(itemNamed('Delete')).toHaveFocus()
  })

  it('jumps to the first and last item with Home and End', () => {
    renderDropdown(ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'End' })
    expect(itemNamed('Delete')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Home' })
    expect(itemNamed('Retry from the beginning')).toHaveFocus()
  })

  it('keeps Tab inside the menu instead of escaping into the rest of the page', () => {
    renderDropdown(ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(itemNamed('Export')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(itemNamed('Retry from the beginning')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(itemNamed('Delete')).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', () => {
    renderDropdown(ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('does not steal focus or swallow keys when the menu opens on hover', () => {
    renderDropdown(ITEMS)
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()

    fireEvent.mouseEnter(trigger())
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(document.activeElement).toBe(field)

    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab']) {
      fireEvent.keyDown(document, { key })
      expect(document.activeElement).toBe(field)
    }
    field.remove()
  })
})
