/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { RowActions, type RowActionItem } from '../RowActions'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

// Regression coverage for the QA findings on PR #6685:
//   #6718 — the menu could not be driven with the arrow keys, so reaching an
//           item meant Tabbing through every other row's trigger first.
//   #6719 — the panel had a fixed `w-44`, so the Polish "Zarejestruj push
//           ponownie" overhung its right border by ~10px.
// #6719 is the same defect ActionsDropdown carried as #3580, and is fixed the
// same way here.
const LONG_POLISH_LABEL = 'Zarejestruj push ponownie'
const TRIGGER_LABEL = 'Open actions'

function renderMenu(items: RowActionItem[]) {
  return renderWithProviders(<RowActions items={items} />, { dict: {} })
}

function openMenu() {
  // The panel needs two renders: the click opens the menu, and measuring the
  // trigger sets the anchor that actually renders the portal. Focus lands as
  // part of that second commit — no timer involved, so nothing to advance here.
  fireEvent.click(screen.getByRole('button', { name: TRIGGER_LABEL }))
}

const THREE_ITEMS: RowActionItem[] = [
  { id: 'set-primary', label: 'Set as primary', onSelect: jest.fn() },
  { id: 'poll-now', label: 'Poll now', onSelect: jest.fn() },
  { id: 'disconnect', label: 'Disconnect', destructive: true, onSelect: jest.fn() },
]

function itemNamed(name: string) {
  return screen.getByRole('menuitem', { name })
}

describe('RowActions — panel width (#6719)', () => {

  it('grows to fit a long label instead of clipping it with a fixed width', () => {
    renderMenu([{ id: 'register-push', label: LONG_POLISH_LABEL, onSelect: jest.fn() }])
    openMenu()

    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('w-max')
    expect(menu.className).toContain('min-w-44')
    expect(menu.className).toContain('max-w-xs')
    // The bug was a hard `w-44` that longer localized labels overflowed.
    expect(menu.className).not.toMatch(/(^|\s)w-44(\s|$)/)

    expect(screen.getByText(LONG_POLISH_LABEL)).toBeInTheDocument()
  })

  it('lets an over-long label wrap rather than overflow the panel', () => {
    renderMenu([{ id: 'register-push', label: LONG_POLISH_LABEL, onSelect: jest.fn() }])
    openMenu()

    const item = itemNamed(LONG_POLISH_LABEL)
    // Button is `whitespace-nowrap` by default — that default is what pushed the
    // label past the border, so it has to be overridden here.
    expect(item.className).toContain('whitespace-normal')
    expect(item.className).toContain('h-auto')
  })
})

describe('RowActions — keyboard navigation (#6718)', () => {

  it('focuses the first item when the menu opens', () => {
    renderMenu(THREE_ITEMS)
    openMenu()

    expect(document.activeElement).toBe(itemNamed('Set as primary'))
  })

  it('moves down the list with ArrowDown and wraps at the end', () => {
    renderMenu(THREE_ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(itemNamed('Poll now'))

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(itemNamed('Disconnect'))

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(itemNamed('Set as primary'))
  })

  it('moves up the list with ArrowUp and wraps at the start', () => {
    renderMenu(THREE_ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(itemNamed('Disconnect'))

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(itemNamed('Poll now'))
  })

  it('jumps to the first and last item with Home and End', () => {
    renderMenu(THREE_ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'End' })
    expect(document.activeElement).toBe(itemNamed('Disconnect'))

    fireEvent.keyDown(document, { key: 'Home' })
    expect(document.activeElement).toBe(itemNamed('Set as primary'))
  })

  it('keeps Tab inside the menu instead of escaping to the next row', () => {
    renderMenu(THREE_ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(itemNamed('Poll now'))

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(itemNamed('Set as primary'))
  })

  it('closes on Escape and returns focus to the trigger', () => {
    renderMenu(THREE_ITEMS)
    openMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: TRIGGER_LABEL }))
  })

  it('still runs the action when an item is activated', () => {
    const onSelect = jest.fn()
    renderMenu([{ id: 'poll-now', label: 'Poll now', onSelect }])
    openMenu()

    fireEvent.click(itemNamed('Poll now'))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
