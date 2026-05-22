'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
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

  const title = t(
    'security.profile.mfa.enforcement.notice.title',
    'MFA enrollment required',
  )
  const body = overdue
    ? t(
      'security.profile.mfa.enforcement.notice.overdueText',
      'Your MFA enrollment deadline has passed. Set up MFA now to keep account access.',
    )
    : t(
      'security.profile.mfa.enforcement.notice.text',
      'Your organization requires MFA enrollment. Set up at least one method to continue securely.',
    )

  return (
    <Alert variant={overdue ? 'warning' : 'info'} className="mb-4">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
      <div className="mt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
        >
          {t('security.profile.mfa.enforcement.notice.dismiss', 'Dismiss')}
        </Button>
      </div>
    </Alert>
  )
}
