import type { Module } from '@open-mercato/shared/modules/registry'

const MODULES_GLOBAL_KEY = '__openMercatoModules__'
const MODULE_SUBSCRIBERS_GLOBAL_KEY = '__openMercatoModuleSubscribers__'

// Registration pattern for publishable packages
let _modules: Module[] | null = null
let _moduleSubscribers: NonNullable<Module['subscribers']> | null = null

function readGlobalValue<T>(key: string): T | null {
  try {
    const value = (globalThis as Record<string, unknown>)[key]
    return value === undefined ? null : (value as T)
  } catch {
    return null
  }
}

function writeGlobalValue<T>(key: string, value: T) {
  try {
    ;(globalThis as Record<string, unknown>)[key] = value
  } catch {
    // ignore global assignment failures
  }
}

function getRegisteredModules(): Module[] | null {
  const globalModules = readGlobalValue<Module[]>(MODULES_GLOBAL_KEY)
  if (globalModules) return globalModules
  return _modules
}

function getRegisteredModuleSubscribers(): NonNullable<Module['subscribers']> | null {
  const globalSubscribers = readGlobalValue<NonNullable<Module['subscribers']>>(
    MODULE_SUBSCRIBERS_GLOBAL_KEY
  )
  if (globalSubscribers) return globalSubscribers
  return _moduleSubscribers
}

function buildModuleSubscribersSignature(subscribers: NonNullable<Module['subscribers']>): string {
  return subscribers
    .map((subscriber) =>
      JSON.stringify({
        id: subscriber.id,
        event: subscriber.event,
        persistent: subscriber.persistent === true,
        sync: subscriber.sync === true,
        priority: subscriber.priority ?? null,
      })
    )
    .join('|')
}

export function registerModules(modules: Module[]) {
  const previousModules = getRegisteredModules()

  if (previousModules !== null && previousModules !== modules && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Modules re-registered (this may occur during HMR)')
  }
  _modules = modules
  writeGlobalValue(MODULES_GLOBAL_KEY, modules)
}

export function registerModuleSubscribers(subscribers: NonNullable<Module['subscribers']>) {
  const previousSubscribers = getRegisteredModuleSubscribers()

  if (previousSubscribers) {
    const previousSignature = buildModuleSubscribersSignature(previousSubscribers)
    const nextSignature = buildModuleSubscribersSignature(subscribers)

    if (previousSignature === nextSignature) {
      _moduleSubscribers = subscribers
      writeGlobalValue(MODULE_SUBSCRIBERS_GLOBAL_KEY, subscribers)
      return
    }
  }

  if (previousSubscribers !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] Module subscribers re-registered (this may occur during HMR)')
  }
  _moduleSubscribers = subscribers
  writeGlobalValue(MODULE_SUBSCRIBERS_GLOBAL_KEY, subscribers)
}

export function getModules(): Module[] {
  const modules = getRegisteredModules()
  if (!modules) {
    throw new Error('[Bootstrap] Modules not registered. Call registerModules() at bootstrap.')
  }
  return modules
}

export function getModuleSubscribers(): NonNullable<Module['subscribers']> {
  return getRegisteredModuleSubscribers() ?? []
}
