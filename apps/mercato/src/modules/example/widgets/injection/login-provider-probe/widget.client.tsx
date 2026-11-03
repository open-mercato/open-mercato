"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const LOGIN_PROVIDER_PROBE_DOMAIN = '@login-probe.example'
const PROVIDER_ID = 'example-login-probe'

export default function LoginProviderProbeWidget({ context }: InjectionWidgetComponentProps<LoginFormWidgetContext>) {
  const t = useT()
  const [submitted, setSubmitted] = React.useState(false)
  const claimsFlow = context.email.trim().toLowerCase().endsWith(LOGIN_PROVIDER_PROBE_DOMAIN)
  const { setAuthOverride } = context
  const providerLabel = t('example.loginProbe.continue', 'Continue with probe provider')

  React.useEffect(() => {
    if (!claimsFlow) {
      setAuthOverride(null)
      setSubmitted(false)
      return
    }
    setAuthOverride({
      providerId: PROVIDER_ID,
      providerLabel,
      onSubmit: () => setSubmitted(true),
      hidePassword: true,
      hideRememberMe: true,
      hideForgotPassword: true,
    })
    return () => setAuthOverride(null)
  }, [claimsFlow, providerLabel, setAuthOverride])

  return (
    <div data-testid="example-login-provider-probe" data-active={claimsFlow ? '1' : '0'} hidden={!claimsFlow} className="text-xs text-muted-foreground">
      {claimsFlow ? (
        <span data-testid="example-login-provider-probe-active">
          {t('example.loginProbe.active', 'Alternative sign-in claimed this email domain.')}
        </span>
      ) : null}
      {submitted ? (
        <span data-testid="example-login-provider-probe-submitted" role="status">
          {t('example.loginProbe.submitted', 'Probe provider received the sign-in.')}
        </span>
      ) : null}
    </div>
  )
}
