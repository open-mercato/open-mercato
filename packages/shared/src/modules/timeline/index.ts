export type {
  TimelineActor,
  FieldChange,
  TimelineEntry,
  AggregateOptions,
  TimelinePanelConfig,
} from './types'

export { aggregateTimeline } from './aggregator'

export { createTimelineHandler } from './createTimelineHandler'
export type {
  TimelineSourceContext,
  TimelineSourceDef,
  TimelineHandlerConfig,
  TimelineQuery,
} from './createTimelineHandler'

export {
  resolveActor,
  toIsoString,
  extractFieldChanges,
  normalizeAuditLogs,
  normalizeStageHistory,
  normalizeComments,
  normalizeActivities,
  normalizeAttachments,
  normalizeEmails,
} from './normalizers'

export type {
  AuditLogEntry,
  AuditLogNormalizerConfig,
  StageHistoryEntry,
  CommentEntry,
  ActivityEntry,
  AttachmentEntry,
  EmailEntry,
} from './normalizers'
