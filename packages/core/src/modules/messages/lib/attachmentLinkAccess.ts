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

/** A key is evaluated as the key alone. Keys cannot compose messages, so no session user applies here. */
export function resolveAttachmentLinkAccess(ctx: {
  auth?: AuthContext | null
  container: AwilixContainer
}): MessageAttachmentLinkAccess | undefined {
  if (!ctx.auth) return undefined
  return { auth: ctx.auth.isApiKey ? { ...ctx.auth, userId: undefined } : ctx.auth, container: ctx.container }
}
