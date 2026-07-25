/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '../drawer'

function ExampleDrawer({
  side,
  hideCloseButton,
  defaultOpen = true,
}: {
  side?: 'right' | 'left' | 'top' | 'bottom'
  hideCloseButton?: boolean
  defaultOpen?: boolean
}) {
  return (
    <Drawer defaultOpen={defaultOpen}>
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerContent side={side} hideCloseButton={hideCloseButton}>
        <DrawerHeader>
          <DrawerTitle>Edit person</DrawerTitle>
          <DrawerDescription>Update the person's contact info.</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <p>Body content</p>
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose>Cancel</DrawerClose>
          <button>Save</button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

describe('Drawer', () => {
  it('renders trigger + content slots inside a Radix Dialog', () => {
    const { container } = render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-overlay"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-body"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-footer"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-title"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-description"]')).not.toBeNull()
  })

  it('opens on trigger click when controlled-default is closed', () => {
    function ControlledDrawer() {
      const [open, setOpen] = React.useState(false)
      return (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Test</DrawerTitle>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      )
    }
    const { container, getByText } = render(<ControlledDrawer />)
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
    fireEvent.click(getByText('Open'))
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
  })

  it('marks the content with data-side="right" by default', () => {
    const { container } = render(<ExampleDrawer />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.getAttribute('data-side')).toBe('right')
  })

  it('applies right-side positioning classes + inner rounded corners by default', () => {
    const { container } = render(<ExampleDrawer />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('right-0')
    expect(content.className).toContain('inset-y-0')
    // Figma Drawer [1.1] width contract: 400px
    expect(content.className).toContain('max-w-[400px]')
    // Per Figma: inner edge rounded, no panel border on the seam.
    expect(content.className).toContain('rounded-l-xl')
    expect(content.className).not.toMatch(/\bborder-l\b/)
  })

  it('applies left-side classes (rounded right edge) when side="left"', () => {
    const { container } = render(<ExampleDrawer side="left" />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('left-0')
    expect(content.className).toContain('inset-y-0')
    expect(content.className).toContain('rounded-r-xl')
    expect(content.className).not.toMatch(/\bborder-r\b/)
    expect(content.getAttribute('data-side')).toBe('left')
  })

  it('applies top-side classes (rounded bottom edge) when side="top"', () => {
    const { container } = render(<ExampleDrawer side="top" />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('top-0')
    expect(content.className).toContain('inset-x-0')
    expect(content.className).toContain('rounded-b-xl')
    expect(content.className).not.toMatch(/\bborder-b\b/)
    expect(content.className).toContain('max-h-[80vh]')
  })

  it('applies bottom-side classes (rounded top edge) when side="bottom"', () => {
    const { container } = render(<ExampleDrawer side="bottom" />)
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('bottom-0')
    expect(content.className).toContain('inset-x-0')
    expect(content.className).toContain('rounded-t-xl')
    expect(content.className).not.toMatch(/\bborder-t\b/)
    expect(content.className).toContain('max-h-[80vh]')
  })

  it('renders the auto close button by default', () => {
    const { container } = render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-close-button"]')).not.toBeNull()
  })

  it('hides the auto close button when hideCloseButton=true', () => {
    const { container } = render(<ExampleDrawer hideCloseButton />)
    expect(document.querySelector('[data-slot="drawer-close-button"]')).toBeNull()
  })

  it('renders role="dialog" with aria-labelledby/describedby wiring from Title + Description', () => {
    render(<ExampleDrawer />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const labelledBy = dialog.getAttribute('aria-labelledby')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Edit person')
  })

  it('closes when DrawerClose child is clicked', () => {
    const { container, getByText } = render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
    fireEvent.click(getByText('Cancel'))
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
  })

  it('renders the header leading badge slot when `leading` is provided', () => {
    render(
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader leading={<span data-testid="leading-icon">⏱</span>}>
            <DrawerTitle>With leading</DrawerTitle>
            <DrawerDescription>Optional description.</DrawerDescription>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>,
    )
    const badge = document.querySelector('[data-slot="drawer-header-leading"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.querySelector('[data-testid="leading-icon"]')).not.toBeNull()
    expect(badge.className).toContain('rounded-full')
    expect(badge.className).toContain('size-10')
    // Title + description still render inside the text block alongside the badge.
    const text = document.querySelector('[data-slot="drawer-header-text"]') as HTMLElement
    expect(text).not.toBeNull()
    expect(text.textContent).toContain('With leading')
    expect(text.textContent).toContain('Optional description.')
  })

  it('renders the header without a leading badge by default', () => {
    render(<ExampleDrawer />)
    expect(document.querySelector('[data-slot="drawer-header-leading"]')).toBeNull()
    // Per Figma: no chrome border below the header.
    const header = document.querySelector('[data-slot="drawer-header"]') as HTMLElement
    expect(header.className).not.toMatch(/\bborder-b\b/)
  })

  it('renders the footer default layout with right-aligned trailing children and no top border', () => {
    render(<ExampleDrawer />)
    const footer = document.querySelector('[data-slot="drawer-footer"]') as HTMLElement
    expect(footer.getAttribute('data-layout')).toBe('default')
    expect(footer.className).not.toMatch(/\bborder-t\b/)
    expect(document.querySelector('[data-slot="drawer-footer-leading"]')).toBeNull()
    const trailing = document.querySelector('[data-slot="drawer-footer-trailing"]') as HTMLElement
    expect(trailing).not.toBeNull()
    // Without a leading slot the trailing group anchors itself to the right.
    expect(trailing.className).toContain('ml-auto')
  })

  it('stretches children evenly when footer layout="equal"', () => {
    render(
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>T</DrawerTitle>
          </DrawerHeader>
          <DrawerFooter layout="equal">
            <DrawerClose>Cancel</DrawerClose>
            <button>Continue</button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>,
    )
    const footer = document.querySelector('[data-slot="drawer-footer"]') as HTMLElement
    expect(footer.getAttribute('data-layout')).toBe('equal')
    // The `[&>*]:flex-1` selector lives in the class list so children
    // stretch equally. There is no trailing wrapper in equal layout.
    expect(footer.className).toContain('[&>*]:flex-1')
    expect(document.querySelector('[data-slot="drawer-footer-trailing"]')).toBeNull()
  })

  it('renders a left-side leading slot in the footer when `leading` is provided', () => {
    render(
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>T</DrawerTitle>
          </DrawerHeader>
          <DrawerFooter
            leading={<label data-testid="dont-show">Don&apos;t show again</label>}
          >
            <DrawerClose>Cancel</DrawerClose>
            <button>Continue</button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>,
    )
    const leading = document.querySelector('[data-slot="drawer-footer-leading"]') as HTMLElement
    expect(leading).not.toBeNull()
    expect(leading.className).toContain('mr-auto')
    expect(leading.querySelector('[data-testid="dont-show"]')).not.toBeNull()
    // When a leading slot is present the trailing wrapper drops `ml-auto`
    // (the leading mr-auto already pushes them apart).
    const trailing = document.querySelector('[data-slot="drawer-footer-trailing"]') as HTMLElement
    expect(trailing).not.toBeNull()
    expect(trailing.className).not.toMatch(/\bml-auto\b/)
  })

  it('forwards className to drawer-content without dropping side classes', () => {
    const { container } = render(
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent className="custom-class">
          <DrawerHeader>
            <DrawerTitle>Title</DrawerTitle>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>,
    )
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement
    expect(content.className).toContain('custom-class')
    expect(content.className).toContain('right-0')
    expect(content.className).toContain('rounded-l-xl')
  })
})
