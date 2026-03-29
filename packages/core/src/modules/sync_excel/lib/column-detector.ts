import type { DataMapping, FieldMapping } from '../../data_sync/lib/adapter'

const PERSON_FIELD_ALIASES: Record<string, string[]> = {
  'person.externalId': ['record id', 'external id', 'lead id'],
  'person.firstName': ['first name', 'firstname', 'given name'],
  'person.lastName': ['last name', 'lastname', 'surname', 'family name'],
  'person.displayName': ['lead name', 'display name', 'full name', 'name'],
  'person.primaryEmail': ['email', 'primary email', 'email address'],
  'person.primaryPhone': ['mobile', 'phone', 'mobile phone', 'telephone'],
  'person.jobTitle': ['title', 'job title', 'position'],
  'person.status': ['lead status', 'status'],
  'person.source': ['lead source', 'source'],
  'person.description': ['description', 'notes', 'comment'],
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase()
}

function buildFieldMapping(externalField: string, localField: string): FieldMapping {
  if (localField === 'person.externalId') {
    return {
      externalField,
      localField,
      mappingKind: 'external_id',
      dedupeRole: 'primary',
    }
  }

  if (localField === 'person.primaryEmail') {
    return {
      externalField,
      localField,
      mappingKind: 'core',
      dedupeRole: 'secondary',
    }
  }

  return {
    externalField,
    localField,
    mappingKind: 'core',
  }
}

export function detectCustomersPersonMapping(columns: string[]): DataMapping & { unmappedColumns: string[] } {
  const fields: FieldMapping[] = []
  const unmappedColumns: string[] = []

  for (const column of columns) {
    const normalizedColumn = normalizeLabel(column)
    const matchingField = Object.entries(PERSON_FIELD_ALIASES).find(([, aliases]) => aliases.includes(normalizedColumn))

    if (!matchingField) {
      unmappedColumns.push(column)
      continue
    }

    fields.push(buildFieldMapping(column, matchingField[0]))
  }

  const hasExternalId = fields.some((field) => field.localField === 'person.externalId')
  const hasEmail = fields.some((field) => field.localField === 'person.primaryEmail')

  return {
    entityType: 'customers.person',
    matchStrategy: hasExternalId ? 'externalId' : hasEmail ? 'email' : 'custom',
    matchField: hasExternalId ? 'person.externalId' : hasEmail ? 'person.primaryEmail' : undefined,
    fields,
    unmappedColumns,
  }
}
