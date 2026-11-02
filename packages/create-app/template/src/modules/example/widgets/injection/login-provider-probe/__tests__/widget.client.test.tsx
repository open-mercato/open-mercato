/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { AuthOverride, LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import LoginProviderProbeWidget from '../widget.client'

const externalOverride: AuthOverride = {
  providerId: 'other-provider',
  providerLabel: 'Continue with other provider',
  onSubmit: () => undefined,
  hidePassword: true,
  hideRememberMe: true,
  hideForgotPassword: true,
}

function OtherProvider({ email, setAuthOverride }: Pick<LoginFormWidgetContext, 'email' | 'setAuthOverride'>) {
  React.useEffect(() => {
    if (email.endsWith('@other.example')) setAuthOverride(externalOverride)
  }, [email, setAuthOverride])
  return null
}

function LoginHarness({ email, showProbe = true, probeLabel = 'Continue with probe provider' }: {
  email: string
  showProbe?: boolean
  probeLabel?: string
}) {
  const [authOverride, setAuthOverride] = React.useState<AuthOverride | null>(null)
  const context: LoginFormWidgetContext = {
    email,
    tenantId: null,
    searchParams: new URLSearchParams(),
    setAuthOverride,
    setError: () => undefined,
  }
  return (
    <I18nProvider locale="en" dict={{ 'example.loginProbe.continue': probeLabel }}>
      <OtherProvider email={email} setAuthOverride={setAuthOverride} />
      {showProbe ? <LoginProviderProbeWidget context={context} /> : null}
      <output data-testid="active-provider">{authOverride?.providerId ?? 'password'}</output>
      <button type="button" onClick={() => authOverride?.onSubmit()}>Submit login</button>
    </I18nProvider>
  )
}

describe('login provider probe coexistence', () => {
  it('leaves another provider selected while inactive and after its translated label changes', () => {
    const view = render(<LoginHarness email="user@other.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('other-provider')

    view.rerender(<LoginHarness email="user@other.example" probeLabel="Translated probe action" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('other-provider')
  })

  it('does not clear an existing provider when the inactive probe mounts or unmounts', () => {
    const view = render(<LoginHarness email="user@other.example" showProbe={false} />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('other-provider')

    view.rerender(<LoginHarness email="user@other.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('other-provider')

    view.rerender(<LoginHarness email="user@other.example" showProbe={false} />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('other-provider')
  })

  it('releases its own claimed flow before another provider takes over', () => {
    const view = render(<LoginHarness email="user@login-probe.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('example-login-probe')
    fireEvent.click(screen.getByRole('button', { name: 'Submit login' }))
    expect(screen.getByTestId('example-login-provider-probe-submitted')).toBeVisible()

    view.rerender(<LoginHarness email="user@other.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('other-provider')
    expect(screen.queryByTestId('example-login-provider-probe-submitted')).not.toBeInTheDocument()
  })

  it('restores password login when leaving its domain without another provider', () => {
    const view = render(<LoginHarness email="user@login-probe.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('example-login-probe')

    view.rerender(<LoginHarness email="user@ordinary.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('password')
  })
})
