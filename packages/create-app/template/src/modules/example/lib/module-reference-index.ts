export type ModuleReferenceIndexEntry = {
  moduleId: string
  references: readonly {
    capabilityId: string
    inventoryPath: string
    surfaceMapPath: string
    sourcePaths: readonly string[]
  }[]
}

type ModuleReferenceIndexState = {
  entries: Map<string, ModuleReferenceIndexEntry>
}

const stateKey = '__openMercatoModuleReferenceIndexState'

function state(): ModuleReferenceIndexState {
  const root = globalThis as typeof globalThis & {
    [stateKey]?: ModuleReferenceIndexState
  }
  if (!root[stateKey]) root[stateKey] = { entries: new Map() }
  return root[stateKey]
}

function assertPortableReferencePath(moduleId: string, value: string): void {
  const prefix = `src/modules/${moduleId}/`
  if (!value.startsWith(prefix) || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`[internal] Module reference path must stay under ${prefix}: ${value}`)
  }
}

export function validateModuleReferenceIndexEntries(entries: readonly ModuleReferenceIndexEntry[]): void {
  const moduleIds = new Set<string>()
  for (const entry of entries) {
    if (moduleIds.has(entry.moduleId)) {
      throw new Error(`[internal] Duplicate module reference index entry: ${entry.moduleId}`)
    }
    moduleIds.add(entry.moduleId)

    const capabilityIds = new Set<string>()
    for (const reference of entry.references) {
      if (capabilityIds.has(reference.capabilityId)) {
        throw new Error(
          `[internal] Duplicate module reference capability for ${entry.moduleId}: ${reference.capabilityId}`,
        )
      }
      capabilityIds.add(reference.capabilityId)
      assertPortableReferencePath(entry.moduleId, reference.inventoryPath)
      assertPortableReferencePath(entry.moduleId, reference.surfaceMapPath)
      for (const sourcePath of reference.sourcePaths) {
        assertPortableReferencePath(entry.moduleId, sourcePath)
      }
    }
  }
}

export function registerModuleReferenceIndexEntries(entries: readonly ModuleReferenceIndexEntry[]): void {
  validateModuleReferenceIndexEntries(entries)
  state().entries = new Map(entries.map((entry) => [entry.moduleId, entry]))
}

export function getModuleReferenceIndexEntry(moduleId: string): ModuleReferenceIndexEntry | null {
  return state().entries.get(moduleId) ?? null
}
