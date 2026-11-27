/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { DemoFeedbackWidget } from '../DemoFeedbackWidget'
import { HIDE_CONTACT_FLAG_KEY } from '../demoFeedbackFlag'
import { ContentSecurityPolicyProvider } from '@open-mercato/ui/theme/ContentSecurityPolicyProvider'

const mockTranslations: Record<string, string> = {}
const apiCallMock = jest.mocked(apiCall)
const mockedResponse = {} as Response
const repositoryRoot = process.cwd().endsWith(path.join('apps', 'mercato'))
  ? path.resolve(process.cwd(), '../..')
  : process.cwd()

const feedbackDisabledMessages = Object.fromEntries(
  ['en', 'pl', 'es', 'de', 'ko'].map((locale) => {
    const dictionary = JSON.parse(readFileSync(
      path.join(repositoryRoot, 'packages/onboarding/src/modules/onboarding/i18n', `${locale}.json`),
      'utf8',
    )) as Record<string, string>
    return [locale, dictionary['demoFeedback.errors.disabled']]
  }),
) as Record<string, string>

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="logo">{alt}</span>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => mockTranslations[key] ?? fallback ?? key,
}))

jest.mock('@open-mercato/ui/ai/AiDock', () => ({
  useAiDock: () => ({ state: {} }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

describe('DemoFeedbackWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.keys(mockTranslations).forEach((key) => delete mockTranslations[key])
  })

  it('uses the document nonce for its animation stylesheet', () => {
    render(<ContentSecurityPolicyProvider nonce="trustedDocumentNonce"><DemoFeedbackWidget demoModeEnabled={true} /></ContentSecurityPolicyProvider>)
    const stylesheet = Array.from(document.querySelectorAll('style')).find((style) => style.textContent?.includes('@keyframes subtle-bounce'))
    expect(stylesheet?.nonce).toBe('trustedDocumentNonce')
  })

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

  it.each(Object.entries(feedbackDisabledMessages))('shows the demo-disabled message in %s', async (locale, message) => {
    Object.assign(mockTranslations, JSON.parse(readFileSync(
      path.join(repositoryRoot, 'packages/onboarding/src/modules/onboarding/i18n', `${locale}.json`),
      'utf8',
    )) as Record<string, string>)
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 404,
      result: { ok: false, error: message },
      response: mockedResponse,
      cacheStatus: null,
    })
    const user = userEvent.setup()
    render(<DemoFeedbackWidget demoModeEnabled={true} />)
    await user.click(screen.getByRole('button', { name: mockTranslations['demoFeedback.button.ariaLabel'] }))
    await user.type(screen.getByPlaceholderText(mockTranslations['demoFeedback.form.email']), 'qa@example.test')
    await user.click(screen.getAllByRole('checkbox')[0])
    await user.click(screen.getByRole('button', { name: mockTranslations['demoFeedback.form.submit'] }))

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('allows retrying after a failed feedback request', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 500, result: null, response: mockedResponse, cacheStatus: null })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true }, response: mockedResponse, cacheStatus: null })
    const user = userEvent.setup()
    render(<DemoFeedbackWidget demoModeEnabled={true} />)
    await user.click(screen.getByRole('button', { name: 'Open feedback form' }))
    await user.type(screen.getByPlaceholderText('Your email'), 'qa@example.test')
    await user.click(screen.getAllByRole('checkbox')[0])
    await user.click(screen.getByRole('button', { name: 'Contact me' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Contact me' }))
    expect(await screen.findByText('Thank you!')).toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledTimes(2)
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
