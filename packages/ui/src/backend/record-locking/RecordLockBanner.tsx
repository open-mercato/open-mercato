'use client'

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Button } from '@open-mercato/ui/primitives/button'
import type { RecordLockStrategy } from './useRecordLock'

export type RecordLockBannerProps = {
  t: TranslateFn
  strategy: RecordLockStrategy
  resourceEnabled: boolean
  isOwner: boolean
  isBlocked: boolean
  canForceRelease?: boolean
  forceReleasePending?: boolean
  onForceRelease?: () => Promise<void> | void
  error?: string | null
}

export function RecordLockBanner({
  t,
  strategy,
  resourceEnabled,
  isOwner,
  isBlocked,
  canForceRelease,
  forceReleasePending,
  onForceRelease,
  error,
}: RecordLockBannerProps) {
  if (error) {
    return <Notice compact>{error}</Notice>
  }

  if (!resourceEnabled) return null

  if (isBlocked) {
    if (canForceRelease && onForceRelease) {
      return (
        <Notice compact>
          <div className="flex items-center justify-between gap-3">
            <span>{t('record_locks.banner.locked_by_other', 'This record is currently locked by another user.')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onForceRelease()}
              disabled={forceReleasePending}
            >
              {forceReleasePending
                ? t('record_locks.banner.take_over_pending', 'Taking over...')
                : t('record_locks.banner.take_over', 'Take over editing')}
            </Button>
          </div>
        </Notice>
      )
    }
    return <Notice compact>{t('record_locks.banner.locked_by_other', 'This record is currently locked by another user.')}</Notice>
  }

  if (strategy === 'optimistic' && !isOwner) {
    return <Notice compact>{t('record_locks.banner.optimistic_notice', 'Another user is editing this record. Conflicts may occur on save.')}</Notice>
  }

  if (isOwner) {
    return <Notice compact>{t('record_locks.banner.mine', 'You are currently editing this record.')}</Notice>
  }

  return null
}
