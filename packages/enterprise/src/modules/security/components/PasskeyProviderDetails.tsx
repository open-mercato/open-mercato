'use client'

import * as React from 'react'
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { formatDistanceToNow } from 'date-fns'
import { Eye, EyeOff, Loader2, Shield, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import type { MfaMethod } from '../types'
import MfaConfiguredBadge from './mfa-provider-list-items/MfaConfiguredBadge'

type RegisterOptionsResponse = {
  setupId: string
  clientData?: Record<string, unknown>
}

type RegisterResponse = {
  ok?: boolean
  recoveryCodes?: string[]
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Passkey registration failed.'
}

function isAbortError(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'AbortError' || name === 'NotAllowedError') {
    return true
  }

  const message = readErrorMessage(error).toLowerCase()
  return message.includes('cancel') || message.includes('aborted') || message.includes('not allowed')
}

type PasskeyProviderDetailsProps = {
  methods?: MfaMethod[]
  saving?: boolean
  onRemoveMethod?: (method: MfaMethod) => Promise<void> | void
  onMethodAdded?: () => Promise<void> | void
}

function formatRelative(value: string | null, fallback: string): string {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return formatDistanceToNow(parsed, { addSuffix: true })
}

export default function PasskeyProviderDetails({
  methods = [],
  saving = false,
  onRemoveMethod,
  onMethodAdded,
}: PasskeyProviderDetailsProps) {
  const t = useT()
  const [label, setLabel] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const handleAddPasskey = React.useCallback(async () => {
    if (!browserSupportsWebAuthn()) {
      flash(
        t('security.profile.mfa.passkey.unsupported', 'Passkeys are not supported by this browser.'),
        'error',
      )
      return
    }

    setLoading(true)
    try {
      const optionsResult = await readApiResultOrThrow<RegisterOptionsResponse>(
        '/api/security/mfa/provider/passkey',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: label.trim() || undefined,
          }),
        },
      )

      const registrationResponse = await startRegistration({
        optionsJSON: (optionsResult.clientData ?? {}) as never,
      })

      await readApiResultOrThrow<RegisterResponse>(
        '/api/security/mfa/provider/passkey',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            setupId: optionsResult.setupId,
            payload: {
              response: registrationResponse,
              label: label.trim() || undefined,
            },
          }),
        },
      )

      setLabel('')
      await onMethodAdded?.()
      flash(t('security.profile.mfa.passkey.success', 'Passkey enabled.'), 'success')
    } catch (error) {
      if (!isAbortError(error)) {
        flash(readErrorMessage(error), 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [label, onMethodAdded, t])

  const configuredCount = methods.length
  const keysLabel = configuredCount === 1
    ? t('security.profile.mfa.providers.passkey.keySingle', '1 key')
    : t('security.profile.mfa.providers.passkey.keyMany', '{count} keys', { count: String(configuredCount) })

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Shield className="size-4 text-slate-100" aria-hidden="true" />
            <h2 className="text-lg font-semibold">
              {t('security.profile.mfa.passkey.title', 'Security keys')}
            </h2>
            {configuredCount > 0 ? (
              <MfaConfiguredBadge label={t('security.profile.mfa.providers.totp.configured', 'Configured')} />
            ) : null}
            <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-200">
              {keysLabel}
            </Badge>
          </div>
          <p className="text-sm text-slate-300">
            {t(
              'security.profile.mfa.passkey.description',
              'Security keys are WebAuthn credentials that can only be used as a second factor of authentication.',
            )}
          </p>
        </div>
      </div>

      {configuredCount > 0 ? (
        <div className="space-y-2">
          {methods.map((method) => (
            <article
              key={method.id}
              className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 last:border-none last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">
                  {method.label ?? t('security.profile.mfa.providers.passkey.title', 'Security key')}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {t('ui.table.registeredAt', 'Registered')}: {formatRelative(method.createdAt, t('security.profile.mfa.method.unknownTime', 'Unknown'))}
                  {' '}|{' '}
                  {t('security.profile.mfa.method.lastUsed', 'Last used')}: {formatRelative(method.lastUsedAt, t('security.profile.mfa.method.neverUsed', 'Never used'))}
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
      ) : null}

      <form
        className="flex items-center gap-0 space-x-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (loading) return
          void handleAddPasskey()
        }}
      >
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t('security.profile.mfa.passkey.nicknamePlaceholder', 'Enter a nickname for this security key')}
          className="h-10  border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
        />
        <Button
          type="submit"
          disabled={loading || saving}
          variant="outline"
          className="h-10 border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
        >
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('ui.actions.add', 'Add')}
        </Button>
      </form>
    </section>
  )
}
