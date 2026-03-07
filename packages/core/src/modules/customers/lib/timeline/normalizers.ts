import type { TimelineEntry, TimelineEntryKind, FieldChange, TimelineActor } from './types'

type DisplayUsers = Record<string, string>

function resolveActor(userId: string | null | undefined, displayUsers: DisplayUsers, fallbackLabel?: string): TimelineActor {
  if (userId && displayUsers[userId]) {
    return { id: userId, label: displayUsers[userId] }
  }
  if (userId) {
    return { id: userId, label: userId }
  }
  return { id: null, label: fallbackLabel ?? 'System' }
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  status: 'Status',
  pipelineId: 'Pipeline',
  pipelineStageId: 'Pipeline stage',
  pipelineStage: 'Pipeline stage',
  valueAmount: 'Deal value',
  valueCurrency: 'Currency',
  probability: 'Probability',
  expectedCloseAt: 'Expected close',
  description: 'Description',
  ownerUserId: 'Owner',
  source: 'Source',
  personIds: 'People',
  companyIds: 'Companies',
}

const STAGE_CHANGE_FIELDS = new Set(['pipelineStageId', 'pipelineStage'])

export type AuditLogEntry = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  resourceKind: string | null
  resourceId: string | null
  createdAt: unknown
  changesJson: Record<string, unknown> | null
  snapshotBefore: unknown
  snapshotAfter: unknown
}

function extractFieldChanges(changesJson: Record<string, unknown> | null, excludeFields?: Set<string>): FieldChange[] {
  if (!changesJson) return []
  const result: FieldChange[] = []
  for (const [field, change] of Object.entries(changesJson)) {
    if (excludeFields?.has(field)) continue
    if (typeof change !== 'object' || change === null) continue
    const record = change as Record<string, unknown>
    result.push({
      field,
      label: FIELD_LABELS[field] ?? field,
      from: record.from ?? null,
      to: record.to ?? null,
    })
  }
  return result
}

function hasOnlyStageChanges(changesJson: Record<string, unknown> | null): boolean {
  if (!changesJson) return false
  const keys = Object.keys(changesJson)
  return keys.length > 0 && keys.every((key) => STAGE_CHANGE_FIELDS.has(key))
}

export function normalizeAuditLogs(
  logs: AuditLogEntry[],
  displayUsers: DisplayUsers,
  hasStageHistory: boolean,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const log of logs) {
    if (log.executionState !== 'done' && log.executionState !== 'redone') continue

    const isCreate = log.commandId.endsWith('.create')
    const isDelete = log.commandId.endsWith('.delete')
    const actor = resolveActor(log.actorUserId, displayUsers)
    const occurredAt = toIsoString(log.createdAt)

    if (isCreate) {
      entries.push({
        id: `audit:${log.id}`,
        kind: 'deal_created',
        occurredAt,
        actor,
        summary: log.actionLabel ?? 'Deal created',
        detail: null,
        changes: null,
      })
      continue
    }

    if (isDelete) {
      entries.push({
        id: `audit:${log.id}`,
        kind: 'deal_deleted',
        occurredAt,
        actor,
        summary: log.actionLabel ?? 'Deal deleted',
        detail: null,
        changes: null,
      })
      continue
    }

    if (hasStageHistory && hasOnlyStageChanges(log.changesJson)) {
      continue
    }

    const excludeFields = hasStageHistory ? STAGE_CHANGE_FIELDS : undefined
    const fieldChanges = extractFieldChanges(log.changesJson, excludeFields)

    if (fieldChanges.length === 0 && !isCreate && !isDelete) continue

    entries.push({
      id: `audit:${log.id}`,
      kind: 'deal_updated',
      occurredAt,
      actor,
      summary: fieldChanges.length === 1
        ? `Updated ${fieldChanges[0].label.toLowerCase()}`
        : `Updated ${fieldChanges.length} fields`,
      detail: null,
      changes: fieldChanges,
    })
  }
  return entries
}

export type StageHistoryEntry = {
  id: string
  fromStageLabel: string | null
  toStageLabel: string
  changedByUserId: string | null
  durationSeconds: number | null
  fromStageId: string | null
  createdAt: unknown
}

export function normalizeStageHistory(
  entries: StageHistoryEntry[],
  displayUsers: DisplayUsers,
): TimelineEntry[] {
  return entries.map((entry) => {
    const actor = resolveActor(entry.changedByUserId, displayUsers)
    const summary = entry.fromStageLabel
      ? `${entry.fromStageLabel} \u2192 ${entry.toStageLabel}`
      : `Assigned to ${entry.toStageLabel}`

    return {
      id: `stage:${entry.id}`,
      kind: 'stage_changed' as const,
      occurredAt: toIsoString(entry.createdAt),
      actor,
      summary,
      detail: {
        fromStageLabel: entry.fromStageLabel,
        toStageLabel: entry.toStageLabel,
        durationSeconds: entry.durationSeconds,
      },
      changes: null,
    }
  })
}

export type CommentEntry = {
  id: string
  body: string
  authorUserId: string | null
  createdAt: unknown
}

export function normalizeComments(
  comments: CommentEntry[],
  displayUsers: DisplayUsers,
): TimelineEntry[] {
  return comments.map((comment) => {
    const actor = resolveActor(comment.authorUserId, displayUsers)
    const preview = comment.body.length > 120
      ? `${comment.body.slice(0, 120)}...`
      : comment.body

    return {
      id: `comment:${comment.id}`,
      kind: 'comment_added' as const,
      occurredAt: toIsoString(comment.createdAt),
      actor,
      summary: preview,
      detail: { body: comment.body },
      changes: null,
    }
  })
}

export type ActivityEntry = {
  id: string
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: unknown
  authorUserId: string | null
  assignedToUserId: string | null
}

export function normalizeActivities(
  activities: ActivityEntry[],
  displayUsers: DisplayUsers,
): TimelineEntry[] {
  return activities.map((activity) => {
    const actor = resolveActor(activity.authorUserId, displayUsers)
    const summary = activity.subject
      ? `${activity.activityType}: ${activity.subject}`
      : activity.activityType

    return {
      id: `activity:${activity.id}`,
      kind: 'activity_logged' as const,
      occurredAt: toIsoString(activity.occurredAt),
      actor,
      summary,
      detail: {
        activityType: activity.activityType,
        subject: activity.subject,
        bodyPreview: activity.body
          ? activity.body.length > 120 ? `${activity.body.slice(0, 120)}...` : activity.body
          : null,
      },
      changes: null,
    }
  })
}

export type AttachmentEntry = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: unknown
}

export function normalizeAttachments(
  attachments: AttachmentEntry[],
): TimelineEntry[] {
  return attachments.map((attachment) => ({
    id: `file:${attachment.id}`,
    kind: 'file_uploaded' as const,
    occurredAt: toIsoString(attachment.createdAt),
    actor: { id: null, label: 'System' },
    summary: attachment.fileName,
    detail: {
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
    },
    changes: null,
  }))
}

export type EmailEntry = {
  id: string
  direction: string
  fromAddress: string
  fromName: string | null
  toAddresses: Array<{ email: string; name?: string }>
  subject: string
  bodyText: string | null
  sentAt: unknown
  hasAttachments: boolean
}

export function normalizeEmails(
  emails: EmailEntry[],
): TimelineEntry[] {
  return emails.map((email) => {
    const isOutbound = email.direction === 'outbound'
    const actorLabel = email.fromName ?? email.fromAddress

    return {
      id: `email:${email.id}`,
      kind: isOutbound ? 'email_sent' as const : 'email_received' as const,
      occurredAt: toIsoString(email.sentAt),
      actor: { id: null, label: actorLabel },
      summary: email.subject,
      detail: {
        subject: email.subject,
        fromAddress: email.fromAddress,
        toAddresses: email.toAddresses,
        bodyPreview: email.bodyText
          ? email.bodyText.length > 120 ? `${email.bodyText.slice(0, 120)}...` : email.bodyText
          : null,
        bodyText: email.bodyText ?? null,
        hasAttachments: email.hasAttachments,
      },
      changes: null,
    }
  })
}
