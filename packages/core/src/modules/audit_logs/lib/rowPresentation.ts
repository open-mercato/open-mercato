import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { isRecord } from './changeRows'

type AuditRow = {
  resourceKind?: string | null
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  changes?: Record<string, unknown> | null
}

const previewFields = [
  ['displayName', 'audit_logs.summary.name'],
  ['display_name', 'audit_logs.summary.name'],
  ['name', 'audit_logs.summary.name'],
  ['title', 'audit_logs.summary.title'],
  ['label', 'audit_logs.summary.label'],
  ['parentId', 'audit_logs.summary.parent'],
  ['parent_id', 'audit_logs.summary.parent'],
  ['status', 'audit_logs.summary.status'],
  ['isActive', 'audit_logs.summary.active'],
  ['is_active', 'audit_logs.summary.active'],
  ['slug', 'audit_logs.summary.slug'],
] as const

function previewText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text.endsWith(':v1')) return undefined
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

function snapshotRecord(snapshot: unknown): Record<string, unknown> | undefined {
  if (!isRecord(snapshot)) return undefined
  return isRecord(snapshot.view) ? snapshot.view : snapshot
}

export function auditRecordName(item: AuditRow): string | undefined {
  for (const snapshot of [item.snapshotAfter, item.snapshotBefore]) {
    const record = snapshotRecord(snapshot)
    if (!record) continue
    for (const field of ['displayName', 'display_name', 'name', 'title', 'label']) {
      const name = previewText(record[field])
      if (name) return name
    }
  }
  return undefined
}

function summaryValue(value: unknown, field: string, t: TranslateFn): string | undefined {
  if (value === null) {
    return t(field === 'parentId' || field === 'parent_id' ? 'audit_logs.summary.root' : 'audit_logs.common.none')
  }
  if (typeof value === 'boolean') return t(value ? 'audit_logs.summary.yes' : 'audit_logs.summary.no')
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return previewText(value)
}

export function auditChangeSummary(item: AuditRow, t: TranslateFn): string {
  if (!isRecord(item.changes)) return t('audit_logs.actions.details.no_changes')
  const count = Object.keys(item.changes).length
  if (!count) return t('audit_logs.actions.details.no_changes')
  for (const [field, labelKey] of previewFields) {
    if (!Object.hasOwn(item.changes, field)) continue
    const change = item.changes[field]
    const before = snapshotRecord(item.snapshotBefore)?.[field]
    const from = isRecord(change)
      ? Object.hasOwn(change, 'from') ? change.from : Object.hasOwn(change, 'old') ? change.old : before
      : before
    const to = isRecord(change)
      ? Object.hasOwn(change, 'to') ? change.to : change.new
      : change
    const fromText = summaryValue(from, field, t)
    const toText = summaryValue(to, field, t)
    if (fromText === undefined || toText === undefined) continue
    const fieldLabel = labelKey === 'audit_logs.summary.parent' && item.resourceKind === 'directory.organization'
      ? t('audit_logs.summary.parent_organization')
      : t(labelKey)
    const summary = t('audit_logs.summary.change', { field: fieldLabel, from: fromText, to: toText })
    return count > 1 ? t('audit_logs.summary.more', { summary, count: count - 1 }) : summary
  }
  return t('audit_logs.summary.count', { count })
}

export function auditExecutionState(state: string, t: TranslateFn): string {
  switch (state) {
    case 'done': return t('audit_logs.version_history.status.done')
    case 'undone': return t('audit_logs.version_history.status.undone')
    case 'failed': return t('audit_logs.version_history.status.failed')
    case 'redone': return t('audit_logs.version_history.status.redone')
    default: return state
  }
}
