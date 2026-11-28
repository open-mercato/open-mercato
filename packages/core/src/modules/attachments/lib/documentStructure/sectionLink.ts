export const DOCUMENT_SECTION_PAGE_BASE_PATH = '/backend/storage/attachments'

export function buildDocumentSectionHref(attachmentId: string, anchorKey: string): string {
  return `${DOCUMENT_SECTION_PAGE_BASE_PATH}/${encodeURIComponent(attachmentId)}/sections/${encodeURIComponent(anchorKey)}`
}
