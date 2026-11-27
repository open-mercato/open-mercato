'use client'

import Link from 'next/link'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOAuthProviderStatus } from '../lib/use-oauth-provider-status'

export function OAuthProviderSetupHint({ providerKey, verifyProvider = false }: {
  providerKey?: string
  verifyProvider?: boolean
}) {
  const t = useT()
  const { payload, isLoading } = useBackendChrome()
  const features = isLoading ? undefined : payload?.grantedFeatures
  const canOpenSetup = providerKey && hasFeature(features, 'integrations.view') &&
    hasFeature(features, 'integrations.manage')
  const { status } = useOAuthProviderStatus(verifyProvider && canOpenSetup ? providerKey : null)

  if (!canOpenSetup || (verifyProvider && status !== 'configured' && status !== 'unconfigured')) {
    return t(
      'communication_channels.profile.connect.notConfigured',
      'This provider is not configured yet. Ask an administrator to add the OAuth Client ID and Secret under Integrations before connecting a mailbox.',
    )
  }

  return (
    <>
      {t(
        'communication_channels.profile.connect.setupRequired',
        'Add the OAuth Client ID and Secret before connecting a mailbox.',
      )}{' '}
      <Link
        className="font-medium underline underline-offset-4"
        href={`/backend/integrations/channel_${encodeURIComponent(providerKey)}`}
      >
        {t('communication_channels.profile.connect.openProviderSetup', 'Open provider setup')}
      </Link>
    </>
  )
}
