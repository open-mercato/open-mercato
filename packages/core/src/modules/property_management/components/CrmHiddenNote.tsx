"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function CrmHiddenNote({ testId = 'pm-crm-hidden', className }: { testId?: string; className?: string }) {
  const t = useT()
  const classes = className ? `text-muted-foreground ${className}` : 'text-muted-foreground'
  return <span className={classes} data-testid={testId}>{t('property_management.floorPlan.drawer.crmHidden', 'Needs CRM access')}</span>
}
