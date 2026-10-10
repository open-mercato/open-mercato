import { toText } from './values'

export function isDraftStatus(status: unknown, draftStatuses: ReadonlySet<string>): boolean {
  const value = toText(status)
  return !value || draftStatuses.has(value)
}
