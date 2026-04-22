import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
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

  const knex = getKnex(em)
  let searchQuery = knex('search_tokens')
    .select('entity_id')
    .where('entity_type', 'messages:message')
    .whereIn('field', fields)
    .whereIn('token_hash', tokens.hashes)
    .groupBy('entity_id')
    .havingRaw('count(distinct token_hash) >= ?', [tokens.hashes.length])

  searchQuery = searchQuery.whereRaw('tenant_id is not distinct from ?', [tenantId])
  if (organizationId) {
    searchQuery = searchQuery.where('organization_id', organizationId)
  } else {
    searchQuery = searchQuery.whereRaw('organization_id is not distinct from ?', [null])
  }

  const rows = await searchQuery
  return rows
    .map((row: { entity_id?: unknown }) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
}
