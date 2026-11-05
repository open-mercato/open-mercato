import { NodeHtmlMarkdown } from 'node-html-markdown'

const markdownConverter = new NodeHtmlMarkdown({
  bulletMarker: '-',
  emDelimiter: '*',
  maxConsecutiveNewlines: 2,
  useInlineLinks: false,
})

function stripMarkdownWhitespace(value: string): string {
  return value
    .replace(/[ \t]{2,}\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function htmlToMarkdown(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const markdown = markdownConverter.translate(trimmed)
  const normalized = stripMarkdownWhitespace(markdown)
  return normalized.length > 0 ? normalized : null
}

export function normalizeMarkdownText(value: string | null | undefined): string | null {
  return htmlToMarkdown(value)
}
