import type { InboxActionType } from '../data/entities'

/**
 * Check if a create_contact action for a person is missing a valid first+last name.
 * Returns true when the name has fewer than 2 space-separated parts.
 */
export function hasContactNameIssue(action: {
  actionType: InboxActionType | string
  payload: Record<string, unknown>
}): boolean {
  if (action.actionType !== 'create_contact') return false
  const type = (action.payload.type as string) || 'person'
  if (type !== 'person') return false
  const name = (action.payload.name as string) || ''
  return name.trim().split(/\s+/).length < 2
}

/**
 * Split a full name into first and last name parts.
 * Falls back to deriving name parts from email when name is a single word.
 */
export function splitPersonName(name: string, email?: string): { firstName: string; lastName: string } {
  const trimmed = name.trim()
  const parts = trimmed.split(/\s+/).filter((item) => item.length > 0)

  if (parts.length >= 2) {
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    }
  }

  // Fallback: try to derive first/last from email address
  if (email) {
    const localPart = email.split('@')[0] || ''
    const emailParts = localPart.split(/[._-]/).filter((p) => p.length > 0)
    if (emailParts.length >= 2) {
      return {
        firstName: emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1).toLowerCase(),
        lastName: emailParts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' '),
      }
    }
  }

  return {
    firstName: parts[0] || trimmed,
    lastName: '',
  }
}
