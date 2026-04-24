/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import MfaEnrollmentNotice from '../MfaEnrollmentNotice'

function renderWithI18n(ui: React.ReactElement) {
  return render(
    <I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>,
  )
}

describe('MfaEnrollmentNotice', () => {
  it('does not render when visible is false', () => {
    const { container } = renderWithI18n(
      <MfaEnrollmentNotice visible={false} overdue={false} onDismiss={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an Alert with the info variant when not overdue', () => {
    renderWithI18n(
      <MfaEnrollmentNotice visible overdue={false} onDismiss={() => {}} />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.className).toMatch(/status-info/)
    expect(screen.getByText('MFA enrollment required')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your organization requires MFA enrollment. Set up at least one method to continue securely.',
      ),
    ).toBeInTheDocument()
  })

  it('renders an Alert with the warning variant when overdue', () => {
    renderWithI18n(
      <MfaEnrollmentNotice visible overdue onDismiss={() => {}} />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.className).toMatch(/status-warning/)
    expect(
      screen.getByText(
        'Your MFA enrollment deadline has passed. Set up MFA now to keep account access.',
      ),
    ).toBeInTheDocument()
  })

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = jest.fn()
    renderWithI18n(<MfaEnrollmentNotice visible overdue onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
