import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID,
  resolveCommunicationChannelsSystemUserId,
} from '@open-mercato/core/modules/communication_channels/lib/system-user'
import { CHANNEL_DISCORD_AI_AUTO_REPLY_RUN_FEATURE } from './ai-features'

const logger = createLogger('channel_discord').child({ component: 'ai-service-principal' })

/**
 * The auth context the AI auto-reply subscriber runs an agent under.
 *
 * Field names match `AiChatRequestContext` from `@open-mercato/ai-assistant` on
 * purpose — the subscriber hands this object straight to `runAiAgentObject` —
 * but the type is declared locally so the optional peer stays optional.
 */
export type DiscordAiPrincipal = {
  tenantId: string
  organizationId: string | null
  userId: string
  features: string[]
  isSuperAdmin: boolean
  /** Which of the two identities below produced the grants. Logged, never sent to the model. */
  source: 'channel_bot_user' | 'provider_service_principal'
}

/**
 * The grants the provider's own service principal carries by construction, with
 * no operator setup. Exactly one non-data feature: it unlocks the provider's own
 * object-mode auto-reply agent and nothing else. Any agent gated on anything
 * broader — a customers support agent, say — is NOT reachable from this identity
 * and needs the channel-bot user path below.
 */
const PROVIDER_SERVICE_PRINCIPAL_FEATURES: readonly string[] = [
  CHANNEL_DISCORD_AI_AUTO_REPLY_RUN_FEATURE,
]

type AclSnapshot = { features: string[]; isSuperAdmin: boolean }

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<AclSnapshot & { organizations: string[] | null }>
}

export type DiscordAiPrincipalResolver = {
  resolve: <T = unknown>(name: string) => T
}

function tryResolveRbacService(resolver: DiscordAiPrincipalResolver): RbacServiceLike | null {
  try {
    const service = resolver.resolve<RbacServiceLike>('rbacService')
    return service && typeof service.loadAcl === 'function' ? service : null
  } catch {
    return null
  }
}

/**
 * Resolve the identity an inbound Discord message may borrow to have a reply
 * drafted (SPEC 2026-06-19 § AI bot wiring — "Safety / RBAC", issue #4778).
 *
 * There are two identities, and the difference between them is the whole point:
 *
 * 1. **Channel-bot user** — a real `auth.user` row following the hub's
 *    `system+communication_channels@<tenantId>.local` convention. When a tenant
 *    creates one, its role grants are loaded through `rbacService.loadAcl` and
 *    become the principal's features. This is the supported way to let auto-reply
 *    use an agent this provider does not own: grant the bot user the role that
 *    agent's `requiredFeatures` need.
 * 2. **Provider service principal** — the fallback when no such user exists.
 *    It carries {@link PROVIDER_SERVICE_PRINCIPAL_FEATURES} only.
 *
 * Two invariants hold on both paths:
 *
 * - `isSuperAdmin` is **always** false. An inbound message from a public Discord
 *   server must not be able to borrow a super-admin's ACL, so a bot user who
 *   happens to be one is clamped down (and the clamp is logged, because it means
 *   the tenant gave a bot account far more than it needs).
 * - The provider grant is always present. It is what makes the provider's own
 *   agent work out of the box; it can never widen access to anything else,
 *   because no tool or route is gated on it.
 */
export async function resolveDiscordAiPrincipal(params: {
  em: EntityManager
  resolver: DiscordAiPrincipalResolver
  scope: { tenantId: string; organizationId: string | null }
}): Promise<DiscordAiPrincipal> {
  const { em, resolver, scope } = params
  const base: DiscordAiPrincipal = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: COMMUNICATION_CHANNELS_SYSTEM_USER_ID,
    features: [...PROVIDER_SERVICE_PRINCIPAL_FEATURES],
    isSuperAdmin: false,
    source: 'provider_service_principal',
  }

  const botUserId = await resolveCommunicationChannelsSystemUserId(em, scope.tenantId, null)
  if (botUserId === COMMUNICATION_CHANNELS_SYSTEM_USER_ID) return base

  const rbacService = tryResolveRbacService(resolver)
  if (!rbacService) {
    logger.debug('rbacService unavailable — running auto-reply under the provider service principal', {
      tenantId: scope.tenantId,
    })
    return { ...base, userId: botUserId }
  }

  let acl: AclSnapshot
  try {
    acl = await rbacService.loadAcl(botUserId, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (err) {
    logger.warn('Failed to load the channel-bot ACL — falling back to the provider service principal', {
      tenantId: scope.tenantId,
      err,
    })
    return { ...base, userId: botUserId }
  }

  if (acl.isSuperAdmin) {
    logger.warn(
      'Channel-bot user is a super-admin; clamping the auto-reply principal to its explicit features',
      { tenantId: scope.tenantId },
    )
  }

  const features = Array.from(new Set([...PROVIDER_SERVICE_PRINCIPAL_FEATURES, ...acl.features]))
  return {
    ...base,
    userId: botUserId,
    features,
    isSuperAdmin: false,
    source: 'channel_bot_user',
  }
}

export { PROVIDER_SERVICE_PRINCIPAL_FEATURES }
