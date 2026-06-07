/** @jest-environment jsdom */

import * as React from 'react'
import { render as rtlRender, fireEvent, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

// CommandMenu uses useT() for the sr-only title + footer hints (Navigate / Select).
// Wrap every render in an empty-dict I18nProvider so the primitive
// falls back to its English fallbacks without real translations.
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(
    <I18nProvider locale="en" dict={{}}>
      {ui}
    </I18nProvider>,
    options,
  )

// jsdom doesn't implement Element.scrollIntoView; cmdk uses it when
// the selected item changes. Provide a no-op so the component can mount.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
import {
  CommandMenu,
  CommandMenuTrigger,
  CommandMenuContent,
  CommandMenuInput,
  CommandMenuList,
  CommandMenuEmpty,
  CommandMenuGroup,
  CommandMenuItem,
  CommandMenuSeparator,
  CommandMenuFooter,
} from '../command-menu'

function ExampleMenu({
  onSelectMonday,
  defaultOpen = true,
  withSeparator = true,
}: {
  onSelectMonday?: () => void
  defaultOpen?: boolean
  withSeparator?: boolean
}) {
  return (
    <CommandMenu defaultOpen={defaultOpen}>
      <CommandMenuTrigger>Open</CommandMenuTrigger>
      <CommandMenuContent>
        <CommandMenuInput placeholder="Search..." />
        <CommandMenuList>
          <CommandMenuEmpty>No results.</CommandMenuEmpty>
          <CommandMenuGroup heading="Tools & Apps">
            <CommandMenuItem value="monday.com" onSelect={onSelectMonday}>
              Monday.com
            </CommandMenuItem>
            <CommandMenuItem value="loom">Loom</CommandMenuItem>
            <CommandMenuItem value="asana">Asana</CommandMenuItem>
          </CommandMenuGroup>
          {withSeparator ? <CommandMenuSeparator /> : null}
          <CommandMenuGroup heading="Employees">
            <CommandMenuItem value="james brown" description="Engineer">
              James Brown
            </CommandMenuItem>
            <CommandMenuItem value="sophia williams" description="Designer">
              Sophia Williams
            </CommandMenuItem>
          </CommandMenuGroup>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenuContent>
    </CommandMenu>
  )
}

describe('CommandMenu', () => {
  it('renders content/input/list/group/item/footer slots inside a Radix Dialog', () => {
    render(<ExampleMenu />)
    expect(document.querySelector('[data-slot="command-menu-overlay"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-root"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-input"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-list"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-slot="command-menu-group"]').length).toBe(2)
    expect(document.querySelectorAll('[data-slot="command-menu-item"]').length).toBeGreaterThanOrEqual(5)
    expect(document.querySelector('[data-slot="command-menu-separator"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-footer"]')).not.toBeNull()
  })

  it('opens on trigger click when controlled-default is closed', () => {
    function Controlled() {
      const [open, setOpen] = React.useState(false)
      return (
        <CommandMenu open={open} onOpenChange={setOpen}>
          <CommandMenuTrigger>Open palette</CommandMenuTrigger>
          <CommandMenuContent>
            <CommandMenuInput placeholder="Search..." />
            <CommandMenuList>
              <CommandMenuGroup heading="Tools">
                <CommandMenuItem value="loom">Loom</CommandMenuItem>
              </CommandMenuGroup>
            </CommandMenuList>
          </CommandMenuContent>
        </CommandMenu>
      )
    }
    const { getByText } = render(<Controlled />)
    expect(document.querySelector('[data-slot="command-menu-content"]')).toBeNull()
    fireEvent.click(getByText('Open palette'))
    expect(document.querySelector('[data-slot="command-menu-content"]')).not.toBeNull()
  })

  it('renders role="dialog" with the auto-hidden title for screen readers', () => {
    render(<ExampleMenu />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Command menu')).toBeInTheDocument()
  })

  it('renders leading magnifier icon and the ⌘K kbd hint by default', () => {
    render(<ExampleMenu />)
    expect(document.querySelector('[data-slot="command-menu-input-icon"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-input-shortcut"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="command-menu-input-clear"]')).toBeNull()
  })

  it('swaps the ⌘K kbd for a clear × button once the input has a value', () => {
    render(<ExampleMenu />)
    const input = document.querySelector('[data-slot="command-menu-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'monday' } })
    expect(document.querySelector('[data-slot="command-menu-input-shortcut"]')).toBeNull()
    expect(document.querySelector('[data-slot="command-menu-input-clear"]')).not.toBeNull()
  })

  it('clears the value when the × button is clicked', () => {
    render(<ExampleMenu />)
    const input = document.querySelector('[data-slot="command-menu-input"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'monday' } })
    const clear = document.querySelector('[data-slot="command-menu-input-clear"]') as HTMLButtonElement
    fireEvent.click(clear)
    expect(input.value).toBe('')
  })

  it('renders item description and chevron slot when applicable', () => {
    render(<ExampleMenu />)
    // Description slot exists for items configured with `description`.
    expect(
      document.querySelectorAll('[data-slot="command-menu-item-description"]').length,
    ).toBeGreaterThan(0)
    // Auto chevron renders by default (no `shortcut`, no `hideChevron`).
    expect(document.querySelectorAll('[data-slot="command-menu-item-chevron"]').length).toBeGreaterThan(0)
  })

  it('fires onSelect when an item is clicked', () => {
    const onSelectMonday = jest.fn()
    render(<ExampleMenu onSelectMonday={onSelectMonday} />)
    const items = document.querySelectorAll('[data-slot="command-menu-item"]') as NodeListOf<HTMLElement>
    const monday = Array.from(items).find((el) => el.textContent?.trim() === 'Monday.com') as HTMLElement
    expect(monday).toBeTruthy()
    fireEvent.click(monday)
    expect(onSelectMonday).toHaveBeenCalledTimes(1)
  })

  it('renders the group action button when actionLabel + onAction are provided', () => {
    const onAction = jest.fn()
    render(
      <CommandMenu defaultOpen>
        <CommandMenuTrigger>Open</CommandMenuTrigger>
        <CommandMenuContent>
          <CommandMenuInput placeholder="Search..." />
          <CommandMenuList>
            <CommandMenuGroup heading="Tools" actionLabel="See all" onAction={onAction}>
              <CommandMenuItem value="loom">Loom</CommandMenuItem>
            </CommandMenuGroup>
          </CommandMenuList>
        </CommandMenuContent>
      </CommandMenu>,
    )
    const action = document.querySelector('[data-slot="command-menu-group-action"] button') as HTMLButtonElement
    expect(action).not.toBeNull()
    expect(action.textContent).toContain('See all')
    fireEvent.click(action)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('renders default footer hints (Navigate / Select)', () => {
    render(<ExampleMenu />)
    const hints = document.querySelector('[data-slot="command-menu-footer-hints"]') as HTMLElement
    expect(hints).not.toBeNull()
    expect(hints.textContent).toContain('Navigate')
    expect(hints.textContent).toContain('Select')
  })

  it('renders the help slot when provided', () => {
    render(
      <CommandMenu defaultOpen>
        <CommandMenuTrigger>Open</CommandMenuTrigger>
        <CommandMenuContent>
          <CommandMenuInput placeholder="Search..." />
          <CommandMenuList>
            <CommandMenuGroup heading="Tools">
              <CommandMenuItem value="loom">Loom</CommandMenuItem>
            </CommandMenuGroup>
          </CommandMenuList>
          <CommandMenuFooter helpSlot={<a href="#contact">Contact</a>} />
        </CommandMenuContent>
      </CommandMenu>,
    )
    const help = document.querySelector('[data-slot="command-menu-footer-help"]') as HTMLElement
    expect(help).not.toBeNull()
    expect(help.textContent).toContain('Contact')
  })

  it('forwards className to command-menu-content without dropping default positioning', () => {
    render(
      <CommandMenu defaultOpen>
        <CommandMenuTrigger>Open</CommandMenuTrigger>
        <CommandMenuContent className="custom-class">
          <CommandMenuInput placeholder="Search..." />
          <CommandMenuList>
            <CommandMenuGroup heading="Tools">
              <CommandMenuItem value="loom">Loom</CommandMenuItem>
            </CommandMenuGroup>
          </CommandMenuList>
        </CommandMenuContent>
      </CommandMenu>,
    )
    const content = document.querySelector('[data-slot="command-menu-content"]') as HTMLElement
    expect(content.className).toContain('custom-class')
    expect(content.className).toContain('fixed')
    expect(content.className).toContain('z-popover')
  })
})
