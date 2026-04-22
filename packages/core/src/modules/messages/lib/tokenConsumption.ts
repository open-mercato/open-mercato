import type { EntityManager } from '@mikro-orm/postgresql'
import { MessageAccessToken } from '../data/entities'

export const MAX_TOKEN_USE_COUNT = 25

export type TokenConsumptionFailureReason = 'expired' | 'exhausted' | 'not_found'

export type TokenConsumptionResult =
  | { ok: true }
  | { ok: false; reason: TokenConsumptionFailureReason }

export async function consumeMessageAccessToken(
  em: EntityManager,
  tokenId: string,
): Promise<TokenConsumptionResult> {
  const knex = em.getKnex()
  const now = new Date()
  const consumed = await knex('message_access_tokens')
    .where('id', tokenId)
    .where('use_count', '<', MAX_TOKEN_USE_COUNT)
    .where('expires_at', '>', now)
    .update({
      use_count: knex.raw('use_count + 1'),
      used_at: now,
    })
  if (consumed > 0) return { ok: true }

  em.clear()
  const fresh = await em.findOne(MessageAccessToken, { id: tokenId })
  if (!fresh) return { ok: false, reason: 'not_found' }
  if (fresh.expiresAt < now) return { ok: false, reason: 'expired' }
  return { ok: false, reason: 'exhausted' }
}
