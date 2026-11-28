/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../dropdown-menu'

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn()
  window.HTMLElement.prototype.hasPointerCapture = jest.fn()
  window.HTMLElement.prototype.releasePointerCapture = jest.fn()
  if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function Menu({ onSelect, onCheckedChange, onValueChange }: { onSelect?: () => void; onCheckedChange?: (value: boolean) => void; onValueChange?: (value: string) => void }) {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>My account</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onSelect}>
          Profile
          <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked onCheckedChange={onCheckedChange}>Status bar</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="top" onValueChange={onValueChange}>
          <DropdownMenuRadioItem value="top">Top</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">Bottom</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Email</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('renders a menu with label, shortcut and the menu roles', () => {
    render(<Menu />)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('My account')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Profile/ })).toHaveTextContent('⇧⌘P')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Status bar' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Top' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Bottom' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitem', { name: 'Invite users' })).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('marks destructive items with error tokens', () => {
    render(<Menu />)
    const item = screen.getByRole('menuitem', { name: 'Log out' })
    expect(item).toHaveAttribute('data-variant', 'destructive')
    expect(item.className).toContain('text-status-error-text')
  })

  it('reports selection, checkbox and radio changes', () => {
    const onSelect = jest.fn()
    const onCheckedChange = jest.fn()
    const onValueChange = jest.fn()
    render(<Menu onSelect={onSelect} onCheckedChange={onCheckedChange} onValueChange={onValueChange} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Profile/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Status bar' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Bottom' }))
    expect(onSelect).toHaveBeenCalled()
    expect(onCheckedChange).toHaveBeenCalledWith(false)
    expect(onValueChange).toHaveBeenCalledWith('bottom')
  })
})
