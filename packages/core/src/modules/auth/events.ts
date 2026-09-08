import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Auth Module Events
 *
 * Declares all events that can be emitted by the auth module.
 */
const events = [
  // Users
  { id: 'auth.user.created', label: 'User Created', entity: 'user', category: 'crud' },
  { id: 'auth.user.updated', label: 'User Updated', entity: 'user', category: 'crud' },
  { id: 'auth.user.deleted', label: 'User Deleted', entity: 'user', category: 'crud' },

  // Roles
  { id: 'auth.role.created', label: 'Role Created', entity: 'role', category: 'crud' },
  { id: 'auth.role.updated', label: 'Role Updated', entity: 'role', category: 'crud' },
  { id: 'auth.role.deleted', label: 'Role Deleted', entity: 'role', category: 'crud' },

  // Authentication events
  { id: 'auth.login.success', label: 'Login Successful', category: 'lifecycle' },
  { id: 'auth.login.failed', label: 'Login Failed', category: 'lifecycle' },
  // The logout and password payloads below identify the user by `id` only. They are
  // emitted with `{ persistent: true }`, so the whole payload is serialized into the
  // durable events queue, while `email` is encrypted at rest under the `auth:user`
  // encryption map — a subscriber that needs the address resolves it with
  // `findOneWithDecryption` under the tenant's own key.
  // `sessionRevoked` reports that server-side revocation ran without throwing, not that
  // a session row was removed: a session that had already expired still reports `true`.
  { id: 'auth.logout', label: 'User Logged Out', category: 'lifecycle' },
  // `changedBy` discriminates who performed the write: `self` (the account owner),
  // `admin` (another authenticated user) or `system` (an `auth.users.update` carrying no
  // auth context, or running under `ctx.systemActor`). `changedById` carries the actor id
  // whenever there is one. Password writes that bypass the command emit nothing at all —
  // `mercato auth set-password` and tenant provisioning both set `passwordHash` directly.
  { id: 'auth.password.changed', label: 'Password Changed', category: 'lifecycle' },
  { id: 'auth.password.reset.requested', label: 'Password Reset Requested', category: 'lifecycle' },
  // Also emitted when an invited user sets their initial password: invitation
  // emails link to /reset/<token> and post to the same confirm endpoint, so
  // those completions arrive with no preceding `auth.password.reset.requested`.
  { id: 'auth.password.reset.completed', label: 'Password Reset Completed', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'auth',
  events,
})

/** Type-safe event emitter for auth module */
export const emitAuthEvent = eventsConfig.emit

/** Event IDs that can be emitted by the auth module */
export type AuthEventId = typeof events[number]['id']

export default eventsConfig
