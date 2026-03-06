'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import GenericProviderSetup from '../../../../components/GenericProviderSetup'
import MfaMethodCard from '../../../../components/MfaMethodCard'
import RecoveryCodesDisplay from '../../../../components/RecoveryCodesDisplay'
import { useMfaStatus } from '../../../../components/hooks/useMfaStatus'
import type { MfaMethod, MfaProvider } from '../../../../types'

export default function SecurityMfaPage() {
  const t = useT()
  const {
    loading,
    saving,
    methods,
    providers,
    recoveryCodes,
    reload,
    removeMethod,
    regenerateRecoveryCodes,
    setRecoveryCodes,
  } = useMfaStatus()
  const [activeGenericProvider, setActiveGenericProvider] = React.useState<string | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const handleRemove = React.useCallback(async (method: MfaMethod) => {
    const accepted = await confirm({
      title: t('security.profile.mfa.remove.title', 'Remove MFA method?'),
      text: t(
        'security.profile.mfa.remove.text',
        'This removes the selected MFA method. Continue?',
      ),
      variant: 'destructive',
      confirmText: t('security.profile.mfa.method.remove', 'Remove'),
      cancelText: t('ui.actions.cancel', 'Cancel'),
    })

    if (!accepted) return

    await removeMethod(method.id)
    flash(t('security.profile.mfa.remove.success', 'MFA method removed.'), 'success')
  }, [confirm, removeMethod, t])

  const handleRegenerateRecoveryCodes = React.useCallback(async () => {
    await regenerateRecoveryCodes()
    flash(t('security.profile.mfa.recovery.regenerated', 'Recovery codes regenerated.'), 'success')
  }, [regenerateRecoveryCodes, t])

  const handleProviderComplete = React.useCallback(async (codes: string[]) => {
    if (codes.length > 0) {
      setRecoveryCodes(codes)
    }
    setActiveGenericProvider(null)
    await reload()
  }, [reload, setRecoveryCodes])

  if (loading) {
    return <LoadingMessage label={t('security.profile.mfa.loading', 'Loading MFA settings...')} />
  }

  const activeMethodTypes = new Set(methods.map((method) => method.type))
  const availableProviders = providers.filter((provider) => provider.allowMultiple || !activeMethodTypes.has(provider.type))

  return (
    <section className="space-y-6">
      {ConfirmDialogElement}
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {t('security.profile.mfa.title', 'Multi-factor authentication')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('security.profile.mfa.description', 'Manage your MFA methods and recovery codes.')}
        </p>
      </header>

      <section className="space-y-3 rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">
            {t('security.profile.mfa.enrolled.title', 'Enrolled methods')}
          </h2>
        </div>
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('security.profile.mfa.enrolled.empty', 'No MFA methods enabled yet.')}
          </p>
        ) : (
          <div className="grid gap-3">
            {methods.map((method) => (
              <MfaMethodCard
                key={method.id}
                method={method}
                removing={saving}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-background p-4">
        <h2 className="text-base font-medium">
          {t('security.profile.mfa.providers.title', 'Add method')}
        </h2>
        {availableProviders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('security.profile.mfa.providers.empty', 'No additional MFA providers are currently available.')}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {availableProviders.map((provider) => (
              <ProviderCard
                key={provider.type}
                provider={provider}
                active={activeGenericProvider === provider.type}
                onActivate={() => setActiveGenericProvider(provider.type)}
                onDeactivate={() => setActiveGenericProvider(null)}
                onComplete={handleProviderComplete}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">
            {t('security.profile.mfa.recovery.sectionTitle', 'Recovery codes')}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRegenerateRecoveryCodes}
            disabled={saving}
          >
            {t('security.profile.mfa.recovery.regenerate', 'Regenerate codes')}
          </Button>
        </div>
        <RecoveryCodesDisplay codes={recoveryCodes} />
      </section>
    </section>
  )
}

type ProviderCardProps = {
  provider: MfaProvider
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
  onComplete: (codes: string[]) => Promise<void>
}

function ProviderCard({ provider, active, onActivate, onDeactivate, onComplete }: ProviderCardProps) {
  const t = useT()

  if (provider.type === 'totp') {
    return (
      <article className="rounded-md border p-4">
        <h3 className="text-sm font-medium">{provider.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{provider.type}</p>
        <Button type="button" size="sm" className="mt-3" asChild>
          <Link href="/backend/profile/security/mfa/setup-totp">
            {t('security.profile.mfa.providers.setupTotp', 'Set up TOTP')}
          </Link>
        </Button>
      </article>
    )
  }

  if (provider.type === 'passkey') {
    return (
      <article className="rounded-md border p-4">
        <h3 className="text-sm font-medium">{provider.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{provider.type}</p>
        <Button type="button" size="sm" className="mt-3" asChild>
          <Link href="/backend/profile/security/mfa/setup-passkey">
            {t('security.profile.mfa.providers.setupPasskey', 'Set up passkey')}
          </Link>
        </Button>
      </article>
    )
  }

  if (provider.type === 'otp_email') {
    return (
      <article className="rounded-md border p-4">
        <h3 className="text-sm font-medium">{provider.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{provider.type}</p>
        <EnableOtpEmailButton onComplete={onComplete} />
      </article>
    )
  }

  return (
    <article className="space-y-3 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-medium">{provider.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{provider.type}</p>
      </div>
      {!active ? (
        <Button type="button" size="sm" onClick={onActivate}>
          {t('security.profile.mfa.providers.setupGeneric', 'Set up provider')}
        </Button>
      ) : (
        <GenericProviderSetup
          providerType={provider.type}
          providerLabel={provider.label}
          onComplete={onComplete}
          onCancel={onDeactivate}
        />
      )}
    </article>
  )
}

function EnableOtpEmailButton({ onComplete }: { onComplete: (codes: string[]) => Promise<void> }) {
  const t = useT()
  const [loading, setLoading] = React.useState(false)

  return (
    <Button
      type="button"
      size="sm"
      className="mt-3"
      disabled={loading}
      onClick={async () => {
        setLoading(true)
        try {
          const result = await readApiResultOrThrow<{ recoveryCodes?: string[] }>(
            '/api/security/mfa/otp-email/setup',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({}),
            },
          )
          await onComplete(Array.isArray(result.recoveryCodes) ? result.recoveryCodes : [])
          flash(t('security.profile.mfa.providers.otpEnabled', 'Email OTP enabled.'), 'success')
        } finally {
          setLoading(false)
        }
      }}
    >
      {t('security.profile.mfa.providers.setupOtpEmail', 'Enable email OTP')}
    </Button>
  )
}
