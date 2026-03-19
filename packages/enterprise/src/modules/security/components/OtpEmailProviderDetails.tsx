'use client'

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, Mail, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
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
  const [loading, setLoading] = React.useState(false)

  const configuredMethod = methods[0] ?? null
  const configuredEmail = configuredMethod ? readMetadataEmail(configuredMethod) : null

  const handleEnable = React.useCallback(async () => {
    if (loading || configuredMethod) return
    setLoading(true)
    try {
      const setup = await readApiResultOrThrow<OtpSetupResponse>(
        '/api/security/mfa/provider/otp_email',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      if (!setup.setupId) {
        throw new Error('Missing setupId')
      }
      await readApiResultOrThrow<OtpConfirmResponse>(
        '/api/security/mfa/provider/otp_email',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            setupId: setup.setupId,
            payload: {},
          }),
        },
      )
      await onMethodsChanged?.()
      flash(t('security.profile.mfa.providers.otpEmail.enabled', 'Email OTP enabled.'), 'success')
    } finally {
      setLoading(false)
    }
  }, [configuredMethod, loading, onMethodsChanged, t])

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="size-4 text-slate-100" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {t('security.profile.mfa.providers.otpEmail.title', 'Email OTP')}
            </h2>
            {configuredMethod ? (
                <MfaConfiguredBadge label={t('security.profile.mfa.providers.totp.configured', 'Configured')} />
            ) : null}
          </div>
          <p className="text-sm text-slate-300">
            {t(
              'security.profile.mfa.providers.otpEmail.description',
              'Receive one-time verification codes by email when signing in.',
            )}
          </p>
        </div>
      </div>

      {configuredMethod ? (
        <article className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 last:border-none last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-100">
              {configuredMethod.label ?? t('security.profile.mfa.providers.otpEmail.title', 'Email OTP')}
            </p>
            {configuredEmail ? (
              <p className="truncate text-xs text-slate-400">{configuredEmail}</p>
            ) : null}
            <p className="truncate text-xs text-slate-400">
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
              <Trash2 className="size-4 text-red-400" />
            </IconButton>
          ) : null}
        </article>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            disabled={loading || saving}
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
