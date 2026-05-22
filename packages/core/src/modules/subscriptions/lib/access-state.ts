export type SubscriptionAccessState = 'pending' | 'granted' | 'grace' | 'blocked'

export function mapProviderStatusToAccessState(providerStatus: string | null | undefined): SubscriptionAccessState {
  if (!providerStatus) return 'pending'
  switch (providerStatus.toLowerCase()) {
    case 'trialing':
    case 'active':
      return 'granted'
    case 'past_due':
      return 'grace'
    case 'incomplete':
      return 'pending'
    case 'canceled':
    case 'cancelled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'blocked'
    default:
      return 'pending'
  }
}
