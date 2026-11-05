'use client'

import * as React from 'react'
import { Smartphone } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ProviderListComponentProps } from '../mfa-ui-registry'
import MfaConfiguredBadge from './MfaConfiguredBadge'
import MfaProviderListRow from './MfaProviderListRow'

export default function TotpProviderListItem({
  provider,
  configuredCount,
  onClick,
}: ProviderListComponentProps) {
  const t = useT()

  return (
    <MfaProviderListRow
      title={t('security.profile.mfa.providers.totp.title', provider.label)}
      description={t(
        'security.profile.mfa.providers.totp.description',
        'Use an authenticator app or browser extension to get two-factor authentication codes when prompted.',
      )}
      icon={<Smartphone className="size-4" />}
      badge={configuredCount > 0 ? (
        <MfaConfiguredBadge label={t('security.profile.mfa.providers.totp.configured', 'Configured')} />
      ) : undefined}
      onClick={onClick}
    />
  )
}
