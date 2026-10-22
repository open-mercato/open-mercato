export type DocumentPreviewKind = 'pdf' | 'markdown'

export type DocumentPreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; kind: 'pdf'; url: string }
  | { status: 'ready'; kind: 'markdown'; text: string }

const MARKDOWN_FORMATS = new Set(['markdown', 'md'])

export function resolvePreviewKind(format: string): DocumentPreviewKind {
  return MARKDOWN_FORMATS.has(format.trim().toLowerCase()) ? 'markdown' : 'pdf'
}

export function resolveDownloadLabelKey(format: string): string {
  return resolvePreviewKind(format) === 'markdown'
    ? 'document_generators.generate.buttonMarkdown'
    : 'document_generators.generate.button'
}

export function resolvePreviewTitleKey(format: string): string {
  return resolvePreviewKind(format) === 'markdown'
    ? 'document_generators.preview.markdownTitle'
    : 'document_generators.preview.pdfTitle'
}

type KeyboardLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>

export function isSubmitShortcut(event: KeyboardLike): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

export function isCancelShortcut(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape'
}
