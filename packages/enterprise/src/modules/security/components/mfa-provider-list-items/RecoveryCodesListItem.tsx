'use client'

import { KeyRound } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import MfaProviderListRow from './MfaProviderListRow'

type RecoveryCodesListItemProps = {
  onClick: () => void
}

export default function RecoveryCodesListItem({ onClick }: RecoveryCodesListItemProps) {
  const t = useT()

  return (
    <MfaProviderListRow
      title={t('security.profile.mfa.providers.recovery.title', 'Recovery codes')}
      description={t(
        'security.profile.mfa.providers.recovery.description',
        'Use backup recovery codes as a last resort when you cannot access your primary MFA methods.',
      )}
      icon={<KeyRound className="size-4" />}
      onClick={onClick}
    />
  )
}
