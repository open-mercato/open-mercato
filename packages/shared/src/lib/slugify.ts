export type SlugifyOptions = {
  replacement?: string
  allowedChars?: string
  trimReplacement?: boolean
}

const DEFAULT_REPLACEMENT = '-'
const DEFAULT_ALLOWED_CHARS = '-'

const escapeRegex = (value: string): string => value.replace(/[\\^$.*+?()[\]{}|\-]/g, '\\$&')

export function slugify(value: string, options: SlugifyOptions = {}): string {
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT
  const allowedChars = options.allowedChars ?? DEFAULT_ALLOWED_CHARS
  const trimReplacement = options.trimReplacement ?? true
  const normalized = value.toLowerCase().trim()
  if (!normalized) return ''
  const escapedAllowed = escapeRegex(allowedChars)
  const invalidPattern = new RegExp(`[^a-z0-9${escapedAllowed}]+`, 'g')
  const replaced = normalized.replace(invalidPattern, replacement)
  if (!trimReplacement || replacement.length !== 1 || !replaced) return replaced
  const char = replacement
  let start = 0
  let end = replaced.length
  while (start < end && replaced[start] === char) start += 1
  while (end > start && replaced[end - 1] === char) end -= 1
  return replaced.slice(start, end)
}
