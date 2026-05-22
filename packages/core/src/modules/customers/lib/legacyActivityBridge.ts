import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerActivity, CustomerInteraction } from '../data/entities'
import { CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE } from './interactionCompatibility'

type CommandContext = Parameters<CommandBus['execute']>[1]['ctx']

async function loadLegacyActivityCustomValues(
  em: EntityManager,
  activity: CustomerActivity,
): Promise<Record<string, unknown> | null> {
  const values = await loadCustomFieldValues({
    em,
    entityId: 'customers:customer_activity',
    recordIds: [activity.id],
    tenantIdByRecord: { [activity.id]: activity.tenantId },
    organizationIdByRecord: { [activity.id]: activity.organizationId },
    tenantFallbacks: [activity.tenantId],
  })
  return values[activity.id] ?? null
}

/**
 * If the canonical `customer_interactions` row for `activity` does not yet
 * exist, create it via the `customers.interactions.create` command using the
 * legacy activity's primary key. Returns the canonical id (always equal to
 * `activity.id` in this scheme).
 *
 * Mirrors the bridge in /api/customers/activities so the dialog editing flow
 * can edit historical activities that still live only in `customer_activities`
 * (root cause of #1807 PUT 404 "Interaction not found").
 */
export async function ensureCanonicalActivityBridge(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandContext,
  activity: CustomerActivity,
): Promise<string> {
  const existing = await em.findOne(CustomerInteraction, { id: activity.id, tenantId: activity.tenantId })
  if (existing) return existing.id

  const entityId = typeof activity.entity === 'string' ? activity.entity : activity.entity.id
  const dealId = activity.deal
    ? (typeof activity.deal === 'string' ? activity.deal : activity.deal.id)
    : null
  const customValues = await loadLegacyActivityCustomValues(em, activity)

  await commandBus.execute('customers.interactions.create', {
    input: {
      id: activity.id,
      tenantId: activity.tenantId,
      organizationId: activity.organizationId,
      entityId,
      interactionType: activity.activityType,
      title: activity.subject ?? null,
      body: activity.body ?? null,
      occurredAt: activity.occurredAt ?? null,
      status: activity.occurredAt ? 'done' : 'planned',
      dealId,
      authorUserId: activity.authorUserId ?? null,
      appearanceIcon: activity.appearanceIcon ?? null,
      appearanceColor: activity.appearanceColor ?? null,
      source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
      ...(customValues ? { customValues } : {}),
    },
    ctx: commandContext,
  })

  return activity.id
}

/**
 * Returns the canonical `customer_interactions.id` for the given target id. If
 * the canonical record already exists, returns it directly. Otherwise looks
 * the id up in the legacy `customer_activities` table and bridges the row into
 * `customer_interactions` via {@link ensureCanonicalActivityBridge}. If
 * neither exists, returns the original id unchanged so downstream lookups can
 * surface a normal 404.
 */
export async function resolveCanonicalActivityTargetId(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: CommandContext,
  targetId: string,
  tenantId: string,
): Promise<string> {
  const existing = await em.findOne(CustomerInteraction, { id: targetId, tenantId })
  if (existing) return existing.id

  // Reads encrypted scalar fields (subject, body, appearanceIcon, appearanceColor)
  // that are forwarded into `customers.interactions.create`. Use the decryption
  // helper so the bridged interaction inherits plaintext values rather than
  // ciphertext when tenant data encryption is enabled.
  const legacy = await findOneWithDecryption(
    em,
    CustomerActivity,
    { id: targetId, tenantId } as any,
    { populate: ['entity', 'deal'] } as any,
    { tenantId },
  )
  if (!legacy) return targetId

  return ensureCanonicalActivityBridge(em, commandBus, commandContext, legacy)
}
