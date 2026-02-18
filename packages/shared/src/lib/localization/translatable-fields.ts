type TranslatableFieldsRegistry = Record<string, string[]>

// Use globalThis to survive Turbopack/esbuild module duplication where the same
// file can be loaded as multiple module instances when mixing dynamic and static imports
const GLOBAL_KEY = '__openMercatoTranslatableFields__'

function getGlobal(): TranslatableFieldsRegistry {
  return (globalThis as any)[GLOBAL_KEY] ?? {}
}

function setGlobal(registry: TranslatableFieldsRegistry): void {
  (globalThis as any)[GLOBAL_KEY] = registry
}

export function registerTranslatableFields(fields: TranslatableFieldsRegistry): void {
  setGlobal({ ...getGlobal(), ...fields })
}

export function getTranslatableFields(entityType: string): string[] | undefined {
  return getGlobal()[entityType]
}

export function getTranslatableFieldsRegistry(): TranslatableFieldsRegistry {
  return { ...getGlobal() }
}
