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
  { id: 'auth.logout', label: 'User Logged Out', category: 'lifecycle' },
  { id: 'auth.password.changed', label: 'Password Changed', category: 'lifecycle' },
  { id: 'auth.password.reset.requested', label: 'Password Reset Requested', category: 'lifecycle' },
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
