/**
 * In-place step type conversion (spec section 4.5, issue #4237 A9a).
 *
 * "Change type…" keeps the step's id, name, position and wiring; config the
 * target type genuinely shares is mapped across, and config it cannot execute
 * is quarantined under `unmappedConfig` — visible in the inspector, flagged in
 * Problems, never dropped. Restoring a quarantined value is a matter of
 * converting back, which is exactly why nothing may be discarded here.
 *
 * PURE: plain step data in, plain step data out. No React, no ORM, no DI, no
 * xyflow. The editor page owns the actual node mutation.
 *
 * The vocabulary is the editor's node types rather than the definition's
 * `stepType` enum, because that is the granularity an author changes: an
 * `invokeAgent` node compiles to an AUTOMATED step, and converting between the
 * two is a real, meaningful conversion the enum cannot express.
 */

export type ConvertibleStepType =
  | 'userTask'
  | 'automated'
  | 'invokeAgent'
  | 'subWorkflow'
  | 'waitForSignal'
  | 'waitForTimer'
  | 'waitForCondition'
  | 'parallelFork'
  | 'parallelJoin'
  | 'ifElse'
  | 'switch'

/**
 * START and END are deliberately absent: `validateWorkflowGraph` requires
 * exactly one START and at least one END, so converting either one (or into
 * one) breaks an invariant the author cannot see from the inspector.
 */
export const CONVERTIBLE_STEP_TYPES: ConvertibleStepType[] = [
  'userTask',
  'automated',
  'invokeAgent',
  'subWorkflow',
  'waitForSignal',
  'waitForTimer',
  'waitForCondition',
  'ifElse',
  'switch',
  'parallelFork',
  'parallelJoin',
]

/** Step data that describes the step itself, never a single type's behaviour. */
const SHARED_DATA_KEYS = [
  'label',
  'stepName',
  'description',
  'timeout',
  'retryPolicy',
  'errorDirective',
  'status',
  'stepNumber',
  'stepMetadata',
] as const

/** Top-level `node.data` keys each type actually executes. */
const TYPE_DATA_KEYS: Record<ConvertibleStepType, readonly string[]> = {
  userTask: ['assignedTo', 'assignedToRoles', 'formKey', 'userTaskConfig'],
  automated: ['activityType', 'activityId', 'activities'],
  invokeAgent: ['activityType', 'activityId', 'activities', 'agentId', 'signalConfig'],
  subWorkflow: [],
  waitForSignal: ['signalConfig'],
  waitForTimer: [],
  waitForCondition: [],
  parallelFork: [],
  parallelJoin: [],
  ifElse: [],
  switch: [],
}

/** `node.data.config` keys each type actually executes. */
const TYPE_CONFIG_KEYS: Record<ConvertibleStepType, readonly string[]> = {
  userTask: [],
  automated: [],
  invokeAgent: [],
  subWorkflow: ['subWorkflowId', 'version', 'inputMapping', 'outputMapping'],
  waitForSignal: [],
  waitForTimer: ['duration', 'until'],
  waitForCondition: ['condition', 'timeout', 'onTimeout', 'pollIntervalMs'],
  parallelFork: ['joinStepId'],
  parallelJoin: ['forkStepId'],
  ifElse: [],
  switch: [],
}

/**
 * Where a type keeps its "give up after" deadline. The two waiting types spell
 * the same ISO-8601 duration differently, so the value travels between them
 * instead of being quarantined. WAIT_FOR_TIMER's `duration` is deliberately not
 * part of this: it is how long to wait ON PURPOSE, not when to give up.
 */
const DEADLINE_SLOTS: Partial<Record<ConvertibleStepType, { container: 'data' | 'config'; parent?: string; key: string }>> = {
  waitForSignal: { container: 'data', parent: 'signalConfig', key: 'timeout' },
  waitForCondition: { container: 'config', key: 'timeout' },
}

export interface ConvertibleStep {
  type?: string | null
  data?: Record<string, unknown> | null
}

export type StepTypeConversionResult =
  | {
      ok: true
      type: ConvertibleStepType
      data: Record<string, unknown>
      /** Config keys moved to `unmappedConfig` by THIS conversion. */
      quarantined: string[]
    }
  | { ok: false; code: 'sameType' | 'unsupportedSource' | 'unsupportedTarget' }

export function isConvertibleStepType(type: string | null | undefined): type is ConvertibleStepType {
  return typeof type === 'string' && (CONVERTIBLE_STEP_TYPES as string[]).includes(type)
}

/** Types a step of `sourceType` may be converted into (never itself). */
export function listStepTypeConversionTargets(sourceType: string | null | undefined): ConvertibleStepType[] {
  if (!isConvertibleStepType(sourceType)) return []
  return CONVERTIBLE_STEP_TYPES.filter((candidate) => candidate !== sourceType)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0
}

function readDeadline(type: ConvertibleStepType, data: Record<string, unknown>): unknown {
  const slot = DEADLINE_SLOTS[type]
  if (!slot) return undefined
  const container = slot.container === 'config' ? data.config : slot.parent ? data[slot.parent] : data
  if (!isRecord(container)) return undefined
  const value = container[slot.key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isDeadlineKey(type: ConvertibleStepType, container: 'data' | 'config', parent: string | undefined, key: string): boolean {
  const slot = DEADLINE_SLOTS[type]
  if (!slot) return false
  return slot.container === container && slot.parent === parent && slot.key === key
}

function writeDeadline(type: ConvertibleStepType, data: Record<string, unknown>, config: Record<string, unknown>, value: unknown): void {
  const slot = DEADLINE_SLOTS[type]
  if (!slot || value === undefined) return
  if (slot.container === 'config') {
    config[slot.key] = value
    return
  }
  if (!slot.parent) {
    data[slot.key] = value
    return
  }
  const parent = isRecord(data[slot.parent]) ? { ...(data[slot.parent] as Record<string, unknown>) } : {}
  parent[slot.key] = value
  data[slot.parent] = parent
}

/**
 * Convert one step to another type.
 *
 * Everything the target type executes is carried across, the shared deadline
 * moves between the two waiting types, and every remaining key lands in
 * `data.unmappedConfig` (merged with anything an earlier conversion already
 * quarantined) so a later conversion back can pick it up.
 */
export function convertStepType(step: ConvertibleStep, targetType: string): StepTypeConversionResult {
  const sourceType = step.type
  if (!isConvertibleStepType(sourceType)) return { ok: false, code: 'unsupportedSource' }
  if (!isConvertibleStepType(targetType)) return { ok: false, code: 'unsupportedTarget' }
  if (sourceType === targetType) return { ok: false, code: 'sameType' }

  const sourceData = isRecord(step.data) ? step.data : {}
  const acceptedDataKeys = new Set<string>([...SHARED_DATA_KEYS, ...TYPE_DATA_KEYS[targetType]])
  const acceptedConfigKeys = new Set<string>(TYPE_CONFIG_KEYS[targetType])

  const nextData: Record<string, unknown> = {}
  const nextConfig: Record<string, unknown> = {}
  const quarantine: Record<string, unknown> = isRecord(sourceData.unmappedConfig)
    ? { ...(sourceData.unmappedConfig as Record<string, unknown>) }
    : {}
  const quarantinedConfig: Record<string, unknown> = isRecord(quarantine.config)
    ? { ...(quarantine.config as Record<string, unknown>) }
    : {}
  const quarantined: string[] = []

  const deadline = readDeadline(sourceType, sourceData)

  for (const [key, value] of Object.entries(sourceData)) {
    if (key === 'unmappedConfig' || key === 'badge') continue
    if (value === undefined) continue

    if (key === 'config') {
      if (!isRecord(value)) continue
      for (const [configKey, configValue] of Object.entries(value)) {
        if (configValue === undefined) continue
        if (acceptedConfigKeys.has(configKey)) {
          nextConfig[configKey] = configValue
          continue
        }
        if (isDeadlineKey(sourceType, 'config', undefined, configKey) && DEADLINE_SLOTS[targetType]) continue
        quarantinedConfig[configKey] = configValue
        quarantined.push(`config.${configKey}`)
      }
      continue
    }

    if (acceptedDataKeys.has(key)) {
      nextData[key] = value
      continue
    }

    const deadlineSlot = DEADLINE_SLOTS[sourceType]
    if (deadlineSlot && deadlineSlot.container === 'data' && deadlineSlot.parent === key && DEADLINE_SLOTS[targetType] && isRecord(value)) {
      const remainder = { ...value }
      delete remainder[deadlineSlot.key]
      if (hasKeys(remainder)) {
        quarantine[key] = remainder
        quarantined.push(key)
      }
      continue
    }

    quarantine[key] = value
    quarantined.push(key)
  }

  writeDeadline(targetType, nextData, nextConfig, deadline)

  if (hasKeys(nextConfig)) nextData.config = nextConfig
  if (hasKeys(quarantinedConfig)) quarantine.config = quarantinedConfig
  if (hasKeys(quarantine)) nextData.unmappedConfig = quarantine

  return { ok: true, type: targetType, data: nextData, quarantined }
}

/** True when a step carries quarantined config the Problems panel should flag. */
export function readUnmappedStepConfig(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null
  const unmapped = data.unmappedConfig
  return isRecord(unmapped) && hasKeys(unmapped) ? unmapped : null
}
