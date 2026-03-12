import type { TimelineEntry, TimelineActor, FieldChange } from './types'

type DisplayUsers = Record<string, string>

export function resolveActor(userId: string | null | undefined, displayUsers: DisplayUsers, fallbackLabel?: string): TimelineActor {
  if (userId && displayUsers[userId]) {
    return { id: userId, label: displayUsers[userId] }
  }
  if (userId) {
    return { id: userId, label: userId }
  }
  return { id: null, label: fallbackLabel ?? 'System' }
}

export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

export function extractFieldChanges(
  changesJson: Record<string, unknown> | null,
  fieldLabels: Record<string, string>,
  excludeFields?: Set<string>,
): FieldChange[] {
  if (!changesJson) return []
  const result: FieldChange[] = []
  for (const [field, change] of Object.entries(changesJson)) {
    if (excludeFields?.has(field)) continue
    if (typeof change !== 'object' || change === null) continue
    const record = change as Record<string, unknown>
    result.push({
      field,
      label: fieldLabels[field] ?? field,
      from: record.from ?? null,
      to: record.to ?? null,
    })
  }
  return result
}

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

export type AuditLogNormalizerConfig<K extends string> = {
  createKind: K
  updateKind: K
  deleteKind: K
  createLabel?: string
  updateLabel?: string
  deleteLabel?: string
  fieldLabels: Record<string, string>
  stageChangeFields?: Set<string>
  stageChangeKind?: K
}

export function normalizeAuditLogs<K extends string>(
  logs: AuditLogEntry[],
  displayUsers: DisplayUsers,
  hasStageHistory: boolean,
  config: AuditLogNormalizerConfig<K>,
): TimelineEntry<K>[] {
  const entries: TimelineEntry<K>[] = []
  for (const log of logs) {
    if (log.executionState !== 'done' && log.executionState !== 'redone') continue

    const isCreate = log.commandId.endsWith('.create')
    const isDelete = log.commandId.endsWith('.delete')
    const actor = resolveActor(log.actorUserId, displayUsers)
    const occurredAt = toIsoString(log.createdAt)

    if (isCreate) {
      entries.push({
        id: `audit:${log.id}`,
        kind: config.createKind,
        occurredAt,
        actor,
        summary: log.actionLabel ?? config.createLabel ?? 'Created',
        detail: null,
        changes: null,
      })
      continue
    }

    if (isDelete) {
      entries.push({
        id: `audit:${log.id}`,
        kind: config.deleteKind,
        occurredAt,
        actor,
        summary: log.actionLabel ?? config.deleteLabel ?? 'Deleted',
        detail: null,
        changes: null,
      })
      continue
    }

    if (hasStageHistory && config.stageChangeFields) {
      const keys = log.changesJson ? Object.keys(log.changesJson) : []
      const onlyStage = keys.length > 0 && keys.every((key) => config.stageChangeFields!.has(key))
      if (onlyStage) continue
    }

    const excludeFields = hasStageHistory ? config.stageChangeFields : undefined
    const fieldChanges = extractFieldChanges(log.changesJson, config.fieldLabels, excludeFields)

    if (fieldChanges.length === 0 && !isCreate && !isDelete) continue

    entries.push({
      id: `audit:${log.id}`,
      kind: config.updateKind,
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

export function normalizeStageHistory<K extends string>(
  entries: StageHistoryEntry[],
  displayUsers: DisplayUsers,
  kind: K,
): TimelineEntry<K>[] {
  return entries.map((entry) => {
    const actor = resolveActor(entry.changedByUserId, displayUsers)
    const summary = entry.fromStageLabel
      ? `${entry.fromStageLabel} \u2192 ${entry.toStageLabel}`
      : `Assigned to ${entry.toStageLabel}`

    return {
      id: `stage:${entry.id}`,
      kind,
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

export function normalizeComments<K extends string>(
  comments: CommentEntry[],
  displayUsers: DisplayUsers,
  kind: K,
): TimelineEntry<K>[] {
  return comments.map((comment) => {
    const actor = resolveActor(comment.authorUserId, displayUsers)
    const preview = comment.body.length > 120
      ? `${comment.body.slice(0, 120)}...`
      : comment.body

    return {
      id: `comment:${comment.id}`,
      kind,
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

export function normalizeActivities<K extends string>(
  activities: ActivityEntry[],
  displayUsers: DisplayUsers,
  kind: K,
): TimelineEntry<K>[] {
  return activities.map((activity) => {
    const actor = resolveActor(activity.authorUserId, displayUsers)
    const summary = activity.subject
      ? `${activity.activityType}: ${activity.subject}`
      : activity.activityType

    return {
      id: `activity:${activity.id}`,
      kind,
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

export function normalizeAttachments<K extends string>(
  attachments: AttachmentEntry[],
  kind: K,
): TimelineEntry<K>[] {
  return attachments.map((attachment) => ({
    id: `file:${attachment.id}`,
    kind,
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

export function normalizeEmails<K extends string>(
  emails: EmailEntry[],
  sentKind: K,
  receivedKind: K,
): TimelineEntry<K>[] {
  return emails.map((email) => {
    const isOutbound = email.direction === 'outbound'
    const actorLabel = email.fromName ?? email.fromAddress

    return {
      id: `email:${email.id}`,
      kind: isOutbound ? sentKind : receivedKind,
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
