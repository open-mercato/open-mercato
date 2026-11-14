import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DOCUMENTS_MAX_CONTENT_HTML_BYTES } from './resourceLimits'
import { MARKDOWN_IMPORT_MAX_TITLE_LENGTH, titleFromFilename } from './markdownImportValidation'

export {
  MARKDOWN_IMPORT_ACCEPT,
  MARKDOWN_IMPORT_MAX_FILES,
  MARKDOWN_IMPORT_MAX_FILE_BYTES,
  MARKDOWN_IMPORT_MAX_TITLE_LENGTH,
  titleFromFilename,
  validateMarkdownImportFile,
  validateMarkdownImportSource,
  type MarkdownImportFileLike,
  type MarkdownImportRejection,
} from './markdownImportValidation'

export type MarkdownImportConversion = {
  title: string
  contentHtml: string
  contentText: string
}

const ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

function decodeBasicEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (entity) => ENTITY_REPLACEMENTS[entity] ?? entity)
}

export function htmlToImportPlainText(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<\/(p|h[1-6]|li|tr|blockquote|pre|table|ul|ol)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function extractFirstH1Title(html: string): string | null {
  const match = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i.exec(html)
  if (!match) return null
  const text = htmlToImportPlainText(match[1]).replace(/\s+/g, ' ').trim()
  return text || null
}

function clampTitle(title: string): string {
  return title.length > MARKDOWN_IMPORT_MAX_TITLE_LENGTH
    ? title.slice(0, MARKDOWN_IMPORT_MAX_TITLE_LENGTH).trim()
    : title
}

type HastLikeNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastLikeNode[]
}

function readTaskCheckbox(node: HastLikeNode | undefined): boolean | null {
  const first = node?.children?.find((child) => child.type === 'element')
  if (!first) return null
  const candidate = first.tagName === 'p' ? first.children?.find((child) => child.type === 'element') : first
  if (candidate?.tagName !== 'input' || candidate.properties?.type !== 'checkbox') return null
  return Boolean(candidate.properties?.checked)
}

function trimLeadingText(children: ReactNode): ReactNode {
  if (!Array.isArray(children)) return typeof children === 'string' ? children.trimStart() : children
  let trimmed = false
  return children.map((child) => {
    if (trimmed || typeof child !== 'string') return child
    trimmed = true
    return child.trimStart()
  })
}

function hasClass(className: unknown, expected: string): boolean {
  return typeof className === 'string' && className.split(/\s+/).includes(expected)
}

type ListProps = ComponentProps<'ul'> & { node?: unknown }
type ItemProps = ComponentProps<'li'> & { node?: unknown }
type InputProps = ComponentProps<'input'> & { node?: unknown }

const markdownComponents: Components = {
  ul: ({ node: _node, className, children }: ListProps) => (
    hasClass(className, 'contains-task-list')
      ? createElement('ul', { 'data-type': 'taskList' }, children)
      : createElement('ul', null, children)
  ),
  li: ({ node, className, children }: ItemProps) => {
    if (!hasClass(className, 'task-list-item')) return createElement('li', null, children)
    const hastNode = node as HastLikeNode | undefined
    const checked = readTaskCheckbox(hastNode) ?? false
    const isLoose = hastNode?.children?.some((child) => child.type === 'element' && child.tagName === 'p') ?? false
    return createElement(
      'li',
      { 'data-type': 'taskItem', 'data-checked': checked ? 'true' : 'false' },
      isLoose ? children : createElement('p', null, trimLeadingText(children as ReactNode)),
    )
  },
  input: ({ node: _node, type }: InputProps) => (type === 'checkbox' ? null : createElement('span')),
}

/**
 * Markdown → HTML for document import. Raw HTML embedded in the Markdown is
 * dropped (`skipHtml`), unsafe URL schemes are stripped by react-markdown's
 * default URL transform, and the server re-parses the result through the
 * editor schema before storing it, so only editor-supported nodes survive.
 */
export function markdownToDocumentHtml(source: string): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm],
        skipHtml: true,
        urlTransform: defaultUrlTransform,
        components: markdownComponents,
      },
      source.replace(/^\uFEFF/, ''),
    ),
  )
}

export function convertMarkdownImport(fileName: string, source: string): MarkdownImportConversion {
  const contentHtml = markdownToDocumentHtml(source)
  const title = clampTitle(extractFirstH1Title(contentHtml) ?? titleFromFilename(fileName))
  return {
    title: title || clampTitle(fileName),
    contentHtml,
    contentText: htmlToImportPlainText(contentHtml),
  }
}

export function isConvertedHtmlWithinLimit(html: string): boolean {
  return new TextEncoder().encode(html).byteLength <= DOCUMENTS_MAX_CONTENT_HTML_BYTES
}
