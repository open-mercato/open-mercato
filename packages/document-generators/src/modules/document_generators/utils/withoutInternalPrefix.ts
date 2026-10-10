const INTERNAL_PREFIX = '[internal] '

export function withoutInternalPrefix(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith(INTERNAL_PREFIX) ? message.slice(INTERNAL_PREFIX.length) : message
}
