"use client"

import * as React from 'react'
import { Clock } from 'lucide-react'
import { Button } from '../../primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { VersionHistoryConfig } from './types'
import { useVersionHistory } from './useVersionHistory'
import { VersionHistoryPanel } from './VersionHistoryPanel'

export type VersionHistoryActionProps = {
  config: VersionHistoryConfig | null
  t: TranslateFn
  buttonClassName?: string
  iconClassName?: string
}

export function VersionHistoryAction({
  config,
  t,
  buttonClassName,
  iconClassName,
}: VersionHistoryActionProps) {
  const enabled = Boolean(
    config?.resourceKind
      && config?.resourceId
      && String(config.resourceId).trim().length > 0
  )
  const [open, setOpen] = React.useState(false)
  const historyData = useVersionHistory(enabled ? config! : null, open)

  if (!enabled) return null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t('audit_logs.version_history.title')}
        title={t('audit_logs.version_history.title')}
        className={buttonClassName}
      >
        <Clock className={cn('size-4', iconClassName)} />
      </Button>
      <VersionHistoryPanel
        open={open}
        onOpenChange={setOpen}
        entries={historyData.entries}
        isLoading={historyData.isLoading}
        error={historyData.error}
        hasMore={historyData.hasMore}
        onLoadMore={historyData.loadMore}
        t={t}
      />
    </>
  )
}
