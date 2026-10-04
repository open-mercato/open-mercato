import { isDraftStatus } from '@open-mercato/shared/modules/document-generators'

const DRAFT_DOCUMENT_STATUSES: ReadonlySet<string> = new Set(['draft', 'pending_approval', 'rejected'])

export function isDraftDocumentStatus(status: unknown): boolean {
  return isDraftStatus(status, DRAFT_DOCUMENT_STATUSES)
}
