import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { findEntityIdsBySearchTokensCompat } from '@open-mercato/shared/lib/search/tokenLookup'

function getDb(em: EntityManager): Kysely<any> {
  return em.getKysely<any>()
}

export async function findMessageIdsBySearchTokens({
  em,
  query,
  tenantId,
  organizationId,
  fields = ['subject', 'body', 'external_name'],
}: {
  em: EntityManager
  query: string
  tenantId: string | null
  organizationId: string | null
  fields?: string[]
}): Promise<string[] | null> {
  return findEntityIdsBySearchTokensCompat({
    db: getDb(em),
    entityType: 'messages:message',
    query,
    fields,
    scope: { tenantId, organizationId },
  })
}
