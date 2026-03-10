'use client'

import * as React from 'react'
import { Mail } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { ProviderListComponentProps } from '../mfa-ui-registry'
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
        <Badge className="bg-emerald-700/20 text-emerald-300 hover:bg-emerald-700/20">
          {t('security.profile.mfa.providers.totp.configured', 'Configured')}
        </Badge>
      ) : undefined}
      onClick={onClick}
    />
  )
}
