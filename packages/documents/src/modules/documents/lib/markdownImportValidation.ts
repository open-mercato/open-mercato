/** Lightweight constants and validators for Markdown import (no Markdown parser loaded). */
export const MARKDOWN_IMPORT_MAX_FILE_BYTES = 1024 * 1024
export const MARKDOWN_IMPORT_MAX_FILES = 20
export const MARKDOWN_IMPORT_MAX_TITLE_LENGTH = 512
export const MARKDOWN_IMPORT_ACCEPT = '.md,.markdown,text/markdown,text/plain'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'txt'])
const TEXT_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown', 'text/plain'])

export type MarkdownImportFileLike = {
  name: string
  size: number
  type?: string | null
}

export type MarkdownImportRejection =
  | { code: 'tooLarge'; maxBytes: number }
  | { code: 'unsupported' }
  | { code: 'empty' }

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function validateMarkdownImportFile(file: MarkdownImportFileLike): MarkdownImportRejection | null {
  const extension = fileExtension(file.name)
  const mimeType = (file.type ?? '').toLowerCase().split(';')[0].trim()
  const extensionAllowed = MARKDOWN_EXTENSIONS.has(extension)
  const mimeAllowed = TEXT_MIME_TYPES.has(mimeType)
  if (!extensionAllowed && !(mimeAllowed && extension === '')) return { code: 'unsupported' }
  if (mimeType && !mimeAllowed && !mimeType.startsWith('text/')) return { code: 'unsupported' }
  if (file.size > MARKDOWN_IMPORT_MAX_FILE_BYTES) return { code: 'tooLarge', maxBytes: MARKDOWN_IMPORT_MAX_FILE_BYTES }
  if (file.size === 0) return { code: 'empty' }
  return null
}

export function validateMarkdownImportSource(source: string): MarkdownImportRejection | null {
  if (source.includes('\u0000')) return { code: 'unsupported' }
  if (!source.trim()) return { code: 'empty' }
  return null
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, '')
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return stem
}
