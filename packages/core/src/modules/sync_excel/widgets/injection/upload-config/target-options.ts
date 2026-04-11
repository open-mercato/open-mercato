import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import type { FieldMapping, FieldMappingDedupeRole, FieldMappingKind } from '../../../../data_sync/lib/adapter'

export const SYNC_EXCEL_PEOPLE_CUSTOM_FIELD_ENTITY_IDS = [
  'customers:customer_entity',
  'customers:customer_person_profile',
] as const

export type SuggestedMapping = {
  entityType: 'customers.person'
  matchStrategy: 'externalId' | 'email' | 'custom'
  matchField?: string
  fields: FieldMapping[]
  unmappedColumns: string[]
}

export type MappingTargetOption = {
  value: string
  labelKey?: string
  fallback: string
  mappingKind: FieldMappingKind
  dedupeRole?: FieldMappingDedupeRole
  matchTokens: string[]
}

const CORE_TARGET_OPTIONS: MappingTargetOption[] = [
  {
    value: 'person.externalId',
    labelKey: 'sync_excel.mapping.targets.externalId',
    fallback: 'External ID',
    mappingKind: 'external_id',
    dedupeRole: 'primary',
    matchTokens: ['external id', 'record id', 'lead id'],
  },
  {
    value: 'person.firstName',
    labelKey: 'sync_excel.mapping.targets.firstName',
    fallback: 'First name',
    mappingKind: 'core',
    matchTokens: ['first name', 'firstname', 'given name'],
  },
  {
    value: 'person.lastName',
    labelKey: 'sync_excel.mapping.targets.lastName',
    fallback: 'Last name',
    mappingKind: 'core',
    matchTokens: ['last name', 'lastname', 'surname', 'family name'],
  },
  {
    value: 'person.displayName',
    labelKey: 'sync_excel.mapping.targets.displayName',
    fallback: 'Display name',
    mappingKind: 'core',
    matchTokens: ['display name', 'lead name', 'full name', 'name'],
  },
  {
    value: 'person.primaryEmail',
    labelKey: 'sync_excel.mapping.targets.primaryEmail',
    fallback: 'Primary email',
    mappingKind: 'core',
    dedupeRole: 'secondary',
    matchTokens: ['email', 'primary email', 'email address'],
  },
  {
    value: 'person.primaryPhone',
    labelKey: 'sync_excel.mapping.targets.primaryPhone',
    fallback: 'Primary phone',
    mappingKind: 'core',
    matchTokens: ['phone', 'primary phone', 'mobile', 'mobile phone', 'telephone'],
  },
  {
    value: 'person.jobTitle',
    labelKey: 'sync_excel.mapping.targets.jobTitle',
    fallback: 'Job title',
    mappingKind: 'core',
    matchTokens: ['job title', 'title', 'position'],
  },
  {
    value: 'person.status',
    labelKey: 'sync_excel.mapping.targets.status',
    fallback: 'Status',
    mappingKind: 'core',
    matchTokens: ['status', 'lead status'],
  },
  {
    value: 'person.source',
    labelKey: 'sync_excel.mapping.targets.source',
    fallback: 'Source',
    mappingKind: 'core',
    matchTokens: ['source', 'lead source'],
  },
  {
    value: 'person.description',
    labelKey: 'sync_excel.mapping.targets.description',
    fallback: 'Description',
    mappingKind: 'core',
    matchTokens: ['description', 'notes', 'comment'],
  },
]

const ADDRESS_TARGET_OPTIONS: MappingTargetOption[] = [
  {
    value: 'address.name',
    labelKey: 'sync_excel.mapping.targets.addressName',
    fallback: 'Address label',
    mappingKind: 'core',
    matchTokens: ['address label', 'address name', 'label'],
  },
  {
    value: 'address.purpose',
    labelKey: 'sync_excel.mapping.targets.addressPurpose',
    fallback: 'Address purpose',
    mappingKind: 'core',
    matchTokens: ['address purpose', 'address type'],
  },
  {
    value: 'address.companyName',
    labelKey: 'sync_excel.mapping.targets.addressCompanyName',
    fallback: 'Address company',
    mappingKind: 'core',
    matchTokens: ['address company', 'address company name'],
  },
  {
    value: 'address.addressLine1',
    labelKey: 'sync_excel.mapping.targets.addressLine1',
    fallback: 'Address line 1',
    mappingKind: 'core',
    matchTokens: ['address line 1', 'street address', 'street', 'street 1'],
  },
  {
    value: 'address.addressLine2',
    labelKey: 'sync_excel.mapping.targets.addressLine2',
    fallback: 'Address line 2',
    mappingKind: 'core',
    matchTokens: ['address line 2', 'street 2'],
  },
  {
    value: 'address.buildingNumber',
    labelKey: 'sync_excel.mapping.targets.buildingNumber',
    fallback: 'Building number',
    mappingKind: 'core',
    matchTokens: ['building number', 'building no', 'house number'],
  },
  {
    value: 'address.flatNumber',
    labelKey: 'sync_excel.mapping.targets.flatNumber',
    fallback: 'Flat number',
    mappingKind: 'core',
    matchTokens: ['flat number', 'apartment number', 'unit number'],
  },
  {
    value: 'address.city',
    labelKey: 'sync_excel.mapping.targets.city',
    fallback: 'City',
    mappingKind: 'core',
    matchTokens: ['city', 'town'],
  },
  {
    value: 'address.region',
    labelKey: 'sync_excel.mapping.targets.region',
    fallback: 'Region / State',
    mappingKind: 'core',
    matchTokens: ['region', 'state', 'province'],
  },
  {
    value: 'address.postalCode',
    labelKey: 'sync_excel.mapping.targets.postalCode',
    fallback: 'Postal code',
    mappingKind: 'core',
    matchTokens: ['postal code', 'zip code', 'postcode'],
  },
  {
    value: 'address.country',
    labelKey: 'sync_excel.mapping.targets.country',
    fallback: 'Country',
    mappingKind: 'core',
    matchTokens: ['country'],
  },
  {
    value: 'address.latitude',
    labelKey: 'sync_excel.mapping.targets.latitude',
    fallback: 'Latitude',
    mappingKind: 'core',
    matchTokens: ['latitude', 'lat'],
  },
  {
    value: 'address.longitude',
    labelKey: 'sync_excel.mapping.targets.longitude',
    fallback: 'Longitude',
    mappingKind: 'core',
    matchTokens: ['longitude', 'lng', 'lon'],
  },
]

function normalizeMatchToken(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleizeKey(key: string): string {
  return key
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function scoreCustomFieldDefinition(def: CustomFieldDefDto, entityIndex: number): {
  base: number
  penalty: number
  entityIndex: number
} {
  const listVisibleScore = def.listVisible === false ? 0 : 1
  const formEditableScore = def.formEditable === false ? 0 : 1
  const filterableScore = def.filterable ? 1 : 0
  const kindScore = (() => {
    switch (def.kind) {
      case 'dictionary':
        return 8
      case 'relation':
        return 6
      case 'select':
        return 4
      case 'multiline':
        return 3
      case 'boolean':
      case 'integer':
      case 'float':
        return 2
      default:
        return 1
    }
  })()
  const optionsBonus = Array.isArray(def.options) && def.options.length > 0 ? 2 : 0
  const dictionaryBonus = typeof def.dictionaryId === 'string' && def.dictionaryId.trim().length > 0 ? 5 : 0
  return {
    base: (listVisibleScore * 16) + (formEditableScore * 8) + (filterableScore * 4) + kindScore + optionsBonus + dictionaryBonus,
    penalty: typeof def.priority === 'number' ? def.priority : 0,
    entityIndex,
  }
}

function buildCustomFieldOption(def: CustomFieldDefDto): MappingTargetOption {
  const fallback = typeof def.label === 'string' && def.label.trim().length > 0
    ? def.label.trim()
    : titleizeKey(def.key)
  const normalizedTokens = Array.from(new Set([
    normalizeMatchToken(def.key),
    normalizeMatchToken(fallback),
  ].filter((value) => value.length > 0)))

  return {
    value: `cf:${def.key}`,
    fallback,
    mappingKind: 'custom_field',
    matchTokens: normalizedTokens,
  }
}

function selectPreferredCustomFieldDefs(customFieldDefs: CustomFieldDefDto[]): CustomFieldDefDto[] {
  const entityOrder = new Map<string, number>()
  SYNC_EXCEL_PEOPLE_CUSTOM_FIELD_ENTITY_IDS.forEach((entityId, index) => entityOrder.set(entityId, index))
  const bestByKey = new Map<string, { def: CustomFieldDefDto; score: { base: number; penalty: number; entityIndex: number } }>()

  for (const def of customFieldDefs) {
    if (typeof def.key !== 'string' || def.key.trim().length === 0) continue
    const score = scoreCustomFieldDefinition(def, entityOrder.get(def.entityId ?? '') ?? Number.MAX_SAFE_INTEGER)
    const existing = bestByKey.get(def.key)
    const isBetter = !existing
      || score.base > existing.score.base
      || (
        score.base === existing.score.base
        && (score.penalty < existing.score.penalty
          || (score.penalty === existing.score.penalty && score.entityIndex < existing.score.entityIndex))
      )
    if (isBetter) {
      bestByKey.set(def.key, { def, score })
    }
  }

  return Array.from(bestByKey.values()).map((entry) => entry.def)
}

export function buildPeopleTargetOptions(customFieldDefs: CustomFieldDefDto[]): MappingTargetOption[] {
  const customOptions = selectPreferredCustomFieldDefs(customFieldDefs).map(buildCustomFieldOption)
  return [...CORE_TARGET_OPTIONS, ...ADDRESS_TARGET_OPTIONS, ...customOptions]
}

export function buildPeopleSuggestedMapping(
  headers: string[],
  suggestedMapping: SuggestedMapping,
  customFieldDefs: CustomFieldDefDto[],
): SuggestedMapping {
  const fields = [...suggestedMapping.fields]
  const usedExternalFields = new Set(fields.map((field) => field.externalField))
  const usedTargetFields = new Set(fields.map((field) => field.localField))
  const supplementalTargetOptions = buildPeopleTargetOptions(customFieldDefs).filter(
    (option) => option.mappingKind === 'custom_field' || option.value.startsWith('address.'),
  )

  for (const header of headers) {
    if (usedExternalFields.has(header)) continue
    const normalizedHeader = normalizeMatchToken(header)
    const matchedOption = supplementalTargetOptions.find((option) => {
      if (usedTargetFields.has(option.value)) return false
      return option.matchTokens.includes(normalizedHeader)
    })
    if (!matchedOption) continue

    fields.push({
      externalField: header,
      localField: matchedOption.value,
      mappingKind: matchedOption.mappingKind,
    })
    usedExternalFields.add(header)
    usedTargetFields.add(matchedOption.value)
  }

  return {
    ...suggestedMapping,
    fields,
    unmappedColumns: headers.filter((header) => !usedExternalFields.has(header)),
  }
}

export function buildSuggestedMappingSignature(headers: string[], suggestedMapping: SuggestedMapping): string {
  return JSON.stringify({
    headers,
    matchStrategy: suggestedMapping.matchStrategy,
    matchField: suggestedMapping.matchField ?? null,
    fields: suggestedMapping.fields.map((field) => ({
      externalField: field.externalField,
      localField: field.localField,
      mappingKind: field.mappingKind ?? null,
      dedupeRole: field.dedupeRole ?? null,
    })),
  })
}

export function findMappingTargetOption(
  targetOptions: MappingTargetOption[],
  targetField: string,
): MappingTargetOption | undefined {
  return targetOptions.find((option) => option.value === targetField)
}

export { normalizeMatchToken }
