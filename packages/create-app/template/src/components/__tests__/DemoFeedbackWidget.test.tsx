/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DemoFeedbackWidget } from '../DemoFeedbackWidget'
import { HIDE_CONTACT_FLAG_KEY } from '../demoFeedbackFlag'

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="logo">{alt}</span>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

jest.mock('@open-mercato/ui/ai/AiDock', () => ({
  useAiDock: () => ({ state: {} }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

describe('DemoFeedbackWidget', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.body.querySelectorAll('[data-open-surface]').forEach((node) => node.remove())
  })

  function mountOpenSurface(attributes: Record<string, string>) {
    const surface = document.createElement('div')
    surface.setAttribute('data-open-surface', '')
    Object.entries(attributes).forEach(([name, value]) => surface.setAttribute(name, value))
    document.body.appendChild(surface)
  }

  it('renders the floating contact button by default', () => {
    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    expect(screen.getByRole('button', { name: 'Open feedback form' })).toBeInTheDocument()
  })

  it('hides the floating contact button when ff_om_hide_contact is set', () => {
    window.localStorage.setItem(HIDE_CONTACT_FLAG_KEY, '1')

    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    expect(screen.queryByRole('button', { name: 'Open feedback form' })).not.toBeInTheDocument()
  })

  it('keeps the button when the flag is explicitly disabled', () => {
    window.localStorage.setItem(HIDE_CONTACT_FLAG_KEY, 'false')

    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    expect(screen.getByRole('button', { name: 'Open feedback form' })).toBeInTheDocument()
  })

  it('keeps the floating button below every overlay band', () => {
    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    const button = screen.getByRole('button', { name: 'Open feedback form' })

    expect(button).toHaveClass('z-sticky')
    expect(button.className).not.toMatch(/z-(banner|top|modal|popover|toast|tooltip|overlay|dropdown)/)
  })

  it('marks the body so the shell reserves a bottom safe area', () => {
    const { unmount } = render(<DemoFeedbackWidget demoModeEnabled={true} />)

    expect(document.body.getAttribute('data-demo-feedback-fab')).toBe('visible')

    unmount()

    expect(document.body.hasAttribute('data-demo-feedback-fab')).toBe(false)
  })

  it('rests as a 44px icon-only circle with the caption collapsed', () => {
    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    const button = screen.getByRole('button', { name: 'Open feedback form' })
    const caption = button.querySelector('span')

    expect(button).toHaveClass('h-11', 'min-w-11', 'rounded-full', 'px-3')
    expect(caption).toHaveClass('max-w-0', 'opacity-0', 'overflow-hidden')
  })

  it('reveals the caption on hover and keyboard focus only', () => {
    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    const button = screen.getByRole('button', { name: 'Open feedback form' })
    const caption = button.querySelector('span')

    expect(button).toHaveClass('group', 'hover:px-5', 'focus-visible:px-5', 'focus-visible:ring-2')
    expect(caption).toHaveClass(
      'group-hover:max-w-40',
      'group-hover:opacity-100',
      'group-focus-visible:max-w-40',
      'group-focus-visible:opacity-100',
    )
    expect(caption?.className).not.toMatch(/(^|\s)(max-w-40|opacity-100)(\s|$)/)
  })

  it('opens the feedback dialog on click', async () => {
    const user = userEvent.setup()
    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    await user.click(screen.getByRole('button', { name: 'Open feedback form' }))

    expect(await screen.findByText('Talk to Open Mercato team')).toBeInTheDocument()
  })

  it('is reachable with Tab and opens the feedback dialog with Enter', async () => {
    const user = userEvent.setup()
    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    const button = screen.getByRole('button', { name: 'Open feedback form' })
    await user.tab()
    expect(button).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(await screen.findByText('Talk to Open Mercato team')).toBeInTheDocument()
  })

  it.each([
    ['dialog', { 'data-dialog-content': '', 'data-state': 'open' }],
    ['drawer', { 'data-slot': 'drawer-content', 'data-state': 'open' }],
    ['sheet', { 'data-slot': 'sheet-content', 'data-state': 'open' }],
  ])('hides the floating button while a %s is open', (_label, attributes) => {
    mountOpenSurface(attributes as Record<string, string>)

    render(<DemoFeedbackWidget demoModeEnabled={true} />)

    expect(screen.queryByRole('button', { name: 'Open feedback form' })).not.toBeInTheDocument()
    expect(document.body.hasAttribute('data-demo-feedback-fab')).toBe(false)
  })
})
