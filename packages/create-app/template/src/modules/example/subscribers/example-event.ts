import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('example').child({ component: 'example-ping-subscriber' })

export const metadata = {
  event: 'example.ping',
  persistent: false,
}

/**
 * Payload of the ad-hoc `example.ping` event. A subscriber owns the shape it reads:
 * declaring it here keeps the handler's public boundary typed even for an event that
 * carries no module-declared contract.
 */
export type ExamplePingPayload = {
  message?: string
  tenantId?: string | null
  organizationId?: string | null
}

/**
 * Ephemeral subscribers receive a resolver rather than the container itself. Typing the
 * resolver generically (`<T>(name: string) => T`) instead of defaulting the parameter to
 * `any` is what keeps every `ctx.resolve(...)` call site typed at its use.
 */
export type SubscriberResolverContext = {
  resolve: <T>(name: string) => T
}

export default async function onExamplePing(
  payload: ExamplePingPayload,
  ctx: SubscriberResolverContext,
): Promise<void> {
  // demo subscriber; keep side-effects minimal
  ctx.resolve<EntityManager>('em')
  logger.debug('Received example.ping', { message: payload?.message ?? null })
}
