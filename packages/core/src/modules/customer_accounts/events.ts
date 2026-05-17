import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'customer_accounts.user.created', label: 'Customer User Created', entity: 'user', category: 'crud', clientBroadcast: true },
  { id: 'customer_accounts.user.updated', label: 'Customer User Updated', entity: 'user', category: 'crud', portalBroadcast: true },
  { id: 'customer_accounts.user.deleted', label: 'Customer User Deleted', entity: 'user', category: 'crud' },
  { id: 'customer_accounts.user.locked', label: 'Customer User Locked', entity: 'user', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_accounts.user.unlocked', label: 'Customer User Unlocked', entity: 'user', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_accounts.login.success', label: 'Customer Login Successful', category: 'lifecycle' },
  { id: 'customer_accounts.login.failed', label: 'Customer Login Failed', category: 'lifecycle' },
  { id: 'customer_accounts.magic_link.requested', label: 'Customer Magic Link Requested', category: 'lifecycle' },
  { id: 'customer_accounts.email.verified', label: 'Customer Email Verified', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_accounts.password.reset_requested', label: 'Customer Password Reset Requested', category: 'lifecycle' },
  { id: 'customer_accounts.password.reset', label: 'Customer Password Reset', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_accounts.password.changed', label: 'Customer Password Changed', category: 'lifecycle' },
  { id: 'customer_accounts.role.created', label: 'Customer Role Created', entity: 'role', category: 'crud' },
  { id: 'customer_accounts.role.updated', label: 'Customer Role Updated', entity: 'role', category: 'crud', portalBroadcast: true },
  { id: 'customer_accounts.role.deleted', label: 'Customer Role Deleted', entity: 'role', category: 'crud' },
  { id: 'customer_accounts.invitation.accepted', label: 'Customer Invitation Accepted', category: 'lifecycle', clientBroadcast: true },
  { id: 'customer_accounts.password_reset.requested', label: 'Customer Password Reset Requested', category: 'lifecycle' },
  // Custom domain mapping lifecycle (see .ai/specs/2026-04-08-portal-custom-domain-routing.md)
  { id: 'customer_accounts.domain_mapping.created', label: 'Custom Domain Registered', entity: 'domain_mapping', category: 'crud', clientBroadcast: true },
  { id: 'customer_accounts.domain_mapping.verified', label: 'Custom Domain DNS Verified', entity: 'domain_mapping', category: 'lifecycle', clientBroadcast: true },
  { id: 'customer_accounts.domain_mapping.activated', label: 'Custom Domain Active', entity: 'domain_mapping', category: 'lifecycle', clientBroadcast: true },
  { id: 'customer_accounts.domain_mapping.dns_failed', label: 'Custom Domain DNS Verification Failed', entity: 'domain_mapping', category: 'lifecycle', clientBroadcast: true },
  { id: 'customer_accounts.domain_mapping.tls_failed', label: 'Custom Domain SSL Provisioning Failed', entity: 'domain_mapping', category: 'lifecycle', clientBroadcast: true },
  { id: 'customer_accounts.domain_mapping.deleted', label: 'Custom Domain Removed', entity: 'domain_mapping', category: 'crud', clientBroadcast: true },
  { id: 'customer_accounts.domain_mapping.replaced', label: 'Custom Domain Replaced', entity: 'domain_mapping', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'customer_accounts',
  events,
})

export const emitCustomerAccountsEvent = eventsConfig.emit

export type CustomerAccountsEventId = typeof events[number]['id']

export default eventsConfig
