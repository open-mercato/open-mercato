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

type RegisterOptionsResponse = {
  setupId: string
  options: Record<string, unknown>
}

type RegisterResponse = {
  ok?: boolean
  recoveryCodes?: string[]
}

export default function PasskeySetupFlow() {
  const t = useT()
  const router = useRouter()
  const [label, setLabel] = React.useState('')
  const [attachment, setAttachment] = React.useState<'platform' | 'cross-platform'>('platform')
  const [setupId, setSetupId] = React.useState<string | null>(null)
  const [challenge, setChallenge] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])

  const startSetup = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<RegisterOptionsResponse>(
        '/api/security/mfa/passkey/register-options',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: label.trim() || undefined,
            authenticatorAttachment: attachment,
          }),
        },
      )

      setSetupId(result.setupId)
      const challengeRaw = result.options?.challenge
      setChallenge(typeof challengeRaw === 'string' ? challengeRaw : null)
    } finally {
      setLoading(false)
    }
  }, [attachment, label])

  const registerPasskey = React.useCallback(async () => {
    if (!setupId || !challenge) return
    setLoading(true)
    try {
      const credentialId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`

      const result = await readApiResultOrThrow<RegisterResponse>(
        '/api/security/mfa/passkey/register',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            setupId,
            challenge,
            credentialId,
            publicKey: `pk-${credentialId}`,
            transports: attachment === 'platform' ? ['internal'] : ['usb'],
            label: label.trim() || undefined,
          }),
        },
      )

      setRecoveryCodes(Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [])
      flash(t('security.profile.mfa.passkey.success', 'Passkey enabled.'), 'success')
    } finally {
      setLoading(false)
    }
  }, [attachment, challenge, label, setupId, t])

  return (
    <section className="space-y-4 rounded-lg border bg-background p-6">
      <h2 className="text-lg font-semibold">
        {t('security.profile.mfa.passkey.title', 'Passkey setup')}
      </h2>

      <label className="block space-y-1">
        <span className="text-sm text-muted-foreground">
          {t('security.profile.mfa.passkey.label', 'Label')}
        </span>
        <Input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-muted-foreground">
          {t('security.profile.mfa.passkey.authenticator', 'Authenticator type')}
        </span>
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={attachment}
          onChange={(event) => {
            const nextValue = event.target.value === 'cross-platform' ? 'cross-platform' : 'platform'
            setAttachment(nextValue)
          }}
        >
          <option value="platform">
            {t('security.profile.mfa.passkey.platform', 'This device')}
          </option>
          <option value="cross-platform">
            {t('security.profile.mfa.passkey.crossPlatform', 'Security key')}
          </option>
        </select>
      </label>

      {setupId == null ? (
        <Button type="button" onClick={startSetup} disabled={loading}>
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('security.profile.mfa.passkey.start', 'Start setup')}
        </Button>
      ) : (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            {t('security.profile.mfa.passkey.ready', 'Passkey registration options are ready.')}
          </p>
          <Button type="button" onClick={registerPasskey} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('security.profile.mfa.passkey.register', 'Register passkey')}
          </Button>
        </div>
      )}

      <div>
        <Button type="button" variant="outline" onClick={() => router.push('/backend/profile/security/mfa')}>
          {t('ui.actions.back', 'Back')}
        </Button>
      </div>

      <RecoveryCodesDisplay codes={recoveryCodes} />
    </section>
  )
}
