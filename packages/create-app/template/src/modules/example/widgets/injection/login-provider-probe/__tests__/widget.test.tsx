/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import type { AuthOverride, LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import LoginProviderProbeWidget from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

it('separates the claim and confirmation after delegated submission and resets for other domains', () => {
  const setAuthOverride = jest.fn<void, [AuthOverride | null]>()
  const context: LoginFormWidgetContext = {
    email: 'person@login-probe.example',
    tenantId: null,
    searchParams: new URLSearchParams(),
    setAuthOverride,
    setError: jest.fn(),
  }
  const { rerender } = render(<LoginProviderProbeWidget context={context} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  const provider = setAuthOverride.mock.calls.at(-1)?.[0]
  expect(provider).toEqual(expect.objectContaining({
    providerId: 'example-login-probe',
    hidePassword: true,
    hideRememberMe: true,
    hideForgotPassword: true,
  }))
  act(() => provider?.onSubmit())
  expect(screen.getByTestId('example-login-provider-probe').textContent).toBe(
    'Alternative sign-in claimed this email domain. Probe provider received the sign-in.',
  )
  expect(screen.getByRole('status')).toHaveTextContent('Probe provider received the sign-in.')

  rerender(<LoginProviderProbeWidget context={{ ...context, email: 'person@example.com' }} />)
  expect(screen.getByTestId('example-login-provider-probe')).not.toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(setAuthOverride).toHaveBeenLastCalledWith(null)
})
