'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import RecoveryCodesDisplay from './RecoveryCodesDisplay'

type TotpSetupResponse = {
  setupId: string
  secret: string
  uri: string
  qrDataUrl: string
}

type TotpConfirmResponse = {
  ok?: boolean
  recoveryCodes?: string[]
}

export default function TotpSetupWizard() {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [setup, setSetup] = React.useState<TotpSetupResponse | null>(null)
  const [code, setCode] = React.useState('')
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])

  const startSetup = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<TotpSetupResponse>(
        '/api/security/mfa/totp/setup',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      setSetup(result)
    } finally {
      setLoading(false)
    }
  }, [])

  const confirmSetup = React.useCallback(async () => {
    if (!setup || code.trim().length === 0) return
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<TotpConfirmResponse>(
        '/api/security/mfa/totp/confirm',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ setupId: setup.setupId, code: code.trim() }),
        },
      )
      setRecoveryCodes(Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [])
      setCode('')
      flash(t('security.profile.mfa.totp.confirmSuccess', 'TOTP method enabled.'), 'success')
    } finally {
      setLoading(false)
    }
  }, [code, setup, t])

  return (
    <section className="space-y-4 rounded-lg border bg-background p-6">
      <h2 className="text-lg font-semibold">
        {t('security.profile.mfa.totp.title', 'TOTP setup')}
      </h2>

      {setup == null ? (
        <Button type="button" disabled={loading} onClick={startSetup}>
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('security.profile.mfa.totp.start', 'Start setup')}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t('security.profile.mfa.totp.secret', 'Manual secret')}
            </p>
            <code className="text-sm">{setup.secret}</code>
          </div>
          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t('security.profile.mfa.totp.uri', 'Provisioning URI')}
            </p>
            <code className="break-all text-xs">{setup.uri}</code>
          </div>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('security.profile.mfa.totp.codePlaceholder', 'Enter 6-digit code')}
            maxLength={6}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={confirmSetup} disabled={loading || code.trim().length < 6}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {t('security.profile.mfa.totp.confirm', 'Confirm TOTP')}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/backend/profile/security/mfa')}>
              {t('ui.actions.back', 'Back')}
            </Button>
          </div>
        </div>
      )}

      <RecoveryCodesDisplay codes={recoveryCodes} />
    </section>
  )
}
