'use client'

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, Smartphone, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation.js'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { MfaMethod } from '../types'
import MfaConfiguredBadge from './mfa-provider-list-items/MfaConfiguredBadge'

type TotpSetupResponse = {
  setupId?: string
  clientData?: Record<string, unknown>
  secret?: string
  uri?: string
  qrDataUrl?: string
}

type TotpSetupState = {
  setupId: string
  secret: string | null
  uri: string | null
  qrDataUrl: string | null
}

type TotpConfirmResponse = {
  ok?: boolean
}

type TotpProviderDetailsProps = {
  methods?: MfaMethod[]
  saving?: boolean
  onRemoveMethod?: (method: MfaMethod) => Promise<void> | void
  onMethodsChanged?: () => Promise<void> | void
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTotpSetupResponse(response: TotpSetupResponse): TotpSetupState {
  const setupId = readNonEmptyString(response.setupId)
  if (!setupId) {
    throw new Error('Missing setupId')
  }

  const clientData = response.clientData && typeof response.clientData === 'object'
    ? response.clientData
    : {}

  return {
    setupId,
    secret: readNonEmptyString(clientData.secret) ?? readNonEmptyString(response.secret),
    uri: readNonEmptyString(clientData.uri) ?? readNonEmptyString(response.uri),
    qrDataUrl: readNonEmptyString(clientData.qrDataUrl) ?? readNonEmptyString(response.qrDataUrl),
  }
}

function formatRelative(value: string | null, fallback: string): string {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return formatDistanceToNow(parsed, { addSuffix: true })
}

export default function TotpProviderDetails({
  methods = [],
  saving = false,
  onRemoveMethod,
  onMethodsChanged,
}: TotpProviderDetailsProps) {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [setup, setSetup] = React.useState<TotpSetupState | null>(null)
  const [setupError, setSetupError] = React.useState<string | null>(null)
  const [showManualSecret, setShowManualSecret] = React.useState(false)
  const [code, setCode] = React.useState('')
  const hasConfiguredMethod = methods.length > 0

  const startSetup = React.useCallback(async () => {
    if (hasConfiguredMethod) return
    setLoading(true)
    setSetupError(null)
    try {
      const result = await readApiResultOrThrow<TotpSetupResponse>(
        '/api/security/mfa/provider/totp',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      setSetup(normalizeTotpSetupResponse(result))
      setShowManualSecret(false)
      setCode('')
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('security.profile.mfa.totp.setupError', 'Failed to prepare authenticator setup.')
      setSetupError(message)
    } finally {
      setLoading(false)
    }
  }, [hasConfiguredMethod, t])

  const confirmSetup = React.useCallback(async () => {
    if (!setup || hasConfiguredMethod || code.trim().length === 0) return
    setLoading(true)
    setSetupError(null)
    try {
      await readApiResultOrThrow<TotpConfirmResponse>(
        '/api/security/mfa/provider/totp',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ setupId: setup.setupId, payload: { code: code.trim() } }),
        },
      )
      setCode('')
      setSetup(null)
      setShowManualSecret(false)
      flash(t('security.profile.mfa.totp.confirmSuccess', 'TOTP method enabled.'), 'success')
      if (onMethodsChanged) {
        try {
          await onMethodsChanged()
        } catch {
          router.push('/backend/profile/security/mfa')
        }
      } else {
        router.push('/backend/profile/security/mfa')
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('security.profile.mfa.totp.confirmError', 'Failed to enable authenticator app.')
      setSetupError(message)
    } finally {
      setLoading(false)
    }
  }, [code, hasConfiguredMethod, onMethodsChanged, router, setup, t])

  React.useEffect(() => {
    if (hasConfiguredMethod || setup != null) return
    void startSetup()
  }, [hasConfiguredMethod, setup, startSetup])

  const handleCancel = React.useCallback(() => {
    router.push('/backend/profile/security/mfa')
  }, [router])

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Smartphone className="size-4 text-slate-100" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {t('security.profile.mfa.providers.totp.title', 'Authenticator app')}
            </h2>
            {hasConfiguredMethod ? (
              <MfaConfiguredBadge label={t('security.profile.mfa.providers.totp.configured', 'Configured')} />
            ) : null}
          </div>
          <p className="text-sm text-slate-300">
            {t(
              'security.profile.mfa.providers.totp.description',
              'Use an authenticator app or browser extension to get two-factor authentication codes when prompted.',
            )}
          </p>
        </div>
      </div>

      {hasConfiguredMethod ? (
        <div className="space-y-2">
          {methods.map((method) => (
            <article
              key={method.id}
              className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 last:border-none last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">
                  {method.label ?? t('security.profile.mfa.providers.totp.title', 'Authenticator app')}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {t('ui.table.registeredAt', 'Registered')}:{' '}
                  {formatRelative(
                    method.createdAt,
                    t('security.profile.mfa.method.unknownTime', 'Unknown'),
                  )}
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
                    void onRemoveMethod(method)
                  }}
                >
                  <Trash2 className="size-4 text-red-400" />
                </IconButton>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-base font-semibold">
              {t('security.profile.mfa.totp.scanTitle', 'Scan the QR code')}
            </h3>
            <p className="text-sm text-slate-300">
              {t(
                'security.profile.mfa.totp.scanInstructions',
                'Use an authenticator app or browser extension to scan this code.',
              )}
            </p>
            {setup?.qrDataUrl ? (
              <Image
                src={setup.qrDataUrl}
                alt={t('security.profile.mfa.totp.qrAlt', 'TOTP QR code')}
                width={224}
                height={224}
                unoptimized
                className="size-56 rounded-md border border-slate-700 bg-white p-2"
              />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-sm text-slate-300">
                {loading
                  ? t('security.profile.mfa.totp.loadingQr', 'Preparing QR code...')
                  : t('security.profile.mfa.totp.loadingQrFallback', 'QR code unavailable')}
              </div>
            )}

            <p className="text-sm text-slate-300">
              {t(
                'security.profile.mfa.totp.manualHint',
                'Unable to scan? You can use a setup key to configure your authenticator app.',
              )}
            </p>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm text-blue-400"
              onClick={() => setShowManualSecret((prev) => !prev)}
            >
              {showManualSecret
                ? t('security.profile.mfa.totp.hideManual', 'Hide setup key')
                : t('security.profile.mfa.totp.showManual', 'Show setup key')}
            </Button>
            {showManualSecret && setup?.secret ? (
              <div className="rounded-md border border-slate-700 bg-slate-900 p-3">
                <code className="break-all text-sm text-slate-100">{setup.secret}</code>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-semibold">
              {t('security.profile.mfa.totp.verifyTitle', 'Verify the code from the app')}
            </h3>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t('security.profile.mfa.totp.codePlaceholder', 'XXXXXX')}
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-10 max-w-xs border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={confirmSetup}
                disabled={loading || !setup || code.trim().length < 6}
                className="h-10"
              >
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {t('ui.actions.save', 'Save')}
              </Button>
              <Button type="button" variant="outline" className="h-10" onClick={handleCancel}>
                {t('ui.actions.cancel', 'Cancel')}
              </Button>
            </div>
          </div>
        </>
      )}

      {setupError ? (
        <p className="text-sm text-red-400" role="alert">{setupError}</p>
      ) : null}
    </section>
  )
}
