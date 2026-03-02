/**
 * External ID Mapping Enricher
 *
 * Enriches any entity's API response with external integration ID mappings.
 * Adds `_integrations` namespace containing all external IDs for the record.
 *
 * Uses batch queries via `enrichMany` to prevent N+1.
 */

import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { ExternalIdEnrichment } from '@open-mercato/shared/modules/integrations/types'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { SyncExternalIdMapping } from './entities'

type EntityRecord = Record<string, unknown> & { id: string }

function buildIntegrationData(
  mappings: SyncExternalIdMapping[],
): ExternalIdEnrichment['_integrations'] {
  const data: ExternalIdEnrichment['_integrations'] = {}

  for (const mapping of mappings) {
    const definition = getIntegration(mapping.integrationId)
    data[mapping.integrationId] = {
      externalId: mapping.externalId,
      externalUrl: definition?.buildExternalUrl?.(mapping.externalId),
      lastSyncedAt: mapping.lastSyncedAt?.toISOString(),
      syncStatus: mapping.syncStatus,
    }
  }

  return data
}

const externalIdMappingEnricher: ResponseEnricher<EntityRecord, ExternalIdEnrichment> = {
  id: 'integrations.external-id-mapping',
  targetEntity: '*',
  features: ['integrations.view'],
  priority: 10,
  timeout: 500,
  critical: false,
  fallback: {},

  async enrichOne(record, context: EnricherContext & { targetEntity?: string }) {
    const em = (context.em as any).fork()
    const targetEntity = (context as any).targetEntity as string | undefined
    if (!targetEntity) return { ...record, _integrations: {} }

    const mappings: SyncExternalIdMapping[] = await em.find(SyncExternalIdMapping, {
      internalEntityType: targetEntity,
      internalEntityId: record.id,
      organizationId: context.organizationId,
      deletedAt: null,
    })

    if (mappings.length === 0) return { ...record, _integrations: {} }

    return {
      ...record,
      _integrations: buildIntegrationData(mappings),
    }
  },

  async enrichMany(records, context: EnricherContext & { targetEntity?: string }) {
    const em = (context.em as any).fork()
    const targetEntity = (context as any).targetEntity as string | undefined
    if (!targetEntity || records.length === 0) return records.map((r) => ({ ...r, _integrations: {} }))

    const recordIds = records.map((r) => r.id)
    const allMappings: SyncExternalIdMapping[] = await em.find(SyncExternalIdMapping, {
      internalEntityType: targetEntity,
      internalEntityId: { $in: recordIds },
      organizationId: context.organizationId,
      deletedAt: null,
    })

    if (allMappings.length === 0) return records.map((r) => ({ ...r, _integrations: {} }))

    const mappingsByRecord = new Map<string, SyncExternalIdMapping[]>()
    for (const mapping of allMappings) {
      const list = mappingsByRecord.get(mapping.internalEntityId) ?? []
      list.push(mapping)
      mappingsByRecord.set(mapping.internalEntityId, list)
    }

    return records.map((record) => {
      const mappings = mappingsByRecord.get(record.id)
      if (!mappings || mappings.length === 0) return { ...record, _integrations: {} }

      return {
        ...record,
        _integrations: buildIntegrationData(mappings),
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [externalIdMappingEnricher]
