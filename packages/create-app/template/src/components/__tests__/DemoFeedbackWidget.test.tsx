/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
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
  })

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
})
