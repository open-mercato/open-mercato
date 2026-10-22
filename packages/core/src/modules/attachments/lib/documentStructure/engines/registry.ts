import type { DocumentStructureEngine } from '../types'
import { textStructureEngine } from './text'

export type RegisterDocumentStructureEngineOptions = {
  prepend?: boolean
}

export type DocumentStructureEngineRegistry = {
  list(): DocumentStructureEngine[]
  register(engine: DocumentStructureEngine, options?: RegisterDocumentStructureEngineOptions): void
  unregister(engineId: string): boolean
  resolve(mimeType: string, extension?: string | null): DocumentStructureEngine | null
}

export function defaultDocumentStructureEngines(): DocumentStructureEngine[] {
  return [textStructureEngine]
}

export function resolveEngine(
  engines: readonly DocumentStructureEngine[],
  mimeType: string,
  extension?: string | null,
): DocumentStructureEngine | null {
  return engines.find((engine) => engine.supports(mimeType, extension)) ?? null
}

export function createDocumentStructureEngineRegistry(
  initialEngines: readonly DocumentStructureEngine[] = defaultDocumentStructureEngines(),
): DocumentStructureEngineRegistry {
  const engines: DocumentStructureEngine[] = []

  const register = (engine: DocumentStructureEngine, options: RegisterDocumentStructureEngineOptions = {}) => {
    const existingIndex = engines.findIndex((candidate) => candidate.id === engine.id)
    if (existingIndex >= 0) {
      engines[existingIndex] = engine
      return
    }
    if (options.prepend) engines.unshift(engine)
    else engines.push(engine)
  }

  for (const engine of initialEngines) register(engine)

  return {
    list: () => [...engines],
    register,
    unregister(engineId: string): boolean {
      const existingIndex = engines.findIndex((candidate) => candidate.id === engineId)
      if (existingIndex < 0) return false
      engines.splice(existingIndex, 1)
      return true
    },
    resolve: (mimeType, extension) => resolveEngine(engines, mimeType, extension),
  }
}
