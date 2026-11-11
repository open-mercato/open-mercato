import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'documents.document.created', label: 'Document Created', entity: 'document', category: 'crud' },
  { id: 'documents.document.updated', label: 'Document Updated', entity: 'document', category: 'crud', crossProcessBroadcast: true },
  { id: 'documents.document.deleted', label: 'Document Deleted', entity: 'document', category: 'crud', crossProcessBroadcast: true },
  { id: 'documents.document.archived', label: 'Document Archived', entity: 'document', category: 'lifecycle', crossProcessBroadcast: true },
  { id: 'documents.document.unarchived', label: 'Document Unarchived', entity: 'document', category: 'lifecycle', crossProcessBroadcast: true },
  { id: 'documents.document.duplicated', label: 'Document Duplicated', entity: 'document', category: 'lifecycle' },
  { id: 'documents.document.shared', label: 'Document Shared', entity: 'document', category: 'lifecycle', crossProcessBroadcast: true },
  { id: 'documents.document.unshared', label: 'Document Unshared', entity: 'document', category: 'lifecycle', crossProcessBroadcast: true },
  { id: 'documents.comment.created', label: 'Comment Created', entity: 'comment', category: 'crud' },
  { id: 'documents.comment.mentioned', label: 'Comment Mentioned User', entity: 'comment', category: 'lifecycle' },
  { id: 'documents.comment.resolved', label: 'Comment Resolved', entity: 'comment', category: 'lifecycle' },
  { id: 'documents.version.created', label: 'Version Created', entity: 'version', category: 'crud' },
  { id: 'documents.version.restored', label: 'Version Restored', entity: 'version', category: 'lifecycle', crossProcessBroadcast: true },
  { id: 'documents.link.created', label: 'Document Link Created', entity: 'link', category: 'crud' },
  { id: 'documents.link.deleted', label: 'Document Link Deleted', entity: 'link', category: 'crud' },
  { id: 'documents.finding.ingested', label: 'Review Findings Ingested', entity: 'finding', category: 'lifecycle' },
  { id: 'documents.finding.applied', label: 'Review Finding Applied', entity: 'finding', category: 'lifecycle' },
  { id: 'documents.finding.kept', label: 'Review Finding Kept', entity: 'finding', category: 'lifecycle' },
  { id: 'documents.finding.reopened', label: 'Review Finding Reopened', entity: 'finding', category: 'lifecycle' },
  { id: 'documents.review.cleared', label: 'Document Review Cleared', entity: 'review', category: 'lifecycle' },
  { id: 'documents.review_playbook.created', label: 'Review Playbook Created', entity: 'review_playbook', category: 'crud' },
  { id: 'documents.review_playbook.updated', label: 'Review Playbook Updated', entity: 'review_playbook', category: 'crud' },
  { id: 'documents.review_playbook.deleted', label: 'Review Playbook Deleted', entity: 'review_playbook', category: 'crud' },
  { id: 'documents.review_rule.created', label: 'Review Rule Created', entity: 'review_rule', category: 'crud' },
  { id: 'documents.review_rule.updated', label: 'Review Rule Updated', entity: 'review_rule', category: 'crud' },
  { id: 'documents.review_rule.deleted', label: 'Review Rule Deleted', entity: 'review_rule', category: 'crud' },
  { id: 'documents.review_playbook_reference.created', label: 'Review Playbook Guidance Linked', entity: 'review_playbook_reference', category: 'crud' },
  { id: 'documents.review_playbook_reference.deleted', label: 'Review Playbook Guidance Unlinked', entity: 'review_playbook_reference', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'documents', events })
export const emitDocumentsEvent = eventsConfig.emit
export default eventsConfig
