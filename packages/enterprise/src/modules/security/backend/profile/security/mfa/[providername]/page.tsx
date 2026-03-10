'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { useMfaStatus } from '../../../../../components/hooks/useMfaStatus'
import type { MfaMethod } from '../../../../../types'
import { FormHeader } from '@open-mercato/ui/backend/forms/FormHeader.tsx'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useProviderDetailsComponent } from '../../../../../components/mfa-ui-registry'

type MfaProviderMethodsPageProps = {
  params?: {
    providername?: string
  }
}

export default function MfaProviderMethodsPage({ params }: MfaProviderMethodsPageProps) {
  const t = useT()
  const router = useRouter()
  const providerType = (params?.providername ?? '').trim()
  const { loading, saving, providers, methods, removeMethod, reload } = useMfaStatus()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const mutationContextId = React.useMemo(
    () => `security-mfa-provider:${providerType || 'unknown'}`,
    [providerType],
  )
  const { runMutation } = useGuardedMutation({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const provider = React.useMemo(() => {
    if (!providerType) return null
    return providers.find((entry) => entry.type === providerType) ?? null
  }, [providerType, providers])
  const ProviderDetailsComponent = useProviderDetailsComponent(provider ?? {
    type: providerType || 'unknown',
    label: providerType || 'unknown',
    icon: 'Shield',
    allowMultiple: true,
  })

  const providerMethods = React.useMemo(() => {
    return methods.filter((method) => method.type === providerType)
  }, [methods, providerType])

  const handleDelete = React.useCallback(async (method: MfaMethod) => {
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

    await runMutation({
      operation: async () => {
        await removeMethod(method.id)
      },
      context: {
        providerType,
        methodId: method.id,
      },
      mutationPayload: {
        methodId: method.id,
        providerType,
      },
    })
    flash(t('security.profile.mfa.remove.success', 'MFA method removed.'), 'success')
  }, [confirm, providerType, removeMethod, runMutation, t])

  if (loading) {
    return <LoadingMessage label={t('security.profile.mfa.loading', 'Loading MFA settings...')} />
  }

  if (!providerType) {
    return (
      <section className="space-y-4">
        <ErrorMessage label={t('security.profile.mfa.setupMfa.missingProvider', 'Missing MFA provider type.')} />
        <Button type="button" variant="outline" onClick={() => router.push('/backend/profile/security/mfa')}>
          {t('ui.actions.back', 'Back')}
        </Button>
      </section>
    )
  }

  if (!provider) {
    return (
      <section className="space-y-4">
        <ErrorMessage
          label={t(
            'security.profile.mfa.setupMfa.providerUnavailable',
            'The selected MFA provider is not available.',
          )}
        />
        <Button type="button" variant="outline" onClick={() => router.push('/backend/profile/security/mfa')}>
          {t('ui.actions.back', 'Back')}
        </Button>
      </section>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/profile/security/mfa"
        backLabel={t('security.profile.mfa.backToList', 'Back to MFA settings')}
        title={provider.label}
        subtitle={t('security.profile.mfa.methods.description', 'Manage your MFA methods for this provider.')}
      />
      <PageBody>
        <ProviderDetailsComponent
          provider={provider}
          methods={providerMethods}
          saving={saving}
          onRemoveMethod={handleDelete}
          onMethodsChanged={reload}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
