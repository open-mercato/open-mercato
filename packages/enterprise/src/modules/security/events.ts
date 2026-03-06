import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'security.password.changed', label: 'Password Changed', category: 'lifecycle' },
  { id: 'security.mfa.method.added', label: 'MFA Method Added', category: 'lifecycle' },
  { id: 'security.mfa.method.removed', label: 'MFA Method Removed', category: 'lifecycle' },
  { id: 'security.enforcement.updated', label: 'MFA Enforcement Updated', category: 'lifecycle' },
  { id: 'security.sudo.config.updated', label: 'Sudo Config Updated', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'security', events })
export const emitSecurityEvent = eventsConfig.emit
export type SecurityEventId = typeof events[number]['id']
export default eventsConfig
