import { convert } from 'html-to-text'

export function htmlToPlainText(html: string): string {
  if (!html) return ''
  return convert(html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  })
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
