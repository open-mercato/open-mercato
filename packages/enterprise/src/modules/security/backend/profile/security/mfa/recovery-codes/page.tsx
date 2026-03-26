'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms/FormHeader'
import RecoveryCodesProviderDetails from '../../../../../components/RecoveryCodesProviderDetails'

export default function RecoveryCodesPage() {
  const t = useT()

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/profile/security/mfa"
        backLabel={t('security.profile.mfa.backToList', 'Back to MFA settings')}
        title={t('security.profile.mfa.recovery.title', 'Recovery codes')}
        subtitle={t(
          'security.profile.mfa.recovery.pageDescription',
          'Recovery codes can be used to access your account in the event you lose access to your device and cannot receive two-factor authentication codes.',
        )}
      />
      <PageBody>
        <RecoveryCodesProviderDetails />
      </PageBody>
    </Page>
  )
}
