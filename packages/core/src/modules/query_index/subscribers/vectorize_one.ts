// Dummy second-stage indexer: would compute embeddings later
export const metadata = { event: 'query_index.vectorize_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const knex = (em as any).getConnection().getKnex()
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  const organizationId = payload?.organizationId ?? null
  if (!entityType || !recordId) return
  try {
    // Placeholder: set embedding to null for now
    await knex('entity_indexes')
      .where({ entity_type: entityType, entity_id: recordId })
      .modify((qb: any) => {
        if (organizationId !== undefined) qb.andWhere((b: any) => b.where({ organization_id: organizationId }).orWhereNull('organization_id'))
      })
      .update({ embedding: null, updated_at: knex.fn.now() })
  } catch {}
}


