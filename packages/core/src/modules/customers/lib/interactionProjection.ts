import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'

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
  const db = em.getKysely<any>() as any

  let query = db
    .selectFrom('customer_interactions')
    .select([
      'id',
      'scheduled_at',
      'title',
      'interaction_type',
      'appearance_icon',
      'appearance_color',
    ])
    .where('entity_id', '=', entityId)
    .where('status', '=', 'planned')
    .where('scheduled_at', 'is not', null)
    .where('deleted_at', 'is', null)
  if (organizationId) {
    query = query.where('organization_id', '=', organizationId)
  }

  const candidate = await query
    .orderBy('scheduled_at', 'asc')
    .orderBy(sql`priority desc nulls last`)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .executeTakeFirst() as Record<string, any> | undefined

  if (candidate) {
    const interactionName = candidate.title && candidate.title.trim() !== ''
      ? candidate.title
      : candidate.interaction_type

    await db
      .updateTable('customer_entities')
      .set({
        next_interaction_at: candidate.scheduled_at,
        next_interaction_name: interactionName,
        next_interaction_ref_id: candidate.id,
        next_interaction_icon: candidate.appearance_icon,
        next_interaction_color: candidate.appearance_color,
        updated_at: sql`now()`,
      } as any)
      .where('id', '=', entityId)
      .execute()
    return { nextInteractionId: String(candidate.id) }
  } else {
    await db
      .updateTable('customer_entities')
      .set({
        next_interaction_at: null,
        next_interaction_name: null,
        next_interaction_ref_id: null,
        next_interaction_icon: null,
        next_interaction_color: null,
        updated_at: sql`now()`,
      } as any)
      .where('id', '=', entityId)
      .execute()
    return { nextInteractionId: null }
  }
}
