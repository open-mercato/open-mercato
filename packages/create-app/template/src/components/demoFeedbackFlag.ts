import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export const HIDE_CONTACT_FLAG_KEY = 'ff_om_hide_contact'

export function isContactWidgetHidden(): boolean {
  if (typeof window === 'undefined') return false
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(HIDE_CONTACT_FLAG_KEY)
  } catch {
    return false
  }
  if (raw === null) return false
  return parseBooleanWithDefault(raw, true)
}
