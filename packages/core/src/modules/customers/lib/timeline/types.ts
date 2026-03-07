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

export type FieldChange = {
  field: string
  label: string
  from: unknown
  to: unknown
}

export type TimelineActor = {
  id: string | null
  label: string
}

export type TimelineEntry = {
  id: string
  kind: TimelineEntryKind
  occurredAt: string
  actor: TimelineActor
  summary: string
  detail: Record<string, unknown> | null
  changes: FieldChange[] | null
  dealContext?: { dealId: string; dealTitle: string } | null
  href?: string | null
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
