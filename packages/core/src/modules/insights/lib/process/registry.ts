import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { onModulesRegistered, tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import {
  PROCESS_ACTIVITY_VALUE_PATTERN,
  PROCESS_ACTOR_DIMENSION_KINDS,
  PROCESS_CONFIG_VERSION,
  PROCESS_DECLARATION_KEY_PATTERN,
  PROCESS_ENTITY_ID_PATTERN,
  PROCESS_FIELD_VALUE_KINDS,
  PROCESS_KEY_PATTERN,
  PROCESS_LIFECYCLE_ACTIVITIES,
  type ProcessActorDimensionKind,
  type ProcessActorDimensionProvider,
  type ProcessEndStateDescriptor,
  type ProcessExitDescriptor,
  type ProcessFieldDescriptor,
  type ProcessLifecycleActivity,
} from '@open-mercato/shared/modules/insights/process'

const logger = createLogger('insights').child({ component: 'process-registry' })

/**
 * Version of the derivation rules in `lib/process/activities.ts`. Part of the contract hash,
 * so a change to how activities are derived marks every organization `rebuild_required`.
 */
export const PROCESS_DERIVATION_VERSION = 1

export type ProcessConfigRegistrationEntry = {
  moduleId: string
  config: unknown
}

export type RegisteredProcessField = {
  key: string
  labelKey: string
  valueKind: ProcessFieldDescriptor['valueKind']
  snapshotPaths: string[]
  changeKeys: string[]
}

export type RegisteredProcessMilestone = {
  key: string
  labelKey: string
  resourceKind: string
  logResourceKinds: string[]
  parentResourceKinds: string[]
  entityId: string
  lifecycle: ProcessLifecycleActivity[]
  fields: RegisteredProcessField[]
}

export type RegisteredProcess = {
  moduleId: string
  processKey: string
  labelKey: string
  resourceKind: string
  logResourceKinds: string[]
  entityId: string
  requiredFeatures: string[]
  stageFields: RegisteredProcessField[]
  followupFields: RegisteredProcessField[]
  milestones: RegisteredProcessMilestone[]
  exits: ProcessExitDescriptor[]
  endStates: ProcessEndStateDescriptor[]
}

export type RegisteredActorDimensionProvider = {
  moduleId: string
  provider: ProcessActorDimensionProvider
}

export type ProcessRegistryRejection = {
  moduleId: string
  processKey: string | null
  reason: string
}

export type ProcessRegistrySnapshot = {
  ready: boolean
  processes: RegisteredProcess[]
  actorDimensions: Map<ProcessActorDimensionKind, RegisteredActorDimensionProvider>
  rejected: ProcessRegistryRejection[]
  contractHash: string
  logResourceKinds: string[]
}

export type ModuleEncryptionSource = {
  moduleId: string
  maps: readonly ModuleEncryptionMap[]
}

type ProcessRegistryState = {
  entries: ProcessConfigRegistrationEntry[]
  snapshot: ProcessRegistrySnapshot | null
  listening: boolean
}

const REGISTRY_KEY = Symbol.for('@open-mercato/core/insights/process-registry')

type GlobalWithProcessRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: ProcessRegistryState
}

function resolveState(): ProcessRegistryState {
  const scope = globalThis as GlobalWithProcessRegistry
  if (!scope[REGISTRY_KEY]) scope[REGISTRY_KEY] = { entries: [], snapshot: null, listening: false }
  return scope[REGISTRY_KEY]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function readStringList(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) return null
  return Array.from(new Set(value.map((entry) => entry.trim())))
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

function pathSegments(path: string): string[] {
  return path.split('.').filter((segment) => segment.length > 0)
}

/**
 * Column names a declared field may read through (the key and every segment of every
 * snapshot path and change key, raw and snake_case): a path that walks into an encrypted
 * column, e.g. `order.customerSnapshot.kind`, is caught at its `customer_snapshot` segment.
 */
export function fieldNameCandidates(field: RegisteredProcessField): string[] {
  const names = new Set<string>()
  for (const raw of [field.key, ...field.snapshotPaths.flatMap(pathSegments), ...field.changeKeys.flatMap(pathSegments)]) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    names.add(trimmed.toLowerCase())
    names.add(toSnakeCase(trimmed))
  }
  return Array.from(names)
}

type EncryptionIndex = {
  byEntity: Map<string, Set<string>>
  byModule: Map<string, Set<string>>
}

function buildEncryptionIndex(sources: readonly ModuleEncryptionSource[]): EncryptionIndex {
  const byEntity = new Map<string, Set<string>>()
  const byModule = new Map<string, Set<string>>()
  for (const source of sources) {
    const moduleFields = byModule.get(source.moduleId) ?? new Set<string>()
    for (const map of source.maps) {
      if (!map || !isNonEmptyString(map.entityId) || !Array.isArray(map.fields)) continue
      const entityFields = byEntity.get(map.entityId) ?? new Set<string>()
      for (const rule of map.fields) {
        if (!rule || !isNonEmptyString(rule.field)) continue
        const name = rule.field.trim().toLowerCase()
        entityFields.add(name)
        moduleFields.add(name)
      }
      byEntity.set(map.entityId, entityFields)
    }
    byModule.set(source.moduleId, moduleFields)
  }
  return { byEntity, byModule }
}

function entityModuleId(entityId: string): string {
  return entityId.slice(0, entityId.indexOf(':'))
}

function findEncryptedField(
  field: RegisteredProcessField,
  entityId: string,
  moduleId: string,
  index: EncryptionIndex,
): string | null {
  const encrypted = new Set<string>([
    ...Array.from(index.byEntity.get(entityId) ?? []),
    ...Array.from(index.byModule.get(moduleId) ?? []),
    ...Array.from(index.byModule.get(entityModuleId(entityId)) ?? []),
  ])
  if (encrypted.size === 0) return null
  for (const candidate of fieldNameCandidates(field)) {
    if (encrypted.has(candidate)) return candidate
  }
  return null
}

function readField(value: unknown): RegisteredProcessField | null {
  if (!isPlainObject(value)) return null
  if (!isNonEmptyString(value.key) || !PROCESS_DECLARATION_KEY_PATTERN.test(value.key)) return null
  if (!isNonEmptyString(value.labelKey)) return null
  if (typeof value.valueKind !== 'string' || !(PROCESS_FIELD_VALUE_KINDS as readonly string[]).includes(value.valueKind)) return null
  const snapshotPaths = readStringList(value.snapshotPaths)
  if (!snapshotPaths || snapshotPaths.length === 0) return null
  const changeKeys = readStringList(value.changeKeys)
  if (!changeKeys) return null
  return {
    key: value.key,
    labelKey: value.labelKey,
    valueKind: value.valueKind as ProcessFieldDescriptor['valueKind'],
    snapshotPaths,
    changeKeys,
  }
}

function readFieldList(value: unknown): RegisteredProcessField[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const fields: RegisteredProcessField[] = []
  for (const candidate of value) {
    const field = readField(candidate)
    if (!field) return null
    fields.push(field)
  }
  return fields
}

function readLifecycle(value: unknown): ProcessLifecycleActivity[] | null {
  if (value === undefined) return ['created']
  if (!Array.isArray(value)) return null
  const allowed = PROCESS_LIFECYCLE_ACTIVITIES as readonly string[]
  if (!value.every((entry) => typeof entry === 'string' && allowed.includes(entry))) return null
  return Array.from(new Set(value as ProcessLifecycleActivity[]))
}

function readMilestone(value: unknown, rootLogKinds: readonly string[]): RegisteredProcessMilestone | string {
  if (!isPlainObject(value)) return 'milestone is not an object'
  if (!isNonEmptyString(value.key) || !PROCESS_DECLARATION_KEY_PATTERN.test(value.key)) return 'milestone key is invalid'
  if (!isNonEmptyString(value.labelKey)) return `milestone ${value.key} has no labelKey`
  if (!isNonEmptyString(value.resourceKind)) return `milestone ${value.key} has no resourceKind`
  const parentResourceKinds = readStringList(value.parentResourceKinds)
  if (!parentResourceKinds || parentResourceKinds.length === 0) return `milestone ${value.key} declares no parentResourceKinds`
  if (!parentResourceKinds.every((kind) => rootLogKinds.includes(kind))) {
    return `milestone ${value.key} names a parent resource kind that is not the case root`
  }
  const logResourceKinds = readStringList(value.logResourceKinds)
  if (!logResourceKinds) return `milestone ${value.key} has invalid logResourceKinds`
  if (typeof value.entityId !== 'string' || !PROCESS_ENTITY_ID_PATTERN.test(value.entityId)) return `milestone ${value.key} needs an entityId like <module>:<entity>`
  const lifecycle = readLifecycle(value.lifecycle)
  if (!lifecycle) return `milestone ${value.key} has an invalid lifecycle`
  const fields = readFieldList(value.fields)
  if (!fields) return `milestone ${value.key} has an invalid field`
  if (fields.some((field) => field.valueKind === 'user')) return `milestone ${value.key} cannot hold user ids`
  if (new Set(fields.map((field) => field.key)).size !== fields.length) return `milestone ${value.key} declares a field twice`
  if (fields.length === 0 && lifecycle.length === 0) return `milestone ${value.key} produces no activity`
  return {
    key: value.key,
    labelKey: value.labelKey,
    resourceKind: value.resourceKind,
    logResourceKinds: logResourceKinds.length > 0 ? logResourceKinds : [value.resourceKind],
    parentResourceKinds,
    entityId: value.entityId,
    lifecycle,
    fields,
  }
}

const RESERVED_LIFECYCLE_KEYS: ReadonlySet<string> = new Set(PROCESS_LIFECYCLE_ACTIVITIES)

function readExits(value: unknown): ProcessExitDescriptor[] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'exits must be a list'
  const exits: ProcessExitDescriptor[] = []
  for (const candidate of value) {
    if (!isPlainObject(candidate)) return 'exit is not an object'
    if (!isNonEmptyString(candidate.key) || !PROCESS_DECLARATION_KEY_PATTERN.test(candidate.key) || RESERVED_LIFECYCLE_KEYS.has(candidate.key)) {
      return 'exit key is invalid'
    }
    if (!isNonEmptyString(candidate.labelKey)) return `exit ${candidate.key} has no labelKey`
    const commandIds = readStringList(candidate.commandIds)
    if (!commandIds || commandIds.length === 0) return `exit ${candidate.key} declares no commandIds`
    const logResourceKinds = readStringList(candidate.logResourceKinds)
    if (!logResourceKinds || logResourceKinds.length === 0) return `exit ${candidate.key} declares no logResourceKinds`
    const caseIdPaths = readStringList(candidate.caseIdPaths)
    if (!caseIdPaths || caseIdPaths.length === 0) return `exit ${candidate.key} declares no caseIdPaths`
    exits.push({ key: candidate.key, labelKey: candidate.labelKey, commandIds, logResourceKinds, caseIdPaths })
  }
  if (new Set(exits.map((exit) => exit.key)).size !== exits.length) return 'an exit key is declared twice'
  return exits
}

function readEndStates(value: unknown, stageKeys: ReadonlySet<string>): ProcessEndStateDescriptor[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const endStates: ProcessEndStateDescriptor[] = []
  for (const candidate of value) {
    if (!isPlainObject(candidate) || !isNonEmptyString(candidate.field) || !stageKeys.has(candidate.field)) return null
    const values = readStringList(candidate.values)
    if (!values || values.length === 0 || !values.every((entry) => PROCESS_ACTIVITY_VALUE_PATTERN.test(entry))) return null
    endStates.push({ field: candidate.field, values })
  }
  return endStates
}

function readProcess(
  moduleId: string,
  value: unknown,
  index: EncryptionIndex,
): RegisteredProcess | ProcessRegistryRejection {
  const processKey = isPlainObject(value) && typeof value.processKey === 'string' ? value.processKey : null
  const reject = (reason: string): ProcessRegistryRejection => ({ moduleId, processKey, reason })
  if (!isPlainObject(value)) return reject('declaration is not an object')
  if (!processKey || !PROCESS_KEY_PATTERN.test(processKey)) return reject('processKey must look like <module>.<process>')
  if (!isNonEmptyString(value.labelKey)) return reject('labelKey is required')
  if (!isNonEmptyString(value.resourceKind)) return reject('resourceKind is required')
  if (typeof value.entityId !== 'string' || !PROCESS_ENTITY_ID_PATTERN.test(value.entityId)) return reject('entityId must look like <module>:<entity>')
  const requiredFeatures = readStringList(value.requiredFeatures)
  if (!requiredFeatures || requiredFeatures.length === 0) return reject('requiredFeatures must be a non-empty list')
  const logResourceKinds = readStringList(value.logResourceKinds)
  if (!logResourceKinds) return reject('logResourceKinds is invalid')
  const rootLogKinds = logResourceKinds.length > 0 ? logResourceKinds : [value.resourceKind]
  const stageFields = readFieldList(value.stageFields)
  if (!stageFields) return reject('stageFields contains an invalid field')
  const followupFields = readFieldList(value.followupFields)
  if (!followupFields) return reject('followupFields contains an invalid field')
  if (stageFields.some((field) => field.valueKind === 'user')) return reject('a stage field cannot hold user ids (use followupFields)')
  const fieldKeys = [...stageFields, ...followupFields].map((field) => field.key)
  if (new Set(fieldKeys).size !== fieldKeys.length) return reject('a field key is declared twice')
  const milestones: RegisteredProcessMilestone[] = []
  if (value.milestones !== undefined && !Array.isArray(value.milestones)) return reject('milestones must be a list')
  for (const candidate of Array.isArray(value.milestones) ? value.milestones : []) {
    const milestone = readMilestone(candidate, rootLogKinds)
    if (typeof milestone === 'string') return reject(milestone)
    milestones.push(milestone)
  }
  if (new Set(milestones.map((milestone) => milestone.key)).size !== milestones.length) return reject('a milestone key is declared twice')
  if (stageFields.length === 0 && milestones.length === 0) return reject('a process needs at least one stage field or milestone')
  const exits = readExits(value.exits)
  if (typeof exits === 'string') return reject(exits)
  if (exits.some((exit) => milestones.some((milestone) => milestone.key === exit.key))) return reject('an exit key collides with a milestone key')
  const endStates = readEndStates(value.endStates, new Set(stageFields.map((field) => field.key)))
  if (!endStates) return reject('endStates must name declared stage fields and identifier values')
  for (const field of [...stageFields, ...followupFields]) {
    const encrypted = findEncryptedField(field, value.entityId, moduleId, index)
    if (encrypted) return reject(`field ${field.key} references the encrypted field ${encrypted}`)
  }
  for (const milestone of milestones) {
    for (const field of milestone.fields) {
      const encrypted = findEncryptedField(field, milestone.entityId, moduleId, index)
      if (encrypted) return reject(`milestone field ${milestone.key}.${field.key} references the encrypted field ${encrypted}`)
    }
  }
  return {
    moduleId,
    processKey,
    labelKey: value.labelKey,
    resourceKind: value.resourceKind,
    logResourceKinds: rootLogKinds,
    entityId: value.entityId,
    requiredFeatures,
    stageFields,
    followupFields,
    milestones,
    exits,
    endStates,
  }
}

function isValidActorDimensionProvider(value: unknown): value is ProcessActorDimensionProvider {
  return isPlainObject(value)
    && typeof value.kind === 'string'
    && (PROCESS_ACTOR_DIMENSION_KINDS as readonly string[]).includes(value.kind)
    && typeof value.resolve === 'function'
}

function canonicalField(field: RegisteredProcessField) {
  return { key: field.key, valueKind: field.valueKind, snapshotPaths: field.snapshotPaths, changeKeys: field.changeKeys }
}

/**
 * Hash of everything that changes the projected rows: the derivation version and, per
 * process, its resource kinds, fields, milestones and end states. Labels and features do
 * not affect projected rows and are excluded.
 */
export function computeProcessContractHash(processes: readonly RegisteredProcess[]): string {
  const canonical = {
    derivation: PROCESS_DERIVATION_VERSION,
    processes: [...processes]
      .sort((left, right) => left.processKey.localeCompare(right.processKey))
      .map((process) => ({
        processKey: process.processKey,
        resourceKind: process.resourceKind,
        logResourceKinds: process.logResourceKinds,
        entityId: process.entityId,
        stageFields: process.stageFields.map(canonicalField),
        followupFields: process.followupFields.map(canonicalField),
        milestones: process.milestones.map((milestone) => ({
          key: milestone.key,
          resourceKind: milestone.resourceKind,
          logResourceKinds: milestone.logResourceKinds,
          parentResourceKinds: milestone.parentResourceKinds,
          lifecycle: milestone.lifecycle,
          fields: milestone.fields.map(canonicalField),
        })),
        exits: process.exits.map((exit) => ({
          key: exit.key,
          commandIds: exit.commandIds,
          logResourceKinds: exit.logResourceKinds,
          caseIdPaths: exit.caseIdPaths,
        })),
        endStates: process.endStates,
      })),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function collectLogResourceKinds(processes: readonly RegisteredProcess[]): string[] {
  const kinds = new Set<string>()
  for (const process of processes) {
    for (const kind of process.logResourceKinds) kinds.add(kind)
    for (const milestone of process.milestones) {
      for (const kind of milestone.logResourceKinds) kinds.add(kind)
    }
    for (const exit of process.exits) {
      for (const kind of exit.logResourceKinds) kinds.add(kind)
    }
  }
  return Array.from(kinds).sort((left, right) => left.localeCompare(right))
}

/**
 * Validates registered declarations against the owning modules' encryption maps. A
 * declaration whose field resolves to an encrypted column of the declared entity, or to
 * any encrypted field of the declaring module, is rejected as a whole, as is any invalid
 * shape. Duplicate process keys and actor dimension kinds keep the first registration.
 */
export function buildProcessRegistrySnapshot(
  entries: readonly ProcessConfigRegistrationEntry[],
  encryptionSources: readonly ModuleEncryptionSource[],
): ProcessRegistrySnapshot {
  const index = buildEncryptionIndex(encryptionSources)
  const processes = new Map<string, RegisteredProcess>()
  const actorDimensions = new Map<ProcessActorDimensionKind, RegisteredActorDimensionProvider>()
  const rejected: ProcessRegistryRejection[] = []
  for (const entry of entries) {
    if (!entry || !isNonEmptyString(entry.moduleId)) continue
    const config = entry.config
    if (config === null || config === undefined) continue
    if (!isPlainObject(config) || config.version !== PROCESS_CONFIG_VERSION) {
      rejected.push({ moduleId: entry.moduleId, processKey: null, reason: 'unsupported config version' })
      continue
    }
    for (const candidate of Array.isArray(config.processes) ? config.processes : []) {
      const result = readProcess(entry.moduleId, candidate, index)
      if ('reason' in result) {
        rejected.push(result)
        continue
      }
      const existing = processes.get(result.processKey)
      if (existing) {
        rejected.push({ moduleId: entry.moduleId, processKey: result.processKey, reason: `duplicate processKey, kept ${existing.moduleId}` })
        continue
      }
      processes.set(result.processKey, result)
    }
    for (const candidate of Array.isArray(config.actorDimensions) ? config.actorDimensions : []) {
      if (!isValidActorDimensionProvider(candidate)) {
        rejected.push({ moduleId: entry.moduleId, processKey: null, reason: 'invalid actor dimension provider' })
        continue
      }
      if (actorDimensions.has(candidate.kind)) continue
      actorDimensions.set(candidate.kind, { moduleId: entry.moduleId, provider: candidate })
    }
  }
  const list = Array.from(processes.values()).sort((left, right) => left.processKey.localeCompare(right.processKey))
  return {
    ready: true,
    processes: list,
    actorDimensions,
    rejected,
    contractHash: computeProcessContractHash(list),
    logResourceKinds: collectLogResourceKinds(list),
  }
}

function hasRuntimeContracts(entry: Module): boolean {
  return Object.keys(entry).some((key) => key !== 'id' && key !== 'translations')
}

function readEncryptionSources(modules: readonly Module[]): ModuleEncryptionSource[] | null {
  if (!modules.some(hasRuntimeContracts)) return null
  return modules.map((entry) => ({ moduleId: entry.id, maps: entry.defaultEncryptionMaps ?? [] }))
}

function notReadySnapshot(): ProcessRegistrySnapshot {
  return {
    ready: false,
    processes: [],
    actorDimensions: new Map(),
    rejected: [],
    contractHash: computeProcessContractHash([]),
    logResourceKinds: [],
  }
}

function ensureModulesListener(state: ProcessRegistryState): void {
  if (state.listening) return
  state.listening = true
  onModulesRegistered(() => {
    resolveState().snapshot = null
    getProcessRegistry()
  })
}

function logRejections(snapshot: ProcessRegistrySnapshot): void {
  for (const rejection of snapshot.rejected) {
    logger.error('[internal] Rejected an insights.process declaration', {
      moduleId: rejection.moduleId,
      processKey: rejection.processKey,
      reason: rejection.reason,
    })
  }
}

export function registerProcessConfigEntries(entries: readonly ProcessConfigRegistrationEntry[]): void {
  const state = resolveState()
  state.entries = Array.isArray(entries) ? entries.filter((entry) => entry && isNonEmptyString(entry.moduleId)) : []
  state.snapshot = null
  ensureModulesListener(state)
  getProcessRegistry()
}

/**
 * The validated registry. Validation needs the registered module list (for the
 * encryption maps), so until the full module registry is bootstrapped the result is
 * `ready: false` with no processes and nothing is cached (fail closed).
 */
export function getProcessRegistry(): ProcessRegistrySnapshot {
  const state = resolveState()
  if (state.snapshot) return state.snapshot
  const modules = tryGetModules()
  const sources = modules ? readEncryptionSources(modules) : null
  if (!sources) return notReadySnapshot()
  const snapshot = buildProcessRegistrySnapshot(state.entries, sources)
  logRejections(snapshot)
  state.snapshot = snapshot
  return snapshot
}

export function findRegisteredProcess(processKey: string): RegisteredProcess | null {
  return getProcessRegistry().processes.find((process) => process.processKey === processKey) ?? null
}

export function resetProcessRegistryForTests(): void {
  const scope = globalThis as GlobalWithProcessRegistry
  scope[REGISTRY_KEY] = { entries: [], snapshot: null, listening: scope[REGISTRY_KEY]?.listening ?? false }
}
