import type { Dict } from './context'
import { createFallbackTranslator, createTranslator } from './translate'

type RawDict = Record<string, unknown>

function flattenIntoDict(source: RawDict, target: Dict, prefix = ''): void {
  for (const [key, value] of Object.entries(source)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      target[nextKey] = String(value)
      continue
    }
    if (Array.isArray(value)) continue
    if (typeof value === 'object') {
      flattenIntoDict(value as RawDict, target, nextKey)
    }
  }
}

export function buildTestDict(...sources: RawDict[]): Dict {
  const result: Dict = {}
  for (const source of sources) flattenIntoDict(source, result)
  return result
}

export function createTestTranslations(...sources: RawDict[]) {
  const dict = buildTestDict(...sources)
  const t = createTranslator(dict)
  const translate = createFallbackTranslator(dict)
  return { dict, t, translate }
}

