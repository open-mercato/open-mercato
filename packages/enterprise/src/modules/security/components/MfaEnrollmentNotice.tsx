'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Button } from '@open-mercato/ui/primitives/button'

type MfaEnrollmentNoticeProps = {
  visible: boolean
  overdue: boolean
  onDismiss: () => void
}

export default function MfaEnrollmentNotice({
  visible,
  overdue,
  onDismiss,
}: MfaEnrollmentNoticeProps) {
  const t = useT()

  if (!visible) return null

  return (
    <Notice
      variant={overdue ? 'warning' : 'info'}
      title={t(
        'security.profile.mfa.enforcement.notice.title',
        'MFA enrollment required',
      )}
      message={overdue
        ? t(
          'security.profile.mfa.enforcement.notice.overdueText',
          'Your MFA enrollment deadline has passed. Set up MFA now to keep account access.',
        )
        : t(
          'security.profile.mfa.enforcement.notice.text',
          'Your organization requires MFA enrollment. Set up at least one method to continue securely.',
        )}
      action={(
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
        >
          {t('security.profile.mfa.enforcement.notice.dismiss', 'Dismiss')}
        </Button>
      )}
      className="mb-4"
    />
  )
}

