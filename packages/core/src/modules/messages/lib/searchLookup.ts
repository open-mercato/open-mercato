import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'

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
  const trimmed = query.trim()
  if (!trimmed) return null

  const tokens = tokenizeText(trimmed, resolveSearchConfig())
  if (!tokens.hashes.length) return []

  const db = getDb(em) as any
  let searchQuery = db
    .selectFrom('search_tokens')
    .select('entity_id')
    .where('entity_type', '=', 'messages:message')
    .where('field', 'in', fields)
    .where('token_hash', 'in', tokens.hashes)
    .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)

  if (organizationId) {
    searchQuery = searchQuery.where('organization_id', '=', organizationId)
  } else {
    searchQuery = searchQuery.where(sql<boolean>`organization_id is not distinct from ${null}`)
  }

  const rows = await searchQuery
    .groupBy('entity_id')
    .having(sql<boolean>`count(distinct token_hash) >= ${tokens.hashes.length}`)
    .execute()

  return rows
    .map((row: { entity_id?: unknown }) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
}
