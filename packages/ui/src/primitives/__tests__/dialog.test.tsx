/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../dialog'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

function renderDialog(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" dict={{ ui: { dialog: { close: { ariaLabel: 'Close' } } } }}>
      {ui}
    </I18nProvider>,
  )
}

function ExampleDialog({
  size,
  dismissible,
  defaultOpen = true,
  leading,
  footerLayout,
}: {
  size?: 'sm' | 'default' | 'lg' | 'xl'
  dismissible?: boolean
  defaultOpen?: boolean
  leading?: React.ReactNode
  footerLayout?: 'default' | 'equal'
}) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent size={size} dismissible={dismissible}>
        <DialogHeader leading={leading}>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>This dialog confirms a critical action.</DialogDescription>
        </DialogHeader>
        <DialogFooter layout={footerLayout}>
          <DialogClose>Cancel</DialogClose>
          <button>Continue</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog (Phase B.7)', () => {
  it('renders content / overlay / header / title / description / footer slots inside a Radix Dialog', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-title"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-description"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-footer"]')).not.toBeNull()
  })

  it('opens on trigger click when defaultOpen=false', () => {
    function Controlled() {
      const [open, setOpen] = React.useState(false)
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )
    }
    renderDialog(<Controlled />)
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
    fireEvent.click(screen.getByText('Open'))
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
  })

  it('renders the auto X close button by default', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-close-button"]')).not.toBeNull()
  })

  it('omits the auto X when dismissible=false', () => {
    renderDialog(<ExampleDialog dismissible={false} />)
    expect(document.querySelector('[data-slot="dialog-close-button"]')).toBeNull()
  })

  it('default size="default" applies sm:max-w-lg', () => {
    renderDialog(<ExampleDialog />)
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.getAttribute('data-size')).toBe('default')
    expect(content.className).toContain('sm:max-w-lg')
  })

  it('size variants apply matching max-width', () => {
    const cases: Array<{ size: 'sm' | 'default' | 'lg' | 'xl'; cls: string }> = [
      { size: 'sm', cls: 'sm:max-w-sm' },
      { size: 'default', cls: 'sm:max-w-lg' },
      { size: 'lg', cls: 'sm:max-w-2xl' },
      { size: 'xl', cls: 'sm:max-w-4xl' },
    ]
    for (const { size, cls } of cases) {
      const { unmount } = renderDialog(<ExampleDialog size={size} />)
      const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
      expect(content.getAttribute('data-size')).toBe(size)
      expect(content.className).toContain(cls)
      unmount()
    }
  })

  it('renders the header leading badge when leading is provided', () => {
    renderDialog(<ExampleDialog leading={<span data-testid="lead-icon">⚙</span>} />)
    const badge = document.querySelector('[data-slot="dialog-header-leading"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.querySelector('[data-testid="lead-icon"]')).not.toBeNull()
    expect(badge.className).toContain('rounded-full')
    expect(badge.className).toContain('size-10')
    expect(badge.className).toContain('border')
    // Title + description live inside the text wrapper alongside the badge.
    const text = document.querySelector('[data-slot="dialog-header-text"]') as HTMLElement
    expect(text).not.toBeNull()
    expect(text.querySelector('[data-slot="dialog-title"]')).not.toBeNull()
    expect(text.querySelector('[data-slot="dialog-description"]')).not.toBeNull()
  })

  it('omits the leading badge by default', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-header-leading"]')).toBeNull()
    expect(document.querySelector('[data-slot="dialog-header-text"]')).toBeNull()
  })

  it('default footer layout reads "default" + flex-col-reverse classes', () => {
    renderDialog(<ExampleDialog />)
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-layout')).toBe('default')
    expect(footer.className).toContain('flex-col-reverse')
    expect(footer.className).toContain('sm:justify-end')
  })

  it('footer ships border-t separator by default per Figma `Modal Footer [1.1]`', () => {
    renderDialog(<ExampleDialog />)
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-bordered')).toBe('true')
    expect(footer.className).toContain('border-t')
    expect(footer.className).toContain('pt-4')
  })

  it('footer bordered=false drops the separator', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <DialogFooter bordered={false}>
            <DialogClose>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-bordered')).toBeNull()
    expect(footer.className).not.toContain('border-t')
  })

  it('footer layout="equal" stretches children flex-1', () => {
    renderDialog(<ExampleDialog footerLayout="equal" />)
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.getAttribute('data-layout')).toBe('equal')
    expect(footer.className).toContain('[&>*]:flex-1')
    expect(footer.className).not.toContain('flex-col-reverse')
    // border-t default still applies on equal layout.
    expect(footer.className).toContain('border-t')
  })

  it('footer leading slot renders left content + right-aligned trailing buttons per Figma `Modal Footer [1.1]` variants 2-6', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>x</DialogTitle>
          </DialogHeader>
          <DialogFooter leading={<label data-testid="dont-show">Don&apos;t show again</label>}>
            <DialogClose>Cancel</DialogClose>
            <button>Continue</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const leading = document.querySelector('[data-slot="dialog-footer-leading"]') as HTMLElement
    expect(leading).not.toBeNull()
    expect(leading.className).toContain('sm:mr-auto')
    expect(leading.querySelector('[data-testid="dont-show"]')).not.toBeNull()
    const trailing = document.querySelector('[data-slot="dialog-footer-trailing"]') as HTMLElement
    expect(trailing).not.toBeNull()
    // Footer wraps as flex with leading mr-auto pushing trailing to the right.
    const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.className).toContain('border-t')
    expect(footer.className).not.toContain('justify-end')
  })

  it('header leadingTone defaults to "default" with bordered white badge', () => {
    renderDialog(<ExampleDialog leading={<span>x</span>} />)
    const badge = document.querySelector('[data-slot="dialog-header-leading"]') as HTMLElement
    expect(badge.getAttribute('data-tone')).toBe('default')
    expect(badge.className).toContain('border')
    expect(badge.className).toContain('border-input')
    expect(badge.className).toContain('bg-background')
  })

  it('header leadingTone applies soft status tint + colored icon per Figma `Status Modals [1.1]`', () => {
    const cases: Array<{
      tone: 'accent' | 'success' | 'warning' | 'error' | 'info'
      bg: string
      tx: string
    }> = [
      // Canonical Figma Status Modals — soft tint background paired
      // with a saturated colored icon (red `!` on light pink, etc.).
      { tone: 'accent', bg: 'bg-accent-indigo/10', tx: 'text-accent-indigo' },
      { tone: 'success', bg: 'bg-status-success-bg', tx: 'text-status-success-icon' },
      { tone: 'warning', bg: 'bg-status-warning-bg', tx: 'text-status-warning-icon' },
      { tone: 'error', bg: 'bg-status-error-bg', tx: 'text-status-error-icon' },
      { tone: 'info', bg: 'bg-status-info-bg', tx: 'text-status-info-icon' },
    ]
    for (const { tone, bg, tx } of cases) {
      const { unmount } = renderDialog(
        <Dialog defaultOpen>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader leading={<span>x</span>} leadingTone={tone}>
              <DialogTitle>t</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      )
      const badge = document.querySelector('[data-slot="dialog-header-leading"]') as HTMLElement
      expect(badge.getAttribute('data-tone')).toBe(tone)
      expect(badge.className).toContain(bg)
      expect(badge.className).toContain(tx)
      // Status tones drop the bordered white shell.
      expect(badge.className).not.toContain('border-input')
      unmount()
    }
  })

  it('Radix Dialog ARIA contract: role="dialog", labelledby/describedby from Title + Description', () => {
    renderDialog(<ExampleDialog />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const labelledBy = dialog.getAttribute('aria-labelledby')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Confirm action')
  })

  it('DialogClose dismisses the dialog when clicked', () => {
    renderDialog(<ExampleDialog />)
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
    fireEvent.click(screen.getByText('Cancel'))
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })

  it('forwards className to DialogContent without dropping size classes', () => {
    renderDialog(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent className="custom-class" size="lg">
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.className).toContain('custom-class')
    expect(content.className).toContain('sm:max-w-2xl')
  })
})
