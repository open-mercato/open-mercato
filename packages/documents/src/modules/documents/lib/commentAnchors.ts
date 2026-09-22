import {
  documentCommentAnchorWriteSchema,
  type DocumentCommentAnchor,
} from '../data/validators'

export type NormalizedDocumentCommentAnchor =
  | DocumentCommentAnchor
  | { kind: 'legacy-unknown' }

export function normalizeDocumentCommentAnchor(value: unknown): NormalizedDocumentCommentAnchor {
  const parsed = documentCommentAnchorWriteSchema.safeParse(value)
  return parsed.success ? parsed.data : { kind: 'legacy-unknown' }
}

export function isChangedDocumentCommentAnchor(
  value: NormalizedDocumentCommentAnchor,
): value is { kind: 'legacy-unknown' } {
  return 'kind' in value && value.kind === 'legacy-unknown'
}
