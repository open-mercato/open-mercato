import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { getTranslatableFieldsRegistry } from '@open-mercato/shared/lib/localization/translatable-fields'

const WIDGET_ID = 'translations.injection.translation-manager'

function addEntitySpots(table: ModuleInjectionTable, entityType: string): void {
  const [module, entitySlug] = entityType.split(':')
  if (!module || !entitySlug) return

  const fullSpot = `crud-form:${module}.${entitySlug}:header`
  table[fullSpot] = WIDGET_ID

  const prefix = `${module}_`
  if (!entitySlug.startsWith(prefix)) return

  const shortSpot = `crud-form:${module}.${entitySlug.slice(prefix.length)}:header`
  if (shortSpot !== fullSpot) {
    table[shortSpot] = WIDGET_ID
  }
}

export function buildInjectionTable(allFields: Record<string, string[]> = getTranslatableFieldsRegistry()): ModuleInjectionTable {
  const table: ModuleInjectionTable = {}
  for (const entityType of Object.keys(allFields)) {
    addEntitySpots(table, entityType)
  }
  return table
}

export const injectionTable: ModuleInjectionTable = buildInjectionTable()
export default injectionTable
