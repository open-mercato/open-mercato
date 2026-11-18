'use client'

import * as React from 'react'
import { useMfaMutation } from './hooks/useMfaMutation'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, Mail, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { MfaMethod } from '../types'
import MfaConfiguredBadge from './mfa-provider-list-items/MfaConfiguredBadge'

type OtpEmailProviderDetailsProps = {
  methods?: MfaMethod[]
  saving?: boolean
  onRemoveMethod?: (method: MfaMethod) => Promise<void>
  onMethodsChanged?: () => Promise<void>
}

type OtpSetupResponse = {
  setupId?: string
  clientData?: Record<string, unknown>
}

type OtpConfirmResponse = {
  ok?: boolean
  recoveryCodes?: string[]
}

function formatRelative(value: string | null, fallback: string): string {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return formatDistanceToNow(parsed, { addSuffix: true })
}

function readMetadataEmail(method: MfaMethod): string | null {
  const emailValue = method.providerMetadata?.email
  if (typeof emailValue !== 'string' || emailValue.length === 0) return null
  return emailValue
}

export default function OtpEmailProviderDetails({
  methods = [],
  saving = false,
  onRemoveMethod,
  onMethodsChanged,
}: OtpEmailProviderDetailsProps) {
  const t = useT()
  const mutateMfa = useMfaMutation()
  const [loading, setLoading] = React.useState(false)
  const [setupId, setSetupId] = React.useState<string | null>(null)
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const configuredMethod = methods[0] ?? null
  const configuredEmail = configuredMethod ? readMetadataEmail(configuredMethod) : null

  const handleEnable = React.useCallback(async () => {
    if (loading || configuredMethod) return
    setLoading(true)
    setError(null)
    try {
      const setup = await mutateMfa<OtpSetupResponse>(
        '/api/security/mfa/provider/otp_email',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      if (!setup.setupId) {
        throw new Error('[internal] Missing setupId')
      }
      setSetupId(setup.setupId)
      setCode('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('security.api.errors.mfaRequestFailed'))
    } finally {
      setLoading(false)
    }
  }, [configuredMethod, loading, mutateMfa, t])

  const confirmSetup = React.useCallback(async () => {
    if (!setupId || loading || !/^\d{6}$/.test(code)) return
    setLoading(true)
    setError(null)
    try {
      await mutateMfa<OtpConfirmResponse>('/api/security/mfa/provider/otp_email', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupId, payload: { code } }),
      })
      setSetupId(null)
      setCode('')
      await onMethodsChanged?.()
      flash(t('security.profile.mfa.providers.otpEmail.enabled', 'Email OTP enabled.'), 'success')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('security.api.errors.mfaRequestFailed'))
    } finally {
      setLoading(false)
    }
  }, [code, loading, mutateMfa, onMethodsChanged, setupId, t])

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 text-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="size-4 text-foreground" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {t('security.profile.mfa.providers.otpEmail.title', 'Email OTP')}
            </h2>
            {configuredMethod ? (
                <MfaConfiguredBadge label={t('security.profile.mfa.providers.totp.configured', 'Configured')} />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(
              'security.profile.mfa.providers.otpEmail.description',
              'Receive one-time verification codes by email when signing in.',
            )}
          </p>
        </div>
      </div>

      {configuredMethod ? (
        <article className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-none last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {configuredMethod.label ?? t('security.profile.mfa.providers.otpEmail.title', 'Email OTP')}
            </p>
            {configuredEmail ? (
              <p className="truncate text-xs text-muted-foreground">{configuredEmail}</p>
            ) : null}
            <p className="truncate text-xs text-muted-foreground">
              {t('security.profile.mfa.method.lastUsed', 'Last used')}:{' '}
              {formatRelative(configuredMethod.lastUsedAt, t('security.profile.mfa.method.neverUsed', 'Never used'))}
            </p>
          </div>
          {onRemoveMethod ? (
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || loading}
              aria-label={t('ui.actions.delete', 'Delete')}
              title={t('ui.actions.delete', 'Delete')}
              onClick={() => {
                void onRemoveMethod(configuredMethod)
              }}
            >
              <Trash2 className="size-4 text-status-error-text" />
            </IconButton>
          ) : null}
        </article>
      ) : (
        <div className="grid gap-3">
          {error ? <ErrorMessage label={error} /> : null}
          {setupId ? (
            <form onSubmit={(event) => { event.preventDefault(); void confirmSetup() }} className="grid gap-3"
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setSetupId(null); setCode('') }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void confirmSetup() }
              }}>
              <Label htmlFor="mfa-email-setup-code">{t('security.login.mfaChallenge.otpEmail.codeLabel')}</Label>
              <p className="text-sm text-muted-foreground">{t('security.login.mfaChallenge.otpEmail.description')}</p>
              <Input id="mfa-email-setup-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6}
                value={code} onChange={(event) => setCode(event.target.value)} />
              <Button type="submit" disabled={loading || !/^\d{6}$/.test(code)}>{t('security.profile.mfa.generic.confirm')}</Button>
              <Button type="button" variant="outline" disabled={loading} onClick={() => setSetupId(null)}>{t('ui.actions.cancel')}</Button>
            </form>
          ) : null}
          <Button
            type="button"
            disabled={loading || saving || setupId !== null}
            className="h-10"
            onClick={() => {
              void handleEnable()
            }}
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('security.profile.mfa.providers.setupOtpEmail', 'Enable email OTP')}
          </Button>
        </div>
      )}
    </section>
  )
}
