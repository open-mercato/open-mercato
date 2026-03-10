'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

type MfaComplianceBadgeProps = {
  enrolled: boolean
  compliant: boolean
}

export default function MfaComplianceBadge({ enrolled, compliant }: MfaComplianceBadgeProps) {
  const t = useT()

  if (compliant && enrolled) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
        {t('security.admin.users.compliance.enrolled', 'Enrolled')}
      </span>
    )
  }
  if (enrolled && !compliant) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        {t('security.admin.users.compliance.pending', 'Pending')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
      {t('security.admin.users.compliance.overdue', 'Overdue')}
    </span>
  )
}
