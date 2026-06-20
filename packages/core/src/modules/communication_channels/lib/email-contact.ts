import type { ContactHint, ResolveContactInput } from './adapter'

/**
 * Shared `resolveContact` for email providers. An email sender identifier *is*
 * the contact email, so the hint is a direct passthrough; non-email identifiers
 * (or empty senders) yield `null` and the hub falls back to its own resolution.
 */
export async function emailResolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
  if (!input.senderIdentifier) return null
  if (input.senderIdentifier.includes('@')) {
    return {
      email: input.senderIdentifier,
      displayName: input.senderDisplayName,
    }
  }
  return null
}
