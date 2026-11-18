"use client"

import * as React from 'react'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const PROPERTY_MANAGE_FEATURE = 'property_management.manage'

export function useCanManageProperty(): boolean {
  const { payload: chrome } = useBackendChrome()
  return hasFeature(chrome?.grantedFeatures, PROPERTY_MANAGE_FEATURE)
}

export function ViewOnlyNotice({ children }: { children?: React.ReactNode }) {
  const t = useT()
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm" data-testid="pm-view-only">
      <p>{t('property_management.common.viewOnly', 'View only. You do not have permission to change it.')}</p>
      {children}
    </div>
  )
}

export function ArchivedBuildingNotice() {
  const t = useT()
  return (
    <div className="rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm" data-testid="pm-archived-read-only">
      <p>{t('property_management.common.archivedReadOnly', 'This building is archived. Its floors, spaces, units and common areas are read-only.')}</p>
    </div>
  )
}
