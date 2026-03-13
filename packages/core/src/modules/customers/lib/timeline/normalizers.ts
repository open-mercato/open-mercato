import type { TimelineEntry, TimelineEntryKind } from './types'
import {
  resolveActor as sharedResolveActor,
  toIsoString as sharedToIsoString,
  normalizeAuditLogs as sharedNormalizeAuditLogs,
  normalizeStageHistory as sharedNormalizeStageHistory,
  normalizeComments as sharedNormalizeComments,
  normalizeActivities as sharedNormalizeActivities,
  normalizeAttachments as sharedNormalizeAttachments,
  normalizeEmails as sharedNormalizeEmails,
} from '@open-mercato/shared/modules/timeline/normalizers'

// Re-export source entry types for consumers
export type {
  AuditLogEntry,
  StageHistoryEntry,
  CommentEntry,
  ActivityEntry,
  AttachmentEntry,
  EmailEntry,
} from '@open-mercato/shared/modules/timeline/normalizers'

type DisplayUsers = Record<string, string>

// CRM-specific field labels for deal audit log normalization
const DEAL_FIELD_LABELS: Record<string, string> = {
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

export function normalizeAuditLogs(
  logs: Parameters<typeof sharedNormalizeAuditLogs>[0],
  displayUsers: DisplayUsers,
  hasStageHistory: boolean,
): TimelineEntry[] {
  return sharedNormalizeAuditLogs(logs, displayUsers, hasStageHistory, {
    createKind: 'deal_created' as TimelineEntryKind,
    updateKind: 'deal_updated' as TimelineEntryKind,
    deleteKind: 'deal_deleted' as TimelineEntryKind,
    createLabel: 'Deal created',
    deleteLabel: 'Deal deleted',
    fieldLabels: DEAL_FIELD_LABELS,
    stageChangeFields: STAGE_CHANGE_FIELDS,
  }) as TimelineEntry[]
}

export function normalizeStageHistory(
  entries: Parameters<typeof sharedNormalizeStageHistory>[0],
  displayUsers: DisplayUsers,
): TimelineEntry[] {
  return sharedNormalizeStageHistory(entries, displayUsers, 'stage_changed' as TimelineEntryKind) as TimelineEntry[]
}

export function normalizeComments(
  comments: Parameters<typeof sharedNormalizeComments>[0],
  displayUsers: DisplayUsers,
): TimelineEntry[] {
  return sharedNormalizeComments(comments, displayUsers, 'comment_added' as TimelineEntryKind) as TimelineEntry[]
}

export function normalizeActivities(
  activities: Parameters<typeof sharedNormalizeActivities>[0],
  displayUsers: DisplayUsers,
): TimelineEntry[] {
  return sharedNormalizeActivities(activities, displayUsers, 'activity_logged' as TimelineEntryKind) as TimelineEntry[]
}

export function normalizeAttachments(
  attachments: Parameters<typeof sharedNormalizeAttachments>[0],
): TimelineEntry[] {
  return sharedNormalizeAttachments(attachments, 'file_uploaded' as TimelineEntryKind) as TimelineEntry[]
}

export function normalizeEmails(
  emails: Parameters<typeof sharedNormalizeEmails>[0],
): TimelineEntry[] {
  return sharedNormalizeEmails(emails, 'email_sent' as TimelineEntryKind, 'email_received' as TimelineEntryKind) as TimelineEntry[]
}
