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
  errorCode?: string | null
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
  errorCode,
}: RecordLockBannerProps) {
  const resolvedError = React.useMemo(() => {
    if (errorCode === 'record_force_release_unavailable') {
      return t(
        'record_locks.errors.force_release_unavailable',
        'Force release is unavailable because takeover is disabled or the lock is no longer active.',
      )
    }
    if (errorCode === 'record_locks_force_release_failed') {
      return t('record_locks.errors.force_release_failed', 'Failed to take over editing.')
    }
    if (errorCode === 'record_locks_acquire_failed') {
      return t('record_locks.errors.acquire_failed', 'Failed to load record lock status.')
    }
    if (errorCode === 'record_locked') {
      return t('record_locks.banner.locked_by_other', 'This record is currently locked by another user.')
    }
    return error
  }, [error, errorCode, t])

  if (resolvedError) {
    return <Notice compact>{resolvedError}</Notice>
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
              className="shrink-0 border-blue-300 bg-white text-blue-900 hover:bg-blue-100 hover:text-blue-950"
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
