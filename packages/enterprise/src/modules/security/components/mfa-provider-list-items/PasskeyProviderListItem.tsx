'use client'

import * as React from 'react'
import { Shield } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { ProviderListComponentProps } from '../mfa-ui-registry'
import MfaConfiguredBadge from './MfaConfiguredBadge'
import MfaProviderListRow from './MfaProviderListRow'

export default function PasskeyProviderListItem({
  provider,
  configuredCount,
  onClick,
}: ProviderListComponentProps) {
  const t = useT()
  const keysLabel = configuredCount === 1
    ? t('security.profile.mfa.providers.passkey.keySingle', '1 key')
    : t('security.profile.mfa.providers.passkey.keyMany', '{count} keys', { count: String(configuredCount) })
  const configuredLabel = t('security.profile.mfa.providers.totp.configured', 'Configured')

  return (
    <MfaProviderListRow
      title={t('security.profile.mfa.providers.passkey.title', provider.label)}
      description={t(
        'security.profile.mfa.providers.passkey.description',
        'Security keys are WebAuthn credentials that can only be used as a second factor of authentication.',
      )}
      icon={<Shield className="size-4" />}
      badge={configuredCount > 0 ? (
        <span className="flex items-center gap-2">
          <MfaConfiguredBadge label={configuredLabel} />
          <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-200">{keysLabel}</Badge>
        </span>
      ) : undefined}
      onClick={onClick}
    />
  )
}
