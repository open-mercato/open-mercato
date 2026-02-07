"use client"

import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const RESOURCE_KIND_LABELS: Record<string, string> = {
  'sales.documentAddress': 'Address',
  'sales.payment': 'Payment',
  'sales.shipment': 'Shipment',
  'sales.note': 'Note',
  'customers.address': 'Address',
  'customers.activity': 'Activity',
  'customers.comment': 'Comment',
  'customers.todoLink': 'Todo',
  'staff.team_member_address': 'Address',
  'staff.team_member_activity': 'Activity',
  'staff.team_member_comment': 'Comment',
  'staff.team_member_job_history': 'Job History',
  'staff.leave_request': 'Leave Request',
  'staff.teamMemberTagAssignment': 'Tag',
  'resources.resource_activity': 'Activity',
  'resources.resource_comment': 'Comment',
  'resources.resourceTagAssignment': 'Tag',
  'catalog.variant': 'Variant',
  'catalog.price': 'Price',
  'currencies.exchange_rate': 'Exchange Rate',
}

export function humanizeResourceKind(kind: string | null): string {
  if (!kind) return ''
  if (RESOURCE_KIND_LABELS[kind]) return RESOURCE_KIND_LABELS[kind]
  const segment = kind.split('.').pop() ?? kind
  return segment.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

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
