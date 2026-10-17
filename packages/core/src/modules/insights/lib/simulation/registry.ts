import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  SIMULATE_CONFIG_VERSION,
  SIMULATION_EVENT_ID_PATTERN,
  SIMULATION_EXECUTION_MODES,
  SIMULATION_KIND_PATTERN,
  type RegisteredSimulationEventAdapter,
  type SimulateModuleConfig,
  type SimulationEventAdapter,
  type SimulationKindDefinition,
} from '@open-mercato/shared/modules/insights/simulate'

const logger = createLogger('insights').child({ component: 'simulation-registry' })

export type SimulateConfigRegistrationEntry = {
  moduleId: string
  config: unknown
}

export type RegisteredSimulationKind = {
  moduleId: string
  definition: SimulationKindDefinition
}

type SimulationRegistryState = {
  kinds: Map<string, RegisteredSimulationKind>
  eventAdapters: Map<string, RegisteredSimulationEventAdapter>
}

const REGISTRY_KEY = Symbol.for('@open-mercato/core/insights/simulation-registry')

type GlobalWithSimulationRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: SimulationRegistryState
}

function createState(): SimulationRegistryState {
  return { kinds: new Map(), eventAdapters: new Map() }
}

function resolveState(): SimulationRegistryState {
  const scope = globalThis as GlobalWithSimulationRegistry
  if (!scope[REGISTRY_KEY]) scope[REGISTRY_KEY] = createState()
  return scope[REGISTRY_KEY]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function isZodLike(value: unknown): boolean {
  return isPlainObject(value) && typeof value.safeParse === 'function'
}

function isValidLiveRecords(value: unknown): boolean {
  if (value === undefined) return true
  if (!isPlainObject(value)) return false
  return isNonEmptyStringList(value.requiredFeatures) && typeof value.list === 'function'
}

/**
 * A kind is registered only when it declares everything the orchestrator relies on; above all a
 * non-empty `requiredFeatures` (S2: a kind without them is skipped — fail closed), and for live
 * records their own non-empty `requiredFeatures`.
 */
export function isValidSimulationKind(value: unknown): value is SimulationKindDefinition {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.kind) || !SIMULATION_KIND_PATTERN.test(value.kind)) return false
  if (!isNonEmptyString(value.artifactKind) || !isNonEmptyString(value.labelKey)) return false
  if (!isNonEmptyStringList(value.requiredFeatures)) return false
  if (!isNonEmptyStringList(value.cellKeys)) return false
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) return false
  if (value.ttlHours !== undefined && (typeof value.ttlHours !== 'number' || !(value.ttlHours > 0))) return false
  if (!isZodLike(value.inputSchema)) return false
  if (typeof value.readArtifactVersion !== 'function') return false
  if (typeof value.fingerprintProposal !== 'function') return false
  if (typeof value.run !== 'function') return false
  if (value.validate !== undefined && typeof value.validate !== 'function') return false
  if (value.inputFeatures !== undefined && typeof value.inputFeatures !== 'function') return false
  if (value.applyHref !== undefined && typeof value.applyHref !== 'function') return false
  if (value.execution !== undefined && !SIMULATION_EXECUTION_MODES.some((mode) => mode === value.execution)) return false
  if (value.accessLogResourceKind !== undefined && !isNonEmptyString(value.accessLogResourceKind)) return false
  return isValidLiveRecords(value.liveRecords)
}

/** Whether a kind is computed at request time (`execution: 'inline'`). */
export function isInlineSimulationKind(definition: Pick<SimulationKindDefinition, 'execution'>): boolean {
  return definition.execution === 'inline'
}

export function isValidSimulationEventAdapter(value: unknown): value is SimulationEventAdapter {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.eventId) || !SIMULATION_EVENT_ID_PATTERN.test(value.eventId)) return false
  if (!isNonEmptyStringList(value.logResourceKinds)) return false
  if (!isNonEmptyStringList(value.actionTypes)) return false
  if (!isNonEmptyStringList(value.requiredFeatures)) return false
  if (value.commandIds !== undefined && !isNonEmptyStringList(value.commandIds)) return false
  return typeof value.payloadFrom === 'function'
}

function readModuleConfig(moduleId: string, config: unknown): SimulateModuleConfig | null {
  if (config === null || config === undefined) return null
  if (!isPlainObject(config)) {
    logger.warn('Ignoring simulate config that is not an object', { moduleId })
    return null
  }
  if (config.version !== SIMULATE_CONFIG_VERSION) {
    logger.warn('Ignoring simulate config with an unsupported version', { moduleId, version: String(config.version) })
    return null
  }
  return config as SimulateModuleConfig
}

function registerKind(state: SimulationRegistryState, moduleId: string, kind: unknown): void {
  if (!isValidSimulationKind(kind)) {
    logger.warn('Ignoring invalid simulation kind declaration (fail closed)', {
      moduleId,
      kind: isPlainObject(kind) && typeof kind.kind === 'string' ? kind.kind : null,
    })
    return
  }
  const existing = state.kinds.get(kind.kind)
  if (existing) {
    if (existing.moduleId !== moduleId) {
      logger.warn('Ignoring duplicate simulation kind; the first registration is kept', {
        kind: kind.kind,
        moduleId,
        registeredBy: existing.moduleId,
      })
    }
    return
  }
  state.kinds.set(kind.kind, { moduleId, definition: kind })
}

function registerEventAdapter(state: SimulationRegistryState, moduleId: string, adapter: unknown): void {
  if (!isValidSimulationEventAdapter(adapter)) {
    logger.warn('Ignoring invalid simulation event adapter', {
      moduleId,
      eventId: isPlainObject(adapter) && typeof adapter.eventId === 'string' ? adapter.eventId : null,
    })
    return
  }
  const existing = state.eventAdapters.get(adapter.eventId)
  if (existing) {
    if (existing.moduleId !== moduleId || existing.payloadFrom !== adapter.payloadFrom) {
      logger.warn('Ignoring duplicate simulation event adapter; the first registration is kept', {
        eventId: adapter.eventId,
        moduleId,
        registeredBy: existing.moduleId,
      })
    }
    return
  }
  state.eventAdapters.set(adapter.eventId, { ...adapter, moduleId })
}

/** Registers the generated `simulateConfigEntries` (duplicates: first wins, logged). */
export function registerSimulateConfigEntries(entries: readonly SimulateConfigRegistrationEntry[]): void {
  const state = resolveState()
  for (const entry of entries ?? []) {
    if (!entry || !isNonEmptyString(entry.moduleId)) continue
    const config = readModuleConfig(entry.moduleId, entry.config)
    if (!config) continue
    for (const kind of Array.isArray(config.kinds) ? config.kinds : []) registerKind(state, entry.moduleId, kind)
    for (const adapter of Array.isArray(config.eventAdapters) ? config.eventAdapters : []) {
      registerEventAdapter(state, entry.moduleId, adapter)
    }
  }
}

export function getSimulationKind(kind: string): RegisteredSimulationKind | null {
  return resolveState().kinds.get(kind) ?? null
}

export function listSimulationKinds(): RegisteredSimulationKind[] {
  return Array.from(resolveState().kinds.values())
}

export function listSimulationEventAdapters(): RegisteredSimulationEventAdapter[] {
  return Array.from(resolveState().eventAdapters.values())
}

export function resetSimulationRegistryForTests(): void {
  const scope = globalThis as GlobalWithSimulationRegistry
  scope[REGISTRY_KEY] = createState()
}
