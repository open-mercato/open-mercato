import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ErrorNotice } from '../ErrorNotice'

function renderWithI18n(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>,
  )
}

describe('ErrorNotice', () => {
  it('renders as an Alert with the destructive variant and default copy', () => {
    renderWithI18n(<ErrorNotice />)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.className).toMatch(/status-error/)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Unable to load data. Please try again.')).toBeInTheDocument()
  })

  it('surfaces the provided title and message', () => {
    renderWithI18n(<ErrorNotice title="Custom title" message="Custom message" />)
    expect(screen.getByText('Custom title')).toBeInTheDocument()
    expect(screen.getByText('Custom message')).toBeInTheDocument()
  })

  it('renders the action node when provided', () => {
    renderWithI18n(
      <ErrorNotice
        title="Oops"
        message="Try again"
        action={<button type="button">Retry</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('does not emit the deprecated Notice console.warn in dev', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderWithI18n(<ErrorNotice />)
      const match = warn.mock.calls.some((call) =>
        typeof call[0] === 'string' && call[0].includes('<Notice> is deprecated'),
      )
      expect(match).toBe(false)
    } finally {
      warn.mockRestore()
      process.env.NODE_ENV = originalEnv
    }
  })
})
