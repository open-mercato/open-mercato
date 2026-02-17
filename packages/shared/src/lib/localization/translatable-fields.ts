type TranslatableFieldsRegistry = Record<string, string[]>

let _registry: TranslatableFieldsRegistry = {}

export function registerTranslatableFields(fields: TranslatableFieldsRegistry): void {
  _registry = { ..._registry, ...fields }
}

export function getTranslatableFields(entityType: string): string[] | undefined {
  return _registry[entityType]
}

export function getTranslatableFieldsRegistry(): TranslatableFieldsRegistry {
  return { ..._registry }
}
