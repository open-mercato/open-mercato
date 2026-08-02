import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { findEntityIdsBySearchTokensCompat, type SearchTokenDatabase } from '@open-mercato/shared/lib/search/tokenLookup'

function getDb(em: EntityManager): Kysely<SearchTokenDatabase> {
  return em.getKysely<SearchTokenDatabase>()
}

export async function findMessageIdsBySearchTokens({
  em,
  query,
  tenantId,
  organizationId,
  organizationIds,
  fields = ['subject', 'body', 'external_name'],
}: {
  em: EntityManager
  query: string
  tenantId: string | null
  organizationId?: string | null
  organizationIds?: readonly string[] | null
  fields?: string[]
}): Promise<string[] | null> {
  return findEntityIdsBySearchTokensCompat({
    db: getDb(em),
    entityType: 'messages:message',
    query,
    fields,
    scope: { tenantId, organizationId, organizationIds },
  })
}
