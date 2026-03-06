import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'security.password.changed', label: 'Password Changed', category: 'lifecycle' },
  { id: 'security.mfa.method.added', label: 'MFA Method Added', category: 'lifecycle' },
  { id: 'security.mfa.method.removed', label: 'MFA Method Removed', category: 'lifecycle' },
  { id: 'security.mfa.enrolled', label: 'MFA Enrolled', category: 'lifecycle' },
  { id: 'security.mfa.removed', label: 'MFA Removed', category: 'lifecycle' },
  { id: 'security.mfa.verified', label: 'MFA Verified', category: 'lifecycle' },
  { id: 'security.mfa.otp.sent', label: 'MFA OTP Sent', category: 'lifecycle' },
  { id: 'security.recovery.regenerated', label: 'Recovery Codes Regenerated', category: 'lifecycle' },
  { id: 'security.recovery.used', label: 'Recovery Code Used', category: 'lifecycle' },
  { id: 'security.enforcement.updated', label: 'MFA Enforcement Updated', category: 'lifecycle' },
  { id: 'security.sudo.config.updated', label: 'Sudo Config Updated', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'security', events })
export const emitSecurityEvent = eventsConfig.emit
export type SecurityEventId = typeof events[number]['id']
export default eventsConfig
