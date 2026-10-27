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

/**
 * Maximum active folders one organization may hold. A navigable folder tree
 * stays in the tens or low hundreds, so this only stops runaway automated
 * creation while bounding the manager-override listing that decrypts every
 * folder in scope.
 */
export const DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION = 2_000

/**
 * Upper bound for one manager-override folder listing. Kept far above the
 * creation cap so an organization that predates that cap still lists a
 * coherent tree it can prune, instead of losing folder navigation entirely.
 */
export const DOCUMENTS_MAX_LISTED_FOLDERS = 5_000

/**
 * Upper bound for one document's share listing. Explicit sharing stays in the
 * tens, and the mention path can only add one share per distinct mentioned
 * user, so this sits at the comment cap and keeps the listing (plus its
 * principal-label fan-out) bounded the way the comment and version lists are.
 */
export const DOCUMENTS_MAX_LISTED_SHARES = 500
