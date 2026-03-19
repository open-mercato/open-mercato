'use client'

import * as React from 'react'
import { Mail } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ProviderListComponentProps } from '../mfa-ui-registry'
import MfaConfiguredBadge from './MfaConfiguredBadge'
import MfaProviderListRow from './MfaProviderListRow'

export default function OtpEmailProviderListItem({
  provider,
  configuredCount,
  onClick,
}: ProviderListComponentProps) {
  const t = useT()

  return (
    <MfaProviderListRow
      title={t('security.profile.mfa.providers.otpEmail.title', provider.label)}
      description={t(
        'security.profile.mfa.providers.otpEmail.description',
        'Receive one-time verification codes by email when signing in.',
      )}
      icon={<Mail className="size-4" />}
      badge={configuredCount > 0 ? (
        <MfaConfiguredBadge label={t('security.profile.mfa.providers.totp.configured', 'Configured')} />
      ) : undefined}
      onClick={onClick}
    />
  )
}
