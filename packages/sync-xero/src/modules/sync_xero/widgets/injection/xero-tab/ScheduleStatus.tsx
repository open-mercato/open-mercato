"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { XeroConnectionView } from './types'

type ScheduleStatusProps = {
  connection: XeroConnectionView
  integrationEnabled: boolean | null
  isCreating: boolean
  onCreateDefaults: () => void
}

export function keepAliveWarning(connection: XeroConnectionView, integrationEnabled: boolean | null): 'paused' | 'noKeepAlive' | null {
  if (integrationEnabled === false) return 'paused'
  return connection.schedules.some((schedule) => schedule.exists && schedule.isEnabled) ? null : 'noKeepAlive'
}

function entityLabelKey(entityType: string): string {
  return `sync_xero.schedules.entity.${entityType.replace(/^xero\./, '')}`
}

export function ScheduleStatus({ connection, integrationEnabled, isCreating, onCreateDefaults }: ScheduleStatusProps) {
  const t = useT()
  const days = connection.grant.refreshExpiresInDays
  const warning = keepAliveWarning(connection, integrationEnabled)
  const anyMissing = connection.schedules.some((schedule) => !schedule.exists)

  return (
    <div className="space-y-3" data-testid="sync-xero-schedules">
      <SectionHeader title={t('sync_xero.schedules.heading')} />
      {warning && days !== null ? (
        <Alert status="warning">
          <AlertDescription>
            {days > 0 ? t(`sync_xero.schedules.${warning}`, { days }) : t('sync_xero.schedules.expired')}
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="space-y-2">
        {connection.schedules.map((schedule) => (
          <li key={schedule.entityType} className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{t(entityLabelKey(schedule.entityType))}</span>
              {schedule.exists && schedule.isEnabled ? (
                <StatusBadge variant="success">{t('sync_xero.schedules.every', { value: schedule.scheduleValue ?? '' })}</StatusBadge>
              ) : (
                <StatusBadge variant="warning">
                  {schedule.exists ? t('sync_xero.schedules.disabled') : t('sync_xero.schedules.missing')}
                </StatusBadge>
              )}
            </div>
            {schedule.exists && schedule.fullSync ? (
              <Alert status="warning">
                <AlertDescription>{t('sync_xero.schedules.fullSyncWarning')}</AlertDescription>
              </Alert>
            ) : null}
          </li>
        ))}
      </ul>
      {anyMissing ? (
        <Button type="button" variant="outline" onClick={onCreateDefaults} disabled={!connection.canConfigureSchedules || isCreating}>
          {t('sync_xero.schedules.create')}
        </Button>
      ) : null}
    </div>
  )
}
