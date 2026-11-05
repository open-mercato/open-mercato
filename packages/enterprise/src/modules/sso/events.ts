import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'sso.login.initiated', label: 'SSO Login Initiated', category: 'lifecycle' },
  { id: 'sso.login.completed', label: 'SSO Login Completed', category: 'lifecycle' },
  { id: 'sso.login.failed', label: 'SSO Login Failed', category: 'lifecycle' },
  { id: 'sso.identity.linked', label: 'SSO Identity Linked', category: 'lifecycle' },
  { id: 'sso.identity.created', label: 'SSO Identity Created (JIT)', category: 'lifecycle' },
  { id: 'sso.config.created', label: 'SSO Config Created', entity: 'sso_config', category: 'crud' },
  { id: 'sso.config.updated', label: 'SSO Config Updated', entity: 'sso_config', category: 'crud' },
  { id: 'sso.config.deleted', label: 'SSO Config Deleted', entity: 'sso_config', category: 'crud' },
  { id: 'sso.config.activated', label: 'SSO Config Activated', entity: 'sso_config', category: 'lifecycle' },
  { id: 'sso.config.deactivated', label: 'SSO Config Deactivated', entity: 'sso_config', category: 'lifecycle' },
  { id: 'sso.domain.added', label: 'SSO Domain Added', entity: 'sso_config', category: 'lifecycle' },
  { id: 'sso.domain.removed', label: 'SSO Domain Removed', entity: 'sso_config', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'sso', events })
export const emitSsoEvent = eventsConfig.emit
export type SsoEventId = typeof events[number]['id']
export default eventsConfig
