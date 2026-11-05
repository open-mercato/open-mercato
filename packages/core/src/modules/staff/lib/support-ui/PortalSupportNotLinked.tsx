"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'

export function PortalSupportNotLinked({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const t = useT()
  return (
    <EmptyState
      variant="subtle"
      size={size}
      title={t('staff.portal.support.notLinked.title', 'Support tickets are not available for your account')}
      description={t(
        'staff.portal.support.notLinked.description',
        'Your portal account is not linked to a company, so there are no tickets to show. Ask your account administrator to link it.',
      )}
    />
  )
}
