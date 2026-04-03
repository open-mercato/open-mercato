import type { EntityManager } from '@mikro-orm/postgresql'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ExampleCustomerInteractionMapping } from './entities'
import { buildExampleTodoHref } from '../lib/mappings'

type InteractionRecord = Record<string, unknown> & { id: string }

function mergeExampleIntegration(
  record: InteractionRecord,
  mapping: ExampleCustomerInteractionMapping | null,
): InteractionRecord {
  if (!mapping) return record
  const integrations =
    record._integrations && typeof record._integrations === 'object'
      ? { ...(record._integrations as Record<string, unknown>) }
      : {}
  integrations.example = {
    todoId: mapping.todoId,
    href: buildExampleTodoHref(mapping.todoId),
    syncStatus: mapping.syncStatus,
    lastError: mapping.lastError ?? null,
    lastSyncedAt: mapping.lastSyncedAt ? mapping.lastSyncedAt.toISOString() : null,
  }
  return {
    ...record,
    _integrations: integrations,
  }
}

const exampleCustomersSyncEnricher: ResponseEnricher<InteractionRecord> = {
  id: 'example_customers_sync.interaction-links',
  targetEntity: 'customers.interaction',
  features: ['example.todos.view'],
  priority: 20,
  timeout: 2000,
  fallback: {},
  async enrichOne(record, context) {
    const mapping = await findWithDecryption(
      context.em as EntityManager,
      ExampleCustomerInteractionMapping,
      {
        interactionId: record.id,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      },
      undefined,
      { tenantId: context.tenantId, organizationId: context.organizationId },
    ).then((items) => items[0] ?? null)
    return mergeExampleIntegration(record, mapping)
  },
  async enrichMany(records, context) {
    const interactionIds = records.map((record) => record.id)
    if (!interactionIds.length) return records
    const mappings = await findWithDecryption(
      context.em as EntityManager,
      ExampleCustomerInteractionMapping,
      {
        interactionId: { $in: interactionIds },
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      },
      undefined,
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )
    const mappingByInteractionId = new Map(mappings.map((mapping) => [mapping.interactionId, mapping]))
    return records.map((record) => mergeExampleIntegration(record, mappingByInteractionId.get(record.id) ?? null))
  },
}

export const enrichers: ResponseEnricher[] = [exampleCustomersSyncEnricher]
