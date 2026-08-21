import type { PrivacyDataClassDefinition, PrivacyDataClassRegistry } from './contracts'

const GLOBAL_KEY = '__openMercatoPrivacyDataClasses__'
const DATA_CLASS_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/
const SERVICE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

type PrivacyGlobalScope = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, PrivacyDataClassDefinition>
}

function store(): Map<string, PrivacyDataClassDefinition> {
  const globalScope = globalThis as PrivacyGlobalScope
  globalScope[GLOBAL_KEY] ??= new Map<string, PrivacyDataClassDefinition>()
  return globalScope[GLOBAL_KEY]
}

function validateDefinition(definition: PrivacyDataClassDefinition): void {
  if (!DATA_CLASS_ID_PATTERN.test(definition.id)) {
    throw new Error(`[internal] Invalid privacy data class id: ${definition.id}`)
  }
  if (!definition.module.trim()) {
    throw new Error('[internal] Privacy data class module is required')
  }
  if (!definition.title.trim()) {
    throw new Error('[internal] Privacy data class title is required')
  }
  if (!SERVICE_KEY_PATTERN.test(definition.handlerService)) {
    throw new Error(`[internal] Invalid privacy handler service key: ${definition.handlerService}`)
  }
  if (definition.retention) {
    if (!Number.isInteger(definition.retention.defaultDays) || definition.retention.defaultDays < 1) {
      throw new Error('[internal] Privacy retention defaultDays must be a positive integer')
    }
    if (definition.retention.actions.length === 0) {
      throw new Error('[internal] Privacy retention must declare at least one action')
    }
  }
  if (definition.environmentSanitization?.categories.length === 0) {
    throw new Error('[internal] Environment sanitization must declare at least one category')
  }
}

export function registerPrivacyDataClass(definition: PrivacyDataClassDefinition): void {
  validateDefinition(definition)
  store().set(definition.id, {
    ...definition,
    subjectKinds: [...new Set(definition.subjectKinds)],
    subjectActions: [...new Set(definition.subjectActions)],
    ...(definition.retention
      ? { retention: { ...definition.retention, actions: [...new Set(definition.retention.actions)] } }
      : {}),
    ...(definition.environmentSanitization
      ? {
          environmentSanitization: {
            categories: [...new Set(definition.environmentSanitization.categories)],
          },
        }
      : {}),
  })
}

export function getPrivacyDataClass(id: string): PrivacyDataClassDefinition | null {
  return store().get(id) ?? null
}

export function listPrivacyDataClasses(): PrivacyDataClassDefinition[] {
  return Array.from(store().values()).sort((left, right) => left.id.localeCompare(right.id))
}

export function clearPrivacyDataClasses(): void {
  store().clear()
}

export const privacyDataClassRegistry: PrivacyDataClassRegistry = {
  register: registerPrivacyDataClass,
  get: getPrivacyDataClass,
  list: listPrivacyDataClasses,
  clear: clearPrivacyDataClasses,
}
