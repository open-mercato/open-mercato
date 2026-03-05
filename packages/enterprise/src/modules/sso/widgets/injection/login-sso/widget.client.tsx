"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

const SSO_ERROR_CODES = [
  'sso_failed',
  'sso_missing_config',
  'sso_email_not_verified',
  'sso_state_missing',
  'sso_idp_error',
  'sso_missing_params',
] as const

const HRD_DEBOUNCE_MS = 300

type HrdResponse = {
  hasSso: boolean
  configId?: string
  protocol?: string
}

export default function SsoLoginWidget({ context }: InjectionWidgetComponentProps<LoginFormWidgetContext>) {
  const t = useT()
  const translate = useCallback(
    (key: string, fallback: string) => translateWithFallback(t, key, fallback),
    [t],
  )
  const [ssoActive, setSsoActive] = useState(false)
  const lastCheckedEmail = useRef('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const errorParam = context.searchParams.get('error')
    if (!errorParam) return

    const errorMessages: Record<string, string> = {
      sso_failed: translate('sso.login.errors.failed', 'SSO login failed. Please try again.'),
      sso_missing_config: translate('sso.login.errors.missingConfig', 'SSO is not configured for this account.'),
      sso_email_not_verified: translate('sso.login.errors.emailNotVerified', 'Your email address is not verified by the identity provider. Please verify your email and try again.'),
      sso_state_missing: translate('sso.login.errors.stateMissing', 'SSO session expired. Please try again.'),
      sso_idp_error: translate('sso.login.errors.idpError', 'The identity provider returned an error. Please try again or contact your administrator.'),
      sso_missing_params: translate('sso.login.errors.missingParams', 'SSO callback was incomplete. Please try again.'),
    }

    if (SSO_ERROR_CODES.includes(errorParam as typeof SSO_ERROR_CODES[number])) {
      context.setError(errorMessages[errorParam] ?? errorMessages.sso_failed)
    }
  }, [context.searchParams, context.setError, translate])

  const checkHrd = useCallback(async (email: string) => {
    if (!email || !email.includes('@')) {
      context.setAuthOverride(null)
      setSsoActive(false)
      lastCheckedEmail.current = ''
      return
    }

    if (email === lastCheckedEmail.current) return
    lastCheckedEmail.current = email

    try {
      const body: Record<string, string> = { email }
      if (context.tenantId) {
        body.tenantId = context.tenantId
      }

      const res = await apiCall<HrdResponse>(
        '/api/sso/hrd',
        { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      )

      if (res.result?.hasSso && res.result.configId) {
        const configId = res.result.configId
        setSsoActive(true)
        context.setAuthOverride({
          providerId: 'sso',
          providerLabel: translate('sso.login.continueWithSso', 'Continue with SSO'),
          onSubmit: () => {
            const returnUrl = context.searchParams.get('returnUrl') || '/backend'
            window.location.href = `/api/sso/initiate?configId=${encodeURIComponent(configId)}&returnUrl=${encodeURIComponent(returnUrl)}`
          },
          hidePassword: true,
          hideRememberMe: true,
          hideForgotPassword: true,
        })
      } else {
        setSsoActive(false)
        context.setAuthOverride(null)
      }
    } catch {
      setSsoActive(false)
      context.setAuthOverride(null)
    }
  }, [context, translate])

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    if (!context.email) {
      setSsoActive(false)
      context.setAuthOverride(null)
      lastCheckedEmail.current = ''
      return
    }

    debounceTimer.current = setTimeout(() => {
      checkHrd(context.email)
    }, HRD_DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [context.email, checkHrd])

  if (!ssoActive) return null

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs text-blue-800">
      {translate('sso.login.ssoEnabled', 'SSO is enabled for this account')}
    </div>
  )
}
