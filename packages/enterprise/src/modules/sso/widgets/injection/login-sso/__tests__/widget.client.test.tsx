/** @jest-environment jsdom */

import * as React from 'react'
import '@testing-library/jest-dom'
import { act, cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { AuthOverride, LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import SsoLoginWidget from '../widget.client'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const apiCallMock = jest.mocked(apiCall)
const noop = () => undefined

function discoveryResult(hasSso: boolean) {
  return {
    ok: true,
    status: 200,
    result: hasSso ? { hasSso, configId: 'sso-config' } : { hasSso },
    response: {} as Response,
    cacheStatus: null,
  }
}

function ProbeProvider({ email, setAuthOverride }: Pick<LoginFormWidgetContext, 'email' | 'setAuthOverride'>) {
  React.useEffect(() => {
    if (!email.endsWith('@probe.example')) return
    setAuthOverride({
      providerId: 'probe',
      providerLabel: 'Continue with probe provider',
      onSubmit: noop,
      hidePassword: true,
      hideRememberMe: true,
      hideForgotPassword: true,
    })
    return () => setAuthOverride(null)
  }, [email, setAuthOverride])
  return null
}

function LoginHarness({ email, tenantId = null, locale = 'en', showSso = true }: {
  email: string
  tenantId?: string | null
  locale?: string
  showSso?: boolean
}) {
  const [authOverride, setAuthOverride] = React.useState<AuthOverride | null>(null)
  const [pending, setAuthOverridePending] = React.useState(false)
  const searchParams = React.useMemo(() => new URLSearchParams(), [])
  const context = React.useMemo<LoginFormWidgetContext>(() => ({
    email,
    tenantId,
    searchParams,
    setAuthOverride,
    setAuthOverridePending,
    setError: noop,
  }), [email, tenantId, searchParams])
  return (
    <I18nProvider locale={locale} dict={{ 'sso.login.continueWithSso': locale === 'pl' ? 'Kontynuuj z SSO' : 'Continue with SSO' }}>
      <ProbeProvider email={email} setAuthOverride={setAuthOverride} />
      {showSso ? <SsoLoginWidget context={context} /> : null}
      <output data-testid="active-provider">{authOverride?.providerId ?? 'password'}</output>
      <output data-testid="provider-label">{authOverride?.providerLabel ?? 'Sign in'}</output>
      <output data-testid="discovery-pending">{String(pending)}</output>
    </I18nProvider>
  )
}

async function settleDiscovery() {
  await act(async () => { jest.advanceTimersByTime(350) })
}

describe('SSO login provider coexistence', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue(discoveryResult(false))
  })

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
  })

  it('preserves a fresh probe selection after settled no-match discovery', async () => {
    render(<LoginHarness email="user@probe.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    await settleDiscovery()
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    expect(screen.getByTestId('discovery-pending')).toHaveTextContent('false')
  })

  it('does not clear another provider when an inactive SSO widget mounts or unmounts', async () => {
    const view = render(<LoginHarness email="user@probe.example" showSso={false} />)
    view.rerender(<LoginHarness email="user@probe.example" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    view.rerender(<LoginHarness email="user@probe.example" showSso={false} />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
  })

  it('hands SSO back to the probe before and after the new lookup settles', async () => {
    apiCallMock.mockResolvedValueOnce(discoveryResult(true))
    const view = render(<LoginHarness email="user@sso.example" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('sso')
    view.rerender(<LoginHarness email="user@probe.example" />)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
  })

  it('keeps probe selection if its unrelated SSO lookup fails', async () => {
    apiCallMock.mockRejectedValueOnce(new Error('[internal] Discovery unavailable'))
    render(<LoginHarness email="user@probe.example" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    expect(screen.getByTestId('discovery-pending')).toHaveTextContent('false')
  })

  it('preserves active SSO across locale changes and still releases it for password login', async () => {
    apiCallMock.mockResolvedValueOnce(discoveryResult(true))
    const view = render(<LoginHarness email="user@sso.example" />)
    await settleDiscovery()
    view.rerender(<LoginHarness email="user@sso.example" locale="pl" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('sso')
    expect(screen.getByTestId('provider-label')).toHaveTextContent('Kontynuuj z SSO')
    view.rerender(<LoginHarness email="user@ordinary.example" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('password')
  })

  it('selects SSO after a probe-to-SSO handoff', async () => {
    const view = render(<LoginHarness email="user@probe.example" />)
    await settleDiscovery()
    apiCallMock.mockResolvedValueOnce(discoveryResult(true))
    view.rerender(<LoginHarness email="user@sso.example" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('sso')
  })

  it('ignores a stale positive response without ending the new lookup pending state', async () => {
    let resolveOld: ((value: ReturnType<typeof discoveryResult>) => void) | undefined
    let resolveNew: ((value: ReturnType<typeof discoveryResult>) => void) | undefined
    apiCallMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    apiCallMock.mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve }))
    const view = render(<LoginHarness email="old@sso.example" />)
    await settleDiscovery()
    view.rerender(<LoginHarness email="user@probe.example" />)
    await settleDiscovery()
    await act(async () => { resolveOld?.(discoveryResult(true)) })
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    expect(screen.getByTestId('discovery-pending')).toHaveTextContent('true')
    await act(async () => { resolveNew?.(discoveryResult(false)) })
    expect(screen.getByTestId('active-provider')).toHaveTextContent('probe')
    expect(screen.getByTestId('discovery-pending')).toHaveTextContent('false')
  })

  it('refreshes discovery when the tenant changes for the same email', async () => {
    apiCallMock.mockResolvedValueOnce(discoveryResult(true))
    const view = render(<LoginHarness email="user@sso.example" tenantId="tenant-one" />)
    await settleDiscovery()
    expect(screen.getByTestId('active-provider')).toHaveTextContent('sso')
    view.rerender(<LoginHarness email="user@sso.example" tenantId="tenant-two" />)
    await settleDiscovery()
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('active-provider')).toHaveTextContent('password')
  })
})
