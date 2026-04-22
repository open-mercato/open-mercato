import { htmlToPlainText } from './htmlToPlainText'

export function buildFullTextForExtraction(args: {
  rawText?: string | null
  rawHtml?: string | null
}): string {
  let text = args.rawText || ''
  if (!text && args.rawHtml) {
    text = htmlToPlainText(args.rawHtml)
  }

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function detectPartialForward(args: {
  subject?: string | null
  threadMessageCount?: number | null
}): boolean {
  const subject = args.subject || ''
  const hasReOrFw = /^(RE|FW|Fwd):/i.test(subject)
  const messageCount = args.threadMessageCount || 0
  return hasReOrFw && messageCount < 2
}
