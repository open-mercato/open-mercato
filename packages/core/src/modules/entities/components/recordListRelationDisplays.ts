import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import {
  buildRelationHref,
  collectRelationValueIds,
  fetchRelationRecordDisplays,
  parseRelationOptionsMetadata,
  type RelationOptionsMetadata,
  type ResolvedValueDisplay,
} from '@open-mercato/ui/backend/utils/customFieldRelationDisplay'

export type RelationDisplaysByField = Record<string, Record<string, ResolvedValueDisplay>>

type RelationLookup = {
  optionsUrl: string
  relation: RelationOptionsMetadata
  recordIds: Set<string>
  recordIdsByField: Map<string, Set<string>>
}

export function resolveRelationOptionsUrl(definition: CustomFieldDefDto): string | null {
  if (definition.kind !== 'relation') return null

  const configuredUrl = definition.optionsUrl?.trim()
  if (configuredUrl && parseRelationOptionsMetadata(configuredUrl)) return configuredUrl

  const relatedEntityId = definition.relatedEntityId?.trim()
  if (!relatedEntityId) return null
  return `/api/entities/relations/options?entityId=${encodeURIComponent(relatedEntityId)}`
}

function collectRelationLookups(
  definitions: CustomFieldDefDto[],
  records: Array<Record<string, unknown>>,
): RelationLookup[] {
  const lookups = new Map<string, RelationLookup>()

  definitions.forEach((definition) => {
    const optionsUrl = resolveRelationOptionsUrl(definition)
    if (!optionsUrl) return
    const relation = parseRelationOptionsMetadata(optionsUrl)
    if (!relation) return

    const recordIds = new Set(
      records.flatMap((record) => collectRelationValueIds(record[definition.key])),
    )
    if (!recordIds.size) return

    const lookupKey = JSON.stringify([relation.entityId, optionsUrl])
    const lookup = lookups.get(lookupKey) ?? {
      optionsUrl,
      relation,
      recordIds: new Set<string>(),
      recordIdsByField: new Map<string, Set<string>>(),
    }
    recordIds.forEach((recordId) => lookup.recordIds.add(recordId))
    lookup.recordIdsByField.set(definition.key, recordIds)
    lookups.set(lookupKey, lookup)
  })

  return Array.from(lookups.values())
}

export async function resolveRecordListRelationDisplays(
  definitions: CustomFieldDefDto[],
  records: Array<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<RelationDisplaysByField> {
  const displaysByField: RelationDisplaysByField = {}
  const lookups = collectRelationLookups(definitions, records)

  await Promise.all(lookups.map(async (lookup) => {
    let fetchedDisplays: Record<string, ResolvedValueDisplay> = {}
    try {
      fetchedDisplays = await fetchRelationRecordDisplays(
        lookup.optionsUrl,
        lookup.relation,
        Array.from(lookup.recordIds),
        signal,
      )
    } catch {
      fetchedDisplays = {}
    }

    if (signal?.aborted) return
    lookup.recordIdsByField.forEach((recordIds, fieldKey) => {
      const fieldDisplays: Record<string, ResolvedValueDisplay> = {}
      recordIds.forEach((recordId) => {
        fieldDisplays[recordId] = fetchedDisplays[recordId] ?? {
          label: recordId,
          href: buildRelationHref(lookup.relation.entityId, recordId),
        }
      })
      displaysByField[fieldKey] = fieldDisplays
    })
  }))

  return displaysByField
}

export function getRecordListRelationDisplays(
  value: unknown,
  displays: Record<string, ResolvedValueDisplay> | undefined,
): Array<{ id: string; label: string; href?: string }> {
  return collectRelationValueIds(value).map((recordId) => ({
    id: recordId,
    label: displays?.[recordId]?.label ?? recordId,
    href: displays?.[recordId]?.href,
  }))
}
