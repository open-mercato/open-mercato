import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerTodoLink } from '../data/entities'

/**
 * Surface a customer-bound workflow task on the customer's own Tasks section
 * (spec §2.3: *"workflow tasks bound to a customer surface through the same
 * link mechanism (`todoSource: 'workflows'`)"*).
 *
 * **Direction matters.** The customers module owns `CustomerTodoLink`, so
 * customers is the one that writes it — workflows only announces that a task
 * exists and which records it is about. Workflows never imports a customers
 * entity, no cross-module ORM relationship is created, and a deployment
 * without the customers module simply has no subscriber (root AGENTS.md →
 * Architecture; core AGENTS.md → Cross-Module Coupling).
 *
 * The link row is the cheap half of §2.3: it uses the existing entity and its
 * existing unique key `(entity, todoId, todoSource)`, so no new entity and no
 * migration are needed — which is exactly why the C3 `Task` entity stays
 * deferred.
 */

export const WORKFLOW_TASK_TODO_SOURCE = 'workflows'

/** Postgres unique violation — a redelivered event must be a no-op, not a failure. */
const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * Binding types that address a `CustomerEntity`.
 *
 * Deals are deliberately absent: `CustomerTodoLink.entity` is a foreign key to
 * `customer_entities`, and a deal lives in `customer_deals`. A deal-bound task
 * surfaces through the record-page widget instead of through this link.
 */
const CUSTOMER_ENTITY_BINDING_TYPES = new Set([
  'customers:person',
  'customers:company',
  'customers:customer_entity',
])

/**
 * `customers.person` and `customers:person` are the same record type — entity
 * ids use `:`, record-detail injection contexts use `.`. Normalized locally
 * rather than imported from workflows so this module stays independent of it
 * (a subscriber for an absent module's event simply never fires).
 */
function normalizeBindingType(entityType: string): string {
  return entityType.trim().toLowerCase().replace(/\./g, ':')
}

export type WorkflowTaskAssignedBinding = {
  entityType?: unknown
  entityId?: unknown
}

export type WorkflowTaskAssignedPayload = {
  taskId?: unknown
  tenantId?: unknown
  organizationId?: unknown
  entityBindings?: unknown
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Ids of the customer records a task is about, de-duplicated and narrowed to
 * the binding types that actually address a `CustomerEntity`.
 *
 * Pure — the whole "which bindings count" decision is assertable without a
 * database.
 */
export function collectCustomerEntityIds(bindings: unknown): string[] {
  if (!Array.isArray(bindings)) return []
  const ids = new Set<string>()
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) continue
    const { entityType, entityId } = binding as WorkflowTaskAssignedBinding
    if (typeof entityType !== 'string' || typeof entityId !== 'string' || !entityId.length) continue
    if (!CUSTOMER_ENTITY_BINDING_TYPES.has(normalizeBindingType(entityType))) continue
    ids.add(entityId)
  }
  return [...ids]
}

export default async function handler(
  payload: WorkflowTaskAssignedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  const taskId = payload?.taskId
  const tenantId = payload?.tenantId
  const organizationId = payload?.organizationId
  if (typeof taskId !== 'string' || !taskId.length) return
  // Fail closed: an unscoped write could attach a task to another tenant's
  // customer.
  if (typeof tenantId !== 'string' || !tenantId.length) return
  if (typeof organizationId !== 'string' || !organizationId.length) return

  const entityIds = collectCustomerEntityIds(payload.entityBindings)
  if (!entityIds.length) return

  const em = ctx.resolve<EntityManager>('em')

  for (const entityId of entityIds) {
    // The binding id is authored free text resolved from run context, so it is
    // only assumed to be a customer once the scoped lookup says so.
    const entity = await em.findOne(CustomerEntity, { id: entityId, tenantId, organizationId })
    if (!entity) continue

    const existing = await em.findOne(CustomerTodoLink, {
      entity,
      todoId: taskId,
      todoSource: WORKFLOW_TASK_TODO_SOURCE,
    })
    if (existing) continue

    const link = em.create(CustomerTodoLink, {
      entity,
      todoId: taskId,
      todoSource: WORKFLOW_TASK_TODO_SOURCE,
      tenantId,
      organizationId,
    })

    try {
      await em.persist(link).flush()
    } catch (error) {
      // At-least-once delivery: losing the race against a concurrent delivery
      // is the unique key doing its job, not a failure.
      const code = (error as { code?: unknown })?.code
      if (code === POSTGRES_UNIQUE_VIOLATION) continue
      throw error
    }
  }
}
