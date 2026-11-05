'use client'

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ProviderListComponentProps } from '../mfa-ui-registry'
import MfaProviderListRow from './MfaProviderListRow'

export default function GenericMfaProviderListItem({
  provider,
  configuredCount,
  onClick,
}: ProviderListComponentProps) {
  const t = useT()
  const configuredLabel = configuredCount === 1
    ? t('security.profile.mfa.providers.configuredSingle', '1 configured method')
    : t(
      'security.profile.mfa.providers.configuredMany',
      '{count} configured methods',
      { count: String(configuredCount) },
    )

  return (
    <MfaProviderListRow
      title={provider.label}
      description={configuredCount > 0
        ? configuredLabel
        : t('security.profile.mfa.providers.generic.notConfigured', 'Not configured yet.')}
      icon={<ShieldCheck className="size-4" />}
      onClick={onClick}
    />
  )
}
