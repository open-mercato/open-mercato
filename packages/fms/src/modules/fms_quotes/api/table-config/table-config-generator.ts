// Utility to generate table column configs from MikroORM entity metadata
import { EntityMetadata } from '@mikro-orm/core'

export type TableColumnType = 'text' | 'numeric' | 'date' | 'dropdown' | 'checkbox'

export interface TableColumnConfig {
  data: string
  title: string
  width: number
  type?: TableColumnType
  dateFormat?: string
  readOnly?: boolean
  source?: string[]
  renderer?: string
}

export interface DisplayHints {
  hiddenFields?: string[]
  readOnlyFields?: string[]
  customRenderers?: Record<string, string>
  dropdownSources?: Record<string, string[]>
  additionalColumns?: TableColumnConfig[]
}

function mapPropertyTypeToColumnType(property: any): TableColumnType {
  const typeName = property.type?.toLowerCase() || ''

  if (typeName.includes('varchar') || typeName.includes('text') || typeName.includes('string')) {
    return 'text'
  }

  if (typeName.includes('int') || typeName.includes('numeric') || typeName.includes('decimal') || typeName.includes('float')) {
    return 'numeric'
  }

  if (typeName.includes('timestamp') || typeName.includes('date')) {
    return 'date'
  }

  if (typeName.includes('bool')) {
    return 'checkbox'
  }

  if (property.enum) {
    return 'dropdown'
  }

  return 'text'
}

function getDefaultWidth(columnType: TableColumnType): number {
  switch (columnType) {
    case 'date':
      return 120
    case 'numeric':
      return 100
    case 'checkbox':
      return 80
    case 'dropdown':
      return 130
    default:
      return 150
  }
}

function snakeCaseToTitle(str: string): string {
  return str
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function fieldNameToTitle(fieldName: string): string {
  if (fieldName.includes('_')) {
    return snakeCaseToTitle(fieldName)
  }
  const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase()
  return snakeCaseToTitle(snakeCase)
}

export function generateTableConfig(
  entityMetadata: EntityMetadata,
  hints: DisplayHints = {}
): TableColumnConfig[] {
  const columns: TableColumnConfig[] = []
  const properties = entityMetadata.properties

  const hiddenFields = new Set([
    'id',
    'tenantId',
    'organizationId',
    'tenant_id',
    'organization_id',
    'deletedAt',
    'deleted_at',
    ...(hints.hiddenFields || []),
  ])

  for (const [fieldName, property] of Object.entries(properties)) {
    if (hiddenFields.has(fieldName)) {
      continue
    }

    if ((property as any).primary) {
      continue
    }

    if ((property as any).reference) {
      continue
    }

    let columnType = mapPropertyTypeToColumnType(property)

    // Check if there's a dropdown source override
    const dataAccessor = fieldName.includes('_')
      ? fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      : fieldName

    if (hints.dropdownSources?.[fieldName] || hints.dropdownSources?.[dataAccessor]) {
      columnType = 'dropdown'
    }

    const label = fieldNameToTitle(fieldName)
    const width = getDefaultWidth(columnType)

    const column: TableColumnConfig = {
      data: dataAccessor,
      title: label,
      width,
      type: columnType !== 'text' ? columnType : undefined,
    }

    if (columnType === 'date') {
      column.dateFormat = 'dd/MM/yyyy'
    }

    // Add enum source for dropdowns
    if (columnType === 'dropdown') {
      if (hints.dropdownSources?.[fieldName]) {
        column.source = hints.dropdownSources[fieldName]
      } else if (hints.dropdownSources?.[dataAccessor]) {
        column.source = hints.dropdownSources[dataAccessor]
      } else if ((property as any).enum) {
        const enumValues = Object.values((property as any).items?.() || {})
        column.source = enumValues as string[]
      }
    }

    if (hints.readOnlyFields?.includes(fieldName) || hints.readOnlyFields?.includes(dataAccessor)) {
      column.readOnly = true
    }

    if (hints.customRenderers?.[fieldName] || hints.customRenderers?.[dataAccessor]) {
      column.renderer = hints.customRenderers[fieldName] || hints.customRenderers[dataAccessor]
    }

    columns.push(column)
  }

  // Add any additional columns (e.g., for relations)
  if (hints.additionalColumns) {
    columns.push(...hints.additionalColumns)
  }

  return columns
}
