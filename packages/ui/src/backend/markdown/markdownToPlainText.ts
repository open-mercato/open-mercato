export function markdownToPlainText(input: string | null | undefined): string {
  if (!input) return ''
  let text = String(input)
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/^>\s?/gm, '')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/~~([^~]+)~~/g, '$1')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/\|/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  return text
}
