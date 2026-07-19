export const DOCUMENTS_ENTITY_IDS = {
  document: 'documents:document',
  documentContent: 'documents:document_content',
  documentFolder: 'documents:document_folder',
  documentShare: 'documents:document_share',
  documentComment: 'documents:document_comment',
  documentFavorite: 'documents:document_favorite',
  documentWatcher: 'documents:document_watcher',
  documentVersion: 'documents:document_version',
  documentAttachment: 'documents:document_attachment',
  documentTemplate: 'documents:document_template',
  documentEntityLink: 'documents:document_entity_link',
} as const

/** Maximum number of folder nodes from a root through its deepest descendant. */
export const DOCUMENTS_MAX_FOLDER_DEPTH = 64
