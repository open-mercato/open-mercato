import type { EntityManager } from '@mikro-orm/postgresql'

export type NextInteractionProjectionResult = {
  nextInteractionId: string | null
}

/**
 * Recomputes the next-interaction projection fields on a CustomerEntity.
 *
 * Algorithm:
 * 1. Find all interactions for entityId where status = 'planned', scheduled_at IS NOT NULL, deleted_at IS NULL
 * 2. Sort by scheduled_at ASC, priority DESC NULLS LAST, created_at ASC, id ASC
 * 3. Take the first row and project its fields onto the CustomerEntity
 * 4. If no candidates, set all projection fields to NULL
 */
export async function recomputeNextInteraction(
  em: EntityManager,
  entityId: string,
  organizationId?: string | null,
): Promise<NextInteractionProjectionResult> {
  const knex = em.getKnex()

  const query = knex('customer_interactions')
    .select('id', 'scheduled_at', 'title', 'interaction_type', 'appearance_icon', 'appearance_color')
    .where('entity_id', entityId)
    .andWhere('status', 'planned')
    .whereNotNull('scheduled_at')
    .whereNull('deleted_at')
  if (organizationId) {
    query.andWhere('organization_id', organizationId)
  }

  const candidate = await query
    .orderBy([
      { column: 'scheduled_at', order: 'asc' },
      { column: 'priority', order: 'desc', nulls: 'last' },
      { column: 'created_at', order: 'asc' },
      { column: 'id', order: 'asc' },
    ])
    .first()

  if (candidate) {
    const interactionName = candidate.title && candidate.title.trim() !== ''
      ? candidate.title
      : candidate.interaction_type

    await knex('customer_entities')
      .where('id', entityId)
      .update({
        next_interaction_at: candidate.scheduled_at,
        next_interaction_name: interactionName,
        next_interaction_ref_id: candidate.id,
        next_interaction_icon: candidate.appearance_icon,
        next_interaction_color: candidate.appearance_color,
        updated_at: knex.fn.now(),
      })
    return { nextInteractionId: String(candidate.id) }
  } else {
    await knex('customer_entities')
      .where('id', entityId)
      .update({
        next_interaction_at: null,
        next_interaction_name: null,
        next_interaction_ref_id: null,
        next_interaction_icon: null,
        next_interaction_color: null,
        updated_at: knex.fn.now(),
      })
    return { nextInteractionId: null }
  }
}
