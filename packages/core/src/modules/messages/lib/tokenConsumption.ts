import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { MessageAccessToken } from '../data/entities'

export const MAX_TOKEN_USE_COUNT = 25

export type TokenConsumptionFailureReason = 'expired' | 'exhausted' | 'not_found'

export type TokenConsumptionResult =
  | { ok: true }
  | { ok: false; reason: TokenConsumptionFailureReason }

function getKysely(em: EntityManager): Kysely<any> {
  return (em as unknown as { getKysely: () => Kysely<any> }).getKysely()
}

export async function consumeMessageAccessToken(
  em: EntityManager,
  tokenId: string,
): Promise<TokenConsumptionResult> {
  const db = getKysely(em)
  const now = new Date()
  const updateResult = await db
    .updateTable('message_access_tokens' as any)
    .set({
      use_count: sql`use_count + 1`,
      used_at: now,
    } as any)
    .where('id' as any, '=', tokenId)
    .where('use_count' as any, '<', MAX_TOKEN_USE_COUNT)
    .where('expires_at' as any, '>', now)
    .executeTakeFirst()
  const consumed = Number(updateResult?.numUpdatedRows ?? 0n)
  if (consumed > 0) return { ok: true }

  em.clear()
  const fresh = await em.findOne(MessageAccessToken, { id: tokenId })
  if (!fresh) return { ok: false, reason: 'not_found' }
  if (fresh.expiresAt < now) return { ok: false, reason: 'expired' }
  return { ok: false, reason: 'exhausted' }
}
