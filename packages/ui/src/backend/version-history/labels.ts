"use client"

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export function getVersionHistoryStatusLabel(state: string, t: TranslateFn) {
  switch (state) {
    case 'done':
      return t('audit_logs.version_history.status.done', 'Done')
    case 'undone':
      return t('audit_logs.version_history.status.undone', 'Undone')
    case 'redone':
      return t('audit_logs.version_history.status.redone', 'Redone')
    case 'failed':
      return t('audit_logs.version_history.status.failed', 'Failed')
    default:
      return state || t('audit_logs.common.none')
  }
}
