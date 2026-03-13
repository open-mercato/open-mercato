export const notificationRenderers = {
  'customer_accounts.user.signup': {
    icon: 'user-plus',
    getTitle: (data: Record<string, unknown>) => `New customer signup: ${data.email || 'unknown'}`,
    getBody: (data: Record<string, unknown>) => `A new customer account was created for ${data.email || 'unknown'}.`,
    getHref: (data: Record<string, unknown>) => `/backend/customer_accounts/${data.userId || ''}`,
  },
  'customer_accounts.user.locked': {
    icon: 'lock',
    getTitle: (data: Record<string, unknown>) => `Customer account locked: ${data.email || 'unknown'}`,
    getBody: (data: Record<string, unknown>) => `Customer account ${data.email || 'unknown'} was locked due to too many failed login attempts.`,
    getHref: (data: Record<string, unknown>) => `/backend/customer_accounts/${data.userId || ''}`,
  },
}

export default notificationRenderers
