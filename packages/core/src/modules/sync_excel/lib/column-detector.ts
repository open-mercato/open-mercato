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
  'address.name': ['address label', 'address name', 'label'],
  'address.purpose': ['address purpose', 'address type'],
  'address.companyName': ['address company', 'address company name'],
  'address.addressLine1': ['address line 1', 'street address', 'street', 'street 1'],
  'address.addressLine2': ['address line 2', 'street 2'],
  'address.buildingNumber': ['building number', 'building no', 'house number'],
  'address.flatNumber': ['flat number', 'apartment number', 'unit number'],
  'address.city': ['city', 'town'],
  'address.region': ['region', 'state', 'province'],
  'address.postalCode': ['postal code', 'zip code', 'postcode'],
  'address.country': ['country'],
  'address.latitude': ['latitude', 'lat'],
  'address.longitude': ['longitude', 'lng', 'lon'],
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
