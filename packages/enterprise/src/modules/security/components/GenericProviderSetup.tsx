'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'

type SetupResponse = {
  setupId?: string
  clientData?: Record<string, unknown>
}

type ConfirmResponse = {
  ok?: boolean
  recoveryCodes?: string[]
}

type GenericProviderSetupProps = {
  providerType: string
  providerLabel: string
  onComplete?: (recoveryCodes: string[]) => void
  onCancel?: () => void
}

function parseJsonRecord(value: string): Record<string, unknown> {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

export default function GenericProviderSetup({
  providerType,
  providerLabel,
  onComplete,
  onCancel,
}: GenericProviderSetupProps) {
  const t = useT()
  const [setupId, setSetupId] = React.useState<string | null>(null)
  const [clientData, setClientData] = React.useState<Record<string, unknown>>({})
  const [setupPayload, setSetupPayload] = React.useState('{}')
  const [verifyCode, setVerifyCode] = React.useState('')
  const [working, setWorking] = React.useState(false)

  const setupMode = setupId == null

  const handleSetup = React.useCallback(async () => {
    if (working) return
    setWorking(true)
    try {
      const payload = parseJsonRecord(setupPayload)
      const response = await readApiResultOrThrow<SetupResponse>(
        `/api/security/mfa/provider/${encodeURIComponent(providerType)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      if (!response?.setupId) {
        throw new Error('Missing setupId')
      }

      setSetupId(response.setupId)
      setClientData(response.clientData ?? {})
      flash(
        t('security.profile.mfa.generic.setupStarted', 'Provider setup started.'),
        'success',
      )
    } finally {
      setWorking(false)
    }
  }, [providerType, setupPayload, t, working])

  const handleConfirm = React.useCallback(async () => {
    if (!setupId || working) return
    setWorking(true)
    try {
      const payload = verifyCode.trim()
        ? { code: verifyCode.trim() }
        : parseJsonRecord(setupPayload)

      const response = await readApiResultOrThrow<ConfirmResponse>(
        `/api/security/mfa/provider/${encodeURIComponent(providerType)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ setupId, payload }),
        },
      )

      const codes = Array.isArray(response?.recoveryCodes) ? response.recoveryCodes : []
      onComplete?.(codes)
      setSetupId(null)
      setClientData({})
      setVerifyCode('')
      flash(
        t('security.profile.mfa.generic.setupComplete', 'MFA method enabled.'),
        'success',
      )
    } finally {
      setWorking(false)
    }
  }, [onComplete, providerType, setupId, setupPayload, t, verifyCode, working])

  return (
    <section className="space-y-3 rounded-md border p-4">
      <h3 className="text-sm font-semibold">
        {t('security.profile.mfa.generic.setupTitle', 'Configure {provider}', { provider: providerLabel })}
      </h3>

      {setupMode ? (
        <>
          <label className="block text-xs text-muted-foreground" htmlFor={`generic-provider-payload-${providerType}`}>
            {t('security.profile.mfa.generic.payload', 'Setup payload (JSON)')}
          </label>
          <textarea
            id={`generic-provider-payload-${providerType}`}
            className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={setupPayload}
            onChange={(event) => setSetupPayload(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button type="button" onClick={handleSetup} disabled={working}>
              {working ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t('security.profile.mfa.generic.start', 'Start setup')}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                {t('ui.actions.cancel', 'Cancel')}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t('security.profile.mfa.generic.clientData', 'Setup response data')}
            </p>
            <pre className="overflow-x-auto text-xs">{JSON.stringify(clientData, null, 2)}</pre>
          </div>
          <label className="block text-xs text-muted-foreground" htmlFor={`generic-provider-verify-${providerType}`}>
            {t('security.profile.mfa.generic.verifyCode', 'Verification code (if required)')}
          </label>
          <Input
            id={`generic-provider-verify-${providerType}`}
            value={verifyCode}
            onChange={(event) => setVerifyCode(event.target.value)}
            placeholder={t('security.profile.mfa.generic.verifyCodePlaceholder', 'Enter verification code')}
          />
          <div className="flex items-center gap-2">
            <Button type="button" onClick={handleConfirm} disabled={working}>
              {working ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t('security.profile.mfa.generic.confirm', 'Confirm setup')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSetupId(null)
                setClientData({})
                setVerifyCode('')
              }}
              disabled={working}
            >
              {t('security.profile.mfa.generic.restart', 'Restart')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
