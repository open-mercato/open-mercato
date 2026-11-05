import { notifyEnforcementPolicyChange } from './enforcement-deadline-notification'

export const metadata = {
  event: 'security.enforcement.updated',
  persistent: true,
  id: 'security:enforcement-updated-notification',
}

type EnforcementLifecyclePayload = {
  policyId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function enforcementUpdatedNotificationSubscriber(
  payload: EnforcementLifecyclePayload,
  ctx: ResolverContext,
) {
  await notifyEnforcementPolicyChange(payload, ctx)
}
