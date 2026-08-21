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
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'documents', events })
export const emitDocumentsEvent = eventsConfig.emit
export default eventsConfig
