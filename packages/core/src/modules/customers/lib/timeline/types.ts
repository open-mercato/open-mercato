// Re-export generic types from shared for backward compatibility
export type { TimelineActor, FieldChange } from '@open-mercato/shared/modules/timeline/types'
import type { TimelineEntry as GenericTimelineEntry } from '@open-mercato/shared/modules/timeline/types'

export type TimelineEntryKind =
  | 'deal_created'
  | 'deal_updated'
  | 'deal_deleted'
  | 'stage_changed'
  | 'comment_added'
  | 'activity_logged'
  | 'email_sent'
  | 'email_received'
  | 'file_uploaded'

// CRM-specific timeline entry using the generic base
export type TimelineEntry = GenericTimelineEntry<TimelineEntryKind> & {
  dealContext?: { dealId: string; dealTitle: string } | null
}

export const ALL_TIMELINE_KINDS: readonly TimelineEntryKind[] = [
  'deal_created',
  'deal_updated',
  'deal_deleted',
  'stage_changed',
  'comment_added',
  'activity_logged',
  'email_sent',
  'email_received',
  'file_uploaded',
] as const
