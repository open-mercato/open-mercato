export type DuplicateAttachmentIdMap = ReadonlyMap<string, string>

type RewriteDuplicateAttachmentUrlInput = {
  sourceDocumentId: string
  copyDocumentId: string
  attachmentIds: DuplicateAttachmentIdMap
}

export function rewriteDuplicateAttachmentSrcUrl(
  src: string,
  input: RewriteDuplicateAttachmentUrlInput,
): string {
  const match = /^\/api\/documents\/([^/?#]+)\/attachments\/([^/?#]+)([?#].*)?$/.exec(src)
  if (!match || match[1] !== input.sourceDocumentId) return src
  const replacementAttachmentId = input.attachmentIds.get(match[2] ?? '')
  if (!replacementAttachmentId) return src
  return `/api/documents/${input.copyDocumentId}/attachments/${replacementAttachmentId}${match[3] ?? ''}`
}

export function rewriteDuplicateAttachmentUrls(
  contentHtml: string,
  input: RewriteDuplicateAttachmentUrlInput,
): string {
  return contentHtml.replace(
    /((?<![\w-])src)(\s*=\s*)(["'])([^"']*)\3/gi,
    (match: string, attribute: string, separator: string, quote: string, src: string) => {
      const rewritten = rewriteDuplicateAttachmentSrcUrl(src, input)
      if (rewritten === src) return match
      return `${attribute}${separator}${quote}${rewritten}${quote}`
    },
  )
}
