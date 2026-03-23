'use client'

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'

type MfaConfiguredBadgeProps = {
  label: React.ReactNode
}

export default function MfaConfiguredBadge({ label }: MfaConfiguredBadgeProps) {
  return (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-50"
    >
      {label}
    </Badge>
  )
}
