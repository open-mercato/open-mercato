import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

/**
 * Principal used to apply attachment owner access policies when files are linked
 * to a message. Without it, attachments whose owner declares a policy are refused.
 */
export type MessageAttachmentLinkAccess = {
  auth: NonNullable<AuthContext>
  container: AwilixContainer
}

export function resolveAttachmentLinkAccess(ctx: {
  auth?: AuthContext | null
  container: AwilixContainer
}): MessageAttachmentLinkAccess | undefined {
  return ctx.auth ? { auth: ctx.auth, container: ctx.container } : undefined
}
