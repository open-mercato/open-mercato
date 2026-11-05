'use client'

import * as React from 'react'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { VersionHistoryConfig } from '@open-mercato/ui/backend/version-history'

export type ObjectHistoryButtonProps = {
  resourceKind: VersionHistoryConfig['resourceKind']
  resourceId: VersionHistoryConfig['resourceId']
  resourceIdFallback?: VersionHistoryConfig['resourceIdFallback']
  organizationId?: VersionHistoryConfig['organizationId']
  includeRelated?: VersionHistoryConfig['includeRelated']
}

const OUTLINE_ICON_BUTTON_CLASSES =
  'size-8 rounded-md border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'

export function ObjectHistoryButton({
  resourceKind,
  resourceId,
  resourceIdFallback,
  organizationId,
  includeRelated,
}: ObjectHistoryButtonProps) {
  const t = useT()
  const config = React.useMemo<VersionHistoryConfig>(
    () => ({
      resourceKind,
      resourceId,
      resourceIdFallback,
      organizationId,
      includeRelated,
    }),
    [resourceKind, resourceId, resourceIdFallback, organizationId, includeRelated],
  )

  return (
    <VersionHistoryAction
      config={config}
      t={t}
      buttonClassName={OUTLINE_ICON_BUTTON_CLASSES}
    />
  )
}

export default ObjectHistoryButton
