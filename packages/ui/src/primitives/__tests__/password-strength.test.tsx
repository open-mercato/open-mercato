/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { PasswordStrength, type PasswordStrengthState } from '../password-strength'

describe('PasswordStrength', () => {
  it.each([['empty', 0, 'Empty'], ['weak', 1, 'Weak'], ['moderate', 2, 'Moderate'], ['strong', 3, 'Strong']] as const)('announces the externally supplied %s level', (strength, value, label) => {
    render(<I18nProvider locale="en" dict={{}}><PasswordStrength strength={strength} requirements={[]} /></I18nProvider>)
    expect(screen.getByRole('progressbar', { name: 'Password strength' })).toHaveAttribute('aria-valuenow', String(value))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', label)
  })

  it('uses caller requirements and updates their accessible completion state without imposing a password policy', () => {
    const view = (strength: PasswordStrengthState, met: boolean) => (
      <I18nProvider locale="en" dict={{}}>
        <PasswordStrength strength={strength} requirementsLabel="Organization policy" requirements={[{ id: 'custom', label: 'Approved by the configured validator', met }]} />
      </I18nProvider>
    )
    const { rerender } = render(view('weak', false))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('listitem')).toHaveTextContent('Requirement not met: Approved by the configured validator')
    rerender(view('strong', true))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByRole('listitem')).toHaveTextContent('Requirement met: Approved by the configured validator')
    expect(screen.getByText('Organization policy')).toBeInTheDocument()
  })

  it('uses translated strength and requirement status labels', () => {
    render(
      <I18nProvider locale="pl" dict={{ 'ui.passwordStrength.label': 'Siła hasła', 'ui.passwordStrength.strong': 'Silne', 'ui.passwordStrength.met': 'Warunek spełniony' }}>
        <PasswordStrength strength="strong" requirements={[{ id: 'length', label: 'Minimum 8 znaków', met: true }]} />
      </I18nProvider>,
    )
    expect(screen.getByRole('progressbar', { name: 'Siła hasła' })).toHaveAttribute('aria-valuetext', 'Silne')
    expect(screen.getByRole('listitem')).toHaveTextContent('Warunek spełniony: Minimum 8 znaków')
  })
})
