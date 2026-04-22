import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'inbox_ops.email.received', label: 'Email Received', entity: 'email', category: 'custom' },
  { id: 'inbox_ops.email.processed', label: 'Email Processed', entity: 'email', category: 'lifecycle' },
  { id: 'inbox_ops.email.failed', label: 'Email Processing Failed', entity: 'email', category: 'lifecycle' },
  { id: 'inbox_ops.email.reprocessed', label: 'Email Re-extracted', entity: 'email', category: 'custom' },
  { id: 'inbox_ops.email.deduplicated', label: 'Duplicate Email Skipped', entity: 'email', category: 'custom' },
  { id: 'inbox_ops.source_submission.requested', label: 'Source Submission Requested', entity: 'source_submission', category: 'custom' },
  { id: 'inbox_ops.source_submission.received', label: 'Source Submission Received', entity: 'source_submission', category: 'lifecycle' },
  { id: 'inbox_ops.source_submission.processed', label: 'Source Submission Processed', entity: 'source_submission', category: 'lifecycle' },
  { id: 'inbox_ops.source_submission.failed', label: 'Source Submission Failed', entity: 'source_submission', category: 'lifecycle' },
  { id: 'inbox_ops.source_submission.deduplicated', label: 'Source Submission Deduplicated', entity: 'source_submission', category: 'custom' },
  { id: 'inbox_ops.proposal.created', label: 'Proposal Created', entity: 'proposal', category: 'crud' },
  { id: 'inbox_ops.proposal.accepted', label: 'Proposal Accepted', entity: 'proposal', category: 'custom' },
  { id: 'inbox_ops.proposal.rejected', label: 'Proposal Rejected', entity: 'proposal', category: 'custom' },
  { id: 'inbox_ops.action.rejected', label: 'Action Rejected', entity: 'action', category: 'custom' },
  { id: 'inbox_ops.action.edited', label: 'Action Edited', entity: 'action', category: 'custom' },
  { id: 'inbox_ops.action.executed', label: 'Action Executed', entity: 'action', category: 'custom' },
  { id: 'inbox_ops.action.failed', label: 'Action Execution Failed', entity: 'action', category: 'custom' },
  { id: 'inbox_ops.reply.sent', label: 'Reply Sent', entity: 'reply', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'inbox_ops', events })

export const emitInboxOpsEvent = eventsConfig.emit

export type InboxOpsEventId = typeof events[number]['id']

export default eventsConfig
