import fs from 'node:fs'
import path from 'node:path'
import { parseBooleanWithDefault } from '../boolean'
import { parseNumberWithDefault } from '../number'

const GLOBAL_KEY = '__openMercatoModuleResourceUsage__'
const NS_PER_MS = 1_000_000
const MICROS_PER_MS = 1000
const DEFAULT_RECENT_SAMPLE_LIMIT = 128
const DEFAULT_TOP_OPERATIONS_LIMIT = 5
const TIME_BUCKET_RETENTION_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_THROTTLE_MS = 5_000
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const MODULE_RESOURCE_USAGE_BUCKET_INTERVAL_MS = 5 * MINUTE_MS
const MODULE_RESOURCE_USAGE_STARTUP_STAGE_MS = 5 * MINUTE_MS

export type ModuleResourceSurface = 'api' | 'subscriber' | 'worker' | 'custom'

export type ModuleResourceUsageInput = {
  moduleId?: string | null
  surface: ModuleResourceSurface
  operation: string
  resourceId?: string | null
}

export type ModuleResourceUsageEntry = {
  moduleId: string
  surface: ModuleResourceSurface
  operation: string
  resourceId: string | null
  calls: number
  errors: number
  // How many of `calls` overlapped in wall-clock time with another tracked call anywhere in
  // the process. process.cpuUsage()/process.memoryUsage() are process-wide, so a call's own
  // CPU/heap/RSS deltas can include work actually done by a concurrent call during that window.
  // A high concurrentCalls share means the CPU/heap/RSS numbers here are less trustworthy as
  // this specific operation's own cost.
  concurrentCalls: number
  totalDurationMs: number
  maxDurationMs: number
  p95DurationMs: number
  totalCpuUserMs: number
  totalCpuSystemMs: number
  maxCpuMs: number
  totalHeapDeltaBytes: number
  positiveHeapDeltaBytes: number
  maxHeapDeltaBytes: number
  totalRssDeltaBytes: number
  positiveRssDeltaBytes: number
  maxRssDeltaBytes: number
  firstSeenAt: string
  lastSeenAt: string
}

export type ModuleResourceUsageSurfaceSummary = {
  surface: ModuleResourceSurface
  calls: number
  errors: number
  totalDurationMs: number
  p95DurationMs: number
  totalCpuMs: number
  positiveHeapDeltaBytes: number
  positiveRssDeltaBytes: number
}

export type ModuleResourceUsageModuleSummary = {
  moduleId: string
  calls: number
  errors: number
  totalDurationMs: number
  p95DurationMs: number
  totalCpuMs: number
  positiveHeapDeltaBytes: number
  positiveRssDeltaBytes: number
  surfaces: ModuleResourceUsageSurfaceSummary[]
  topOperations: ModuleResourceUsageEntry[]
  candidateReasons: string[]
}

export type ModuleResourceUsageTimeBucketModule = {
  moduleId: string
  calls: number
  errors: number
  totalDurationMs: number
  p95DurationMs: number
  totalCpuMs: number
  positiveHeapDeltaBytes: number
  positiveRssDeltaBytes: number
  surfaces: ModuleResourceUsageSurfaceSummary[]
  topOperations: ModuleResourceUsageEntry[]
  candidateReasons: string[]
}

export type ModuleResourceUsageTimeBucket = {
  bucketStart: string
  bucketEnd: string
  bucketIntervalMs: number
  stage: 'startup' | 'running'
  partial: boolean
  totals: {
    modules: number
    calls: number
    errors: number
    totalDurationMs: number
    totalCpuMs: number
    positiveHeapDeltaBytes: number
    positiveRssDeltaBytes: number
  }
  modules: ModuleResourceUsageTimeBucketModule[]
}

export type ModuleResourceUsageReport = {
  generatedAt: string
  startedAt: string
  enabled: boolean
  bucketIntervalMs: number
  totals: {
    modules: number
    operations: number
    calls: number
    errors: number
    totalDurationMs: number
    totalCpuMs: number
    positiveHeapDeltaBytes: number
    positiveRssDeltaBytes: number
  }
  thresholds: ModuleResourceUsageThresholds
  modules: ModuleResourceUsageModuleSummary[]
  candidates: ModuleResourceUsageModuleSummary[]
  buckets: ModuleResourceUsageTimeBucket[]
}

export type ModuleResourceUsageThresholds = {
  p95DurationMs: number
  cpuMs: number
  positiveHeapDeltaBytes: number
  positiveRssDeltaBytes: number
  errors: number
}

type MutableEntry = Omit<ModuleResourceUsageEntry, 'p95DurationMs'> & {
  recentDurationsMs: number[]
}

type MutableTimeBucketModule = Omit<ModuleResourceUsageTimeBucketModule, 'p95DurationMs' | 'surfaces' | 'topOperations' | 'candidateReasons'> & {
  recentDurationsMs: number[]
  operations: Map<string, MutableEntry>
}

type MutableTimeBucket = {
  bucketStartMs: number
  bucketEndMs: number
  modules: Map<string, MutableTimeBucketModule>
}

// A live token per currently in-flight withModuleResourceUsage call. Used to detect when two
// tracked calls overlap in wall-clock time, since process.cpuUsage()/process.memoryUsage() can't
// distinguish which concurrent call actually did the work (see ModuleResourceUsageEntry.concurrentCalls).
type ActiveCallToken = { tainted: boolean }

type ResourceUsageState = {
  startedAt: string
  entries: Map<string, MutableEntry>
  buckets: Map<string, MutableTimeBucket>
  activeCalls: Set<ActiveCallToken>
  lastSnapshotAt: number
  shutdownHookRegistered: boolean
  // The bucket interval buckets were last re-keyed for. migrateMutableTimeBuckets only needs to
  // run again if this stops matching moduleResourceUsageBucketIntervalMs() (e.g. a dev HMR reload
  // picked up a source change to the interval constant) — it's a hardcoded constant today, so in
  // the common case this lets getState() skip rebuilding the whole buckets map on every call.
  migratedIntervalMs: number
}

function getState(): ResourceUsageState {
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
  if (existing && typeof existing === 'object' && (existing as ResourceUsageState).entries instanceof Map) {
    const state = existing as ResourceUsageState
    if (!(state.buckets instanceof Map)) state.buckets = new Map()
    if (!(state.activeCalls instanceof Set)) state.activeCalls = new Set()
    const currentIntervalMs = moduleResourceUsageBucketIntervalMs()
    if (state.migratedIntervalMs !== currentIntervalMs) {
      migrateMutableTimeBuckets(state, currentIntervalMs)
      state.migratedIntervalMs = currentIntervalMs
    }
    registerSnapshotShutdownHook(state)
    return state
  }
  const state: ResourceUsageState = {
    startedAt: new Date().toISOString(),
    entries: new Map(),
    buckets: new Map(),
    activeCalls: new Set(),
    lastSnapshotAt: 0,
    shutdownHookRegistered: false,
    migratedIntervalMs: moduleResourceUsageBucketIntervalMs(),
  }
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = state
  registerSnapshotShutdownHook(state)
  return state
}

function migrateMutableTimeBuckets(state: ResourceUsageState, intervalMs: number): void {
  const migratedBuckets = new Map<string, MutableTimeBucket>()
  for (const bucket of state.buckets.values()) {
    if (!(bucket.modules instanceof Map)) continue
    const bucketStartMs = Number.isFinite(bucket.bucketStartMs)
      ? Math.floor(bucket.bucketStartMs / intervalMs) * intervalMs
      : null
    if (bucketStartMs === null) continue
    const key = String(bucketStartMs)
    const targetBucket = migratedBuckets.get(key) ?? {
      bucketStartMs,
      bucketEndMs: bucketStartMs + intervalMs,
      modules: new Map(),
    }
    mergeMutableTimeBucket(targetBucket, bucket)
    migratedBuckets.set(key, targetBucket)
  }
  state.buckets = migratedBuckets
}

function trimRecentDurations(values: number[]): number[] {
  if (values.length <= DEFAULT_RECENT_SAMPLE_LIMIT) return values
  return values.slice(values.length - DEFAULT_RECENT_SAMPLE_LIMIT)
}

function mergeMutableEntry(target: MutableEntry, source: MutableEntry): void {
  target.calls += source.calls
  target.errors += source.errors
  target.concurrentCalls += source.concurrentCalls
  target.totalDurationMs += source.totalDurationMs
  target.maxDurationMs = Math.max(target.maxDurationMs, source.maxDurationMs)
  target.totalCpuUserMs += source.totalCpuUserMs
  target.totalCpuSystemMs += source.totalCpuSystemMs
  target.maxCpuMs = Math.max(target.maxCpuMs, source.maxCpuMs)
  target.totalHeapDeltaBytes += source.totalHeapDeltaBytes
  target.positiveHeapDeltaBytes += source.positiveHeapDeltaBytes
  target.maxHeapDeltaBytes = Math.max(target.maxHeapDeltaBytes, source.maxHeapDeltaBytes)
  target.totalRssDeltaBytes += source.totalRssDeltaBytes
  target.positiveRssDeltaBytes += source.positiveRssDeltaBytes
  target.maxRssDeltaBytes = Math.max(target.maxRssDeltaBytes, source.maxRssDeltaBytes)
  target.firstSeenAt = target.firstSeenAt < source.firstSeenAt ? target.firstSeenAt : source.firstSeenAt
  target.lastSeenAt = target.lastSeenAt > source.lastSeenAt ? target.lastSeenAt : source.lastSeenAt
  target.recentDurationsMs = trimRecentDurations([
    ...target.recentDurationsMs,
    ...(Array.isArray(source.recentDurationsMs) ? source.recentDurationsMs : []),
  ])
}

function cloneMutableEntry(entry: MutableEntry): MutableEntry {
  return {
    ...entry,
    recentDurationsMs: trimRecentDurations(Array.isArray(entry.recentDurationsMs) ? [...entry.recentDurationsMs] : []),
  }
}

function mergeMutableTimeBucket(targetBucket: MutableTimeBucket, sourceBucket: MutableTimeBucket): void {
  for (const sourceModule of sourceBucket.modules.values()) {
    if (!Array.isArray(sourceModule.recentDurationsMs)) sourceModule.recentDurationsMs = []
    if (!(sourceModule.operations instanceof Map)) sourceModule.operations = new Map()
    const targetModule = targetBucket.modules.get(sourceModule.moduleId)
    if (!targetModule) {
      targetBucket.modules.set(sourceModule.moduleId, {
        moduleId: sourceModule.moduleId,
        calls: sourceModule.calls,
        errors: sourceModule.errors,
        totalDurationMs: sourceModule.totalDurationMs,
        totalCpuMs: sourceModule.totalCpuMs,
        positiveHeapDeltaBytes: sourceModule.positiveHeapDeltaBytes,
        positiveRssDeltaBytes: sourceModule.positiveRssDeltaBytes,
        recentDurationsMs: trimRecentDurations([...sourceModule.recentDurationsMs]),
        operations: new Map(Array.from(sourceModule.operations.entries()).map(([key, entry]) => [key, cloneMutableEntry(entry)])),
      })
      continue
    }
    targetModule.calls += sourceModule.calls
    targetModule.errors += sourceModule.errors
    targetModule.totalDurationMs += sourceModule.totalDurationMs
    targetModule.totalCpuMs += sourceModule.totalCpuMs
    targetModule.positiveHeapDeltaBytes += sourceModule.positiveHeapDeltaBytes
    targetModule.positiveRssDeltaBytes += sourceModule.positiveRssDeltaBytes
    targetModule.recentDurationsMs = trimRecentDurations([
      ...targetModule.recentDurationsMs,
      ...sourceModule.recentDurationsMs,
    ])
    for (const [operationKey, sourceOperation] of sourceModule.operations) {
      const targetOperation = targetModule.operations.get(operationKey)
      if (!targetOperation) {
        targetModule.operations.set(operationKey, cloneMutableEntry(sourceOperation))
        continue
      }
      mergeMutableEntry(targetOperation, sourceOperation)
    }
  }
}

export function resetModuleResourceUsage(): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
    startedAt: new Date().toISOString(),
    entries: new Map(),
    buckets: new Map(),
    activeCalls: new Set(),
    lastSnapshotAt: 0,
    shutdownHookRegistered: false,
    migratedIntervalMs: moduleResourceUsageBucketIntervalMs(),
  } satisfies ResourceUsageState
}

export function clearModuleResourceUsageData(): void {
  resetModuleResourceUsage()
  try {
    fs.rmSync(getSnapshotDir(), { recursive: true, force: true })
  } catch {
    // Telemetry is diagnostic only; clearing in-memory state is still useful if files cannot be removed.
  }
}

export function isModuleResourceUsageEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_MODULE_RESOURCE_USAGE, true)
}

function isSnapshotEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_MODULE_RESOURCE_USAGE_SNAPSHOT, process.env.NODE_ENV !== 'test')
}

export function inferModuleIdFromResourceId(resourceId: string | null | undefined): string | null {
  if (!resourceId) return null
  const trimmed = resourceId.trim()
  if (!trimmed) return null
  const colon = trimmed.indexOf(':')
  if (colon > 0) return trimmed.slice(0, colon)
  const dot = trimmed.indexOf('.')
  if (dot > 0) return trimmed.slice(0, dot)
  return null
}

function normalizeModuleId(input: ModuleResourceUsageInput): string | null {
  const explicit = input.moduleId?.trim()
  if (explicit) return explicit
  return inferModuleIdFromResourceId(input.resourceId) ?? inferModuleIdFromResourceId(input.operation)
}

function nowNs(): bigint {
  return process.hrtime.bigint()
}

function durationMs(startNs: bigint): number {
  const elapsed = nowNs() - startNs
  if (elapsed <= BigInt(0)) return 0
  return Number(elapsed) / NS_PER_MS
}

function round(value: number, precision = 100): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * precision) / precision
}

function safeMemoryUsage(): NodeJS.MemoryUsage | null {
  try {
    return process.memoryUsage()
  } catch {
    return null
  }
}

function entryKey(input: Required<Pick<ModuleResourceUsageInput, 'surface' | 'operation'>> & { moduleId: string }): string {
  return `${input.moduleId}\u0000${input.surface}\u0000${input.operation}`
}

function getOrCreateEntry(input: ModuleResourceUsageInput & { moduleId: string }, timestamp: string): MutableEntry {
  const state = getState()
  const key = entryKey(input)
  const existing = state.entries.get(key)
  if (existing) return existing
  const created: MutableEntry = {
    moduleId: input.moduleId,
    surface: input.surface,
    operation: input.operation,
    resourceId: input.resourceId ?? null,
    calls: 0,
    errors: 0,
    concurrentCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    totalCpuUserMs: 0,
    totalCpuSystemMs: 0,
    maxCpuMs: 0,
    totalHeapDeltaBytes: 0,
    positiveHeapDeltaBytes: 0,
    maxHeapDeltaBytes: 0,
    totalRssDeltaBytes: 0,
    positiveRssDeltaBytes: 0,
    maxRssDeltaBytes: 0,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    recentDurationsMs: [],
  }
  state.entries.set(key, created)
  return created
}

function getOrCreateTimeBucket(state: ResourceUsageState, timestamp: string): MutableTimeBucket | null {
  const timestampMs = Date.parse(timestamp)
  if (!Number.isFinite(timestampMs)) return null
  const intervalMs = moduleResourceUsageBucketIntervalMs()
  const bucketStartMs = Math.floor(timestampMs / intervalMs) * intervalMs
  const key = String(bucketStartMs)
  const existing = state.buckets.get(key)
  if (existing) return existing
  const created: MutableTimeBucket = {
    bucketStartMs,
    bucketEndMs: bucketStartMs + intervalMs,
    modules: new Map(),
  }
  state.buckets.set(key, created)
  pruneTimeBuckets(state)
  return created
}

function getOrCreateTimeBucketModule(bucket: MutableTimeBucket, moduleId: string): MutableTimeBucketModule {
  const existing = bucket.modules.get(moduleId)
  if (existing) {
    if (!Array.isArray(existing.recentDurationsMs)) existing.recentDurationsMs = []
    if (!(existing.operations instanceof Map)) existing.operations = new Map()
    return existing
  }
  const created: MutableTimeBucketModule = {
    moduleId,
    calls: 0,
    errors: 0,
    totalDurationMs: 0,
    totalCpuMs: 0,
    positiveHeapDeltaBytes: 0,
    positiveRssDeltaBytes: 0,
    recentDurationsMs: [],
    operations: new Map(),
  }
  bucket.modules.set(moduleId, created)
  return created
}

function getOrCreateTimeBucketOperation(
  bucketModule: MutableTimeBucketModule,
  input: ModuleResourceUsageInput & { moduleId: string },
  timestamp: string,
): MutableEntry {
  const key = entryKey(input)
  const existing = bucketModule.operations.get(key)
  if (existing) return existing
  const created: MutableEntry = {
    moduleId: input.moduleId,
    surface: input.surface,
    operation: input.operation,
    resourceId: input.resourceId ?? null,
    calls: 0,
    errors: 0,
    concurrentCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    totalCpuUserMs: 0,
    totalCpuSystemMs: 0,
    maxCpuMs: 0,
    totalHeapDeltaBytes: 0,
    positiveHeapDeltaBytes: 0,
    maxHeapDeltaBytes: 0,
    totalRssDeltaBytes: 0,
    positiveRssDeltaBytes: 0,
    maxRssDeltaBytes: 0,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    recentDurationsMs: [],
  }
  bucketModule.operations.set(key, created)
  return created
}

function pruneTimeBuckets(state: ResourceUsageState): void {
  const limit = moduleResourceUsageBucketLimit()
  if (state.buckets.size <= limit) return
  const keys = Array.from(state.buckets.entries())
    .sort((a, b) => a[1].bucketStartMs - b[1].bucketStartMs)
    .map(([key]) => key)
  while (state.buckets.size > limit) {
    const key = keys.shift()
    if (!key) break
    state.buckets.delete(key)
  }
}

function recordTimeBucket(input: ModuleResourceUsageInput & { moduleId: string }, timestamp: string, metrics: {
  durationMs: number
  cpuUserMs: number
  cpuSystemMs: number
  cpuMs: number
  heapDeltaBytes: number
  rssDeltaBytes: number
  status: 'ok' | 'error'
  concurrentTainted: boolean
}): void {
  const state = getState()
  const bucket = getOrCreateTimeBucket(state, timestamp)
  if (!bucket) return
  const bucketModule = getOrCreateTimeBucketModule(bucket, input.moduleId)
  bucketModule.calls += 1
  if (metrics.status === 'error') bucketModule.errors += 1
  bucketModule.totalDurationMs += metrics.durationMs
  bucketModule.totalCpuMs += metrics.cpuMs
  bucketModule.positiveHeapDeltaBytes += Math.max(metrics.heapDeltaBytes, 0)
  bucketModule.positiveRssDeltaBytes += Math.max(metrics.rssDeltaBytes, 0)
  bucketModule.recentDurationsMs.push(metrics.durationMs)
  if (bucketModule.recentDurationsMs.length > DEFAULT_RECENT_SAMPLE_LIMIT) {
    bucketModule.recentDurationsMs.splice(0, bucketModule.recentDurationsMs.length - DEFAULT_RECENT_SAMPLE_LIMIT)
  }
  const operation = getOrCreateTimeBucketOperation(bucketModule, input, timestamp)
  operation.calls += 1
  if (metrics.status === 'error') operation.errors += 1
  if (metrics.concurrentTainted) operation.concurrentCalls += 1
  operation.totalDurationMs += metrics.durationMs
  operation.maxDurationMs = Math.max(operation.maxDurationMs, metrics.durationMs)
  operation.totalCpuUserMs += metrics.cpuUserMs
  operation.totalCpuSystemMs += metrics.cpuSystemMs
  operation.maxCpuMs = Math.max(operation.maxCpuMs, metrics.cpuMs)
  operation.totalHeapDeltaBytes += metrics.heapDeltaBytes
  operation.positiveHeapDeltaBytes += Math.max(metrics.heapDeltaBytes, 0)
  operation.maxHeapDeltaBytes = Math.max(operation.maxHeapDeltaBytes, metrics.heapDeltaBytes)
  operation.totalRssDeltaBytes += metrics.rssDeltaBytes
  operation.positiveRssDeltaBytes += Math.max(metrics.rssDeltaBytes, 0)
  operation.maxRssDeltaBytes = Math.max(operation.maxRssDeltaBytes, metrics.rssDeltaBytes)
  operation.lastSeenAt = timestamp
  operation.recentDurationsMs.push(metrics.durationMs)
  if (operation.recentDurationsMs.length > DEFAULT_RECENT_SAMPLE_LIMIT) {
    operation.recentDurationsMs.splice(0, operation.recentDurationsMs.length - DEFAULT_RECENT_SAMPLE_LIMIT)
  }
}

function recordModuleResourceUsage(input: ModuleResourceUsageInput, metrics: {
  durationMs: number
  cpuUserMicros: number
  cpuSystemMicros: number
  heapDeltaBytes: number
  rssDeltaBytes: number
  status: 'ok' | 'error'
  concurrentTainted: boolean
}): void {
  const moduleId = normalizeModuleId(input)
  if (!moduleId) return
  const timestamp = new Date().toISOString()
  const entry = getOrCreateEntry({ ...input, moduleId }, timestamp)
  const cpuUserMs = metrics.cpuUserMicros / MICROS_PER_MS
  const cpuSystemMs = metrics.cpuSystemMicros / MICROS_PER_MS
  const cpuMs = cpuUserMs + cpuSystemMs
  entry.calls += 1
  if (metrics.status === 'error') entry.errors += 1
  if (metrics.concurrentTainted) entry.concurrentCalls += 1
  entry.totalDurationMs += metrics.durationMs
  entry.maxDurationMs = Math.max(entry.maxDurationMs, metrics.durationMs)
  entry.totalCpuUserMs += cpuUserMs
  entry.totalCpuSystemMs += cpuSystemMs
  entry.maxCpuMs = Math.max(entry.maxCpuMs, cpuMs)
  entry.totalHeapDeltaBytes += metrics.heapDeltaBytes
  entry.positiveHeapDeltaBytes += Math.max(metrics.heapDeltaBytes, 0)
  entry.maxHeapDeltaBytes = Math.max(entry.maxHeapDeltaBytes, metrics.heapDeltaBytes)
  entry.totalRssDeltaBytes += metrics.rssDeltaBytes
  entry.positiveRssDeltaBytes += Math.max(metrics.rssDeltaBytes, 0)
  entry.maxRssDeltaBytes = Math.max(entry.maxRssDeltaBytes, metrics.rssDeltaBytes)
  entry.lastSeenAt = timestamp
  entry.recentDurationsMs.push(metrics.durationMs)
  if (entry.recentDurationsMs.length > DEFAULT_RECENT_SAMPLE_LIMIT) {
    entry.recentDurationsMs.splice(0, entry.recentDurationsMs.length - DEFAULT_RECENT_SAMPLE_LIMIT)
  }
  recordTimeBucket({ ...input, moduleId }, timestamp, {
    durationMs: metrics.durationMs,
    cpuUserMs,
    cpuSystemMs,
    cpuMs,
    heapDeltaBytes: metrics.heapDeltaBytes,
    rssDeltaBytes: metrics.rssDeltaBytes,
    status: metrics.status,
    concurrentTainted: metrics.concurrentTainted,
  })
  flushModuleResourceUsageSnapshot(false)
}

export async function withModuleResourceUsage<T>(
  input: ModuleResourceUsageInput,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (!isModuleResourceUsageEnabled() || !normalizeModuleId(input)) {
    return Promise.resolve(fn())
  }
  const state = getState()
  // Mark this call tainted if another tracked call is already in flight, and mark every
  // currently in-flight call tainted too, since process.cpuUsage()/process.memoryUsage() can't
  // separate their concurrent work from ours (see ModuleResourceUsageEntry.concurrentCalls).
  const token: ActiveCallToken = { tainted: state.activeCalls.size > 0 }
  if (token.tainted) {
    for (const other of state.activeCalls) other.tainted = true
  }
  state.activeCalls.add(token)
  const startNs = nowNs()
  const startCpu = process.cpuUsage()
  const startMemory = safeMemoryUsage()
  try {
    const result = await Promise.resolve(fn())
    const cpu = process.cpuUsage(startCpu)
    const endMemory = safeMemoryUsage()
    state.activeCalls.delete(token)
    recordModuleResourceUsage(input, {
      durationMs: durationMs(startNs),
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      heapDeltaBytes: endMemory && startMemory ? endMemory.heapUsed - startMemory.heapUsed : 0,
      rssDeltaBytes: endMemory && startMemory ? endMemory.rss - startMemory.rss : 0,
      status: 'ok',
      concurrentTainted: token.tainted,
    })
    return result
  } catch (error) {
    const cpu = process.cpuUsage(startCpu)
    const endMemory = safeMemoryUsage()
    state.activeCalls.delete(token)
    recordModuleResourceUsage(input, {
      durationMs: durationMs(startNs),
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      heapDeltaBytes: endMemory && startMemory ? endMemory.heapUsed - startMemory.heapUsed : 0,
      rssDeltaBytes: endMemory && startMemory ? endMemory.rss - startMemory.rss : 0,
      status: 'error',
      concurrentTainted: token.tainted,
    })
    throw error
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function serializeEntry(entry: MutableEntry): ModuleResourceUsageEntry {
  return {
    moduleId: entry.moduleId,
    surface: entry.surface,
    operation: entry.operation,
    resourceId: entry.resourceId,
    calls: entry.calls,
    errors: entry.errors,
    concurrentCalls: entry.concurrentCalls,
    totalDurationMs: round(entry.totalDurationMs),
    maxDurationMs: round(entry.maxDurationMs),
    p95DurationMs: round(percentile(entry.recentDurationsMs, 95)),
    totalCpuUserMs: round(entry.totalCpuUserMs),
    totalCpuSystemMs: round(entry.totalCpuSystemMs),
    maxCpuMs: round(entry.maxCpuMs),
    totalHeapDeltaBytes: Math.round(entry.totalHeapDeltaBytes),
    positiveHeapDeltaBytes: Math.round(entry.positiveHeapDeltaBytes),
    maxHeapDeltaBytes: Math.round(entry.maxHeapDeltaBytes),
    totalRssDeltaBytes: Math.round(entry.totalRssDeltaBytes),
    positiveRssDeltaBytes: Math.round(entry.positiveRssDeltaBytes),
    maxRssDeltaBytes: Math.round(entry.maxRssDeltaBytes),
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
  }
}

function timeBucketTotals(modules: ModuleResourceUsageTimeBucketModule[]): ModuleResourceUsageTimeBucket['totals'] {
  return {
    modules: modules.length,
    calls: modules.reduce((sum, module) => sum + module.calls, 0),
    errors: modules.reduce((sum, module) => sum + module.errors, 0),
    totalDurationMs: round(modules.reduce((sum, module) => sum + module.totalDurationMs, 0)),
    totalCpuMs: round(modules.reduce((sum, module) => sum + module.totalCpuMs, 0)),
    positiveHeapDeltaBytes: modules.reduce((sum, module) => sum + module.positiveHeapDeltaBytes, 0),
    positiveRssDeltaBytes: modules.reduce((sum, module) => sum + module.positiveRssDeltaBytes, 0),
  }
}

function surfaceSummaries(entries: ModuleResourceUsageEntry[]): ModuleResourceUsageSurfaceSummary[] {
  const surfaces = new Map<ModuleResourceSurface, ModuleResourceUsageEntry[]>()
  for (const entry of entries) {
    const list = surfaces.get(entry.surface) ?? []
    list.push(entry)
    surfaces.set(entry.surface, list)
  }
  return Array.from(surfaces.entries()).map(([surface, surfaceEntries]) => ({
    surface,
    calls: surfaceEntries.reduce((sum, entry) => sum + entry.calls, 0),
    errors: surfaceEntries.reduce((sum, entry) => sum + entry.errors, 0),
    totalDurationMs: round(surfaceEntries.reduce((sum, entry) => sum + entry.totalDurationMs, 0)),
    p95DurationMs: round(Math.max(...surfaceEntries.map((entry) => entry.p95DurationMs), 0)),
    totalCpuMs: round(surfaceEntries.reduce((sum, entry) => sum + entry.totalCpuUserMs + entry.totalCpuSystemMs, 0)),
    positiveHeapDeltaBytes: surfaceEntries.reduce((sum, entry) => sum + entry.positiveHeapDeltaBytes, 0),
    positiveRssDeltaBytes: surfaceEntries.reduce((sum, entry) => sum + entry.positiveRssDeltaBytes, 0),
  })).sort((a, b) => b.totalCpuMs - a.totalCpuMs || b.totalDurationMs - a.totalDurationMs)
}

function moduleResourceUsageBucketStage(bucketStartMs: number, bucketEndMs: number, startedAtMs: number): ModuleResourceUsageTimeBucket['stage'] {
  if (!Number.isFinite(bucketStartMs) || !Number.isFinite(bucketEndMs) || !Number.isFinite(startedAtMs)) return 'running'
  return bucketEndMs > startedAtMs && bucketStartMs < startedAtMs + MODULE_RESOURCE_USAGE_STARTUP_STAGE_MS
    ? 'startup'
    : 'running'
}

function serializeTimeBucket(bucket: MutableTimeBucket, nowMs: number, startedAtMs: number): ModuleResourceUsageTimeBucket {
  const thresholds = getModuleResourceUsageThresholds()
  const modules = Array.from(bucket.modules.values()).map((module) => ({
    module,
    operations: module.operations instanceof Map
      ? Array.from(module.operations.values()).map(serializeEntry)
      : [],
  })).map(({ module, operations }) => {
    const summaryBase = {
      moduleId: module.moduleId,
      calls: module.calls,
      errors: module.errors,
      totalDurationMs: round(module.totalDurationMs),
      p95DurationMs: round(percentile(module.recentDurationsMs, 95)),
      totalCpuMs: round(module.totalCpuMs),
      positiveHeapDeltaBytes: Math.round(module.positiveHeapDeltaBytes),
      positiveRssDeltaBytes: Math.round(module.positiveRssDeltaBytes),
      surfaces: surfaceSummaries(operations),
      topOperations: operations
        .slice()
        .sort((a, b) => (b.totalCpuUserMs + b.totalCpuSystemMs) - (a.totalCpuUserMs + a.totalCpuSystemMs) || b.totalDurationMs - a.totalDurationMs)
        .slice(0, DEFAULT_TOP_OPERATIONS_LIMIT),
    }
    return {
      ...summaryBase,
      candidateReasons: buildCandidateReasons(summaryBase, thresholds),
    }
  }).sort((a, b) =>
    b.candidateReasons.length - a.candidateReasons.length
      || b.totalCpuMs - a.totalCpuMs
      || b.positiveRssDeltaBytes - a.positiveRssDeltaBytes
      || b.calls - a.calls
  )
  return {
    bucketStart: new Date(bucket.bucketStartMs).toISOString(),
    bucketEnd: new Date(bucket.bucketEndMs).toISOString(),
    bucketIntervalMs: bucket.bucketEndMs - bucket.bucketStartMs,
    stage: moduleResourceUsageBucketStage(bucket.bucketStartMs, bucket.bucketEndMs, startedAtMs),
    partial: bucket.bucketStartMs < startedAtMs || nowMs < bucket.bucketEndMs,
    totals: timeBucketTotals(modules),
    modules,
  }
}

function serializeTimeBuckets(state: ResourceUsageState): ModuleResourceUsageTimeBucket[] {
  const nowMs = Date.now()
  const startedAtMs = Date.parse(state.startedAt)
  return Array.from(state.buckets.values())
    .sort((a, b) => a.bucketStartMs - b.bucketStartMs)
    .map((bucket) => serializeTimeBucket(bucket, nowMs, Number.isFinite(startedAtMs) ? startedAtMs : nowMs))
}

function getSnapshotDir(): string {
  const configured = process.env.OM_MODULE_RESOURCE_USAGE_DIR?.trim()
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), '.mercato/module-resource-usage')
}

function getSnapshotPath(): string {
  return path.join(getSnapshotDir(), `process-${process.pid}.json`)
}

function registerSnapshotShutdownHook(state: ResourceUsageState): void {
  if (state.shutdownHookRegistered) return
  const flush = () => {
    try {
      flushModuleResourceUsageSnapshot(true)
    } catch {
      // Best-effort diagnostic snapshot; never block process shutdown.
    }
  }
  process.once('beforeExit', flush)
  state.shutdownHookRegistered = true
}

// Fire-and-forget: nothing in this process depends on the write completing (readers always
// skip their own pid's file — see readSnapshotPayloads), so there's no reason for the write to
// block the tracked call, event dispatch, or report request that triggered it. This mirrors the
// existing fire-and-forget queue-close pattern in registerProducerShutdownHook (bus.ts): Node's
// event loop stays alive for the pending promise, so even the beforeExit-triggered flush below
// still completes before the process actually exits, as long as nothing calls process.exit()
// first.
let snapshotWriteSequence = 0

// Writes atomically: serialize to a unique temp file, then rename onto the final path. rename is
// atomic on POSIX, so a concurrent reader (this process's report, another process's directory scan,
// or a test) always observes either the previous complete file or the new complete file — never the
// empty/partial content window that a direct writeFile to snapshotPath would briefly expose.
function writeSnapshotFileAsync(dir: string, snapshotPath: string, payload: unknown): void {
  const tempPath = `${snapshotPath}.${process.pid}.${snapshotWriteSequence++}.tmp`
  fs.promises.mkdir(dir, { recursive: true })
    .then(() => fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2)))
    .then(() => fs.promises.rename(tempPath, snapshotPath))
    .catch(() => {
      // Snapshot files are diagnostic only; in-memory reporting still works. Best-effort cleanup of
      // the temp file if the rename never happened; ignore if it is already gone.
      fs.promises.unlink(tempPath).catch(() => {})
    })
}

function flushModuleResourceUsageSnapshot(force: boolean): void {
  if (!isSnapshotEnabled()) return
  const state = getState()
  const now = Date.now()
  if (!force && now - state.lastSnapshotAt < SNAPSHOT_THROTTLE_MS) return
  state.lastSnapshotAt = now
  try {
    const payload = {
      pid: process.pid,
      generatedAt: new Date().toISOString(),
      startedAt: state.startedAt,
      entries: Array.from(state.entries.values()).map(serializeEntry),
      buckets: serializeTimeBuckets(state),
    }
    writeSnapshotFileAsync(getSnapshotDir(), getSnapshotPath(), payload)
  } catch {
    // Snapshot files are diagnostic only; in-memory reporting still works.
  }
}

type SnapshotPayload = {
  pid?: unknown
  generatedAt?: unknown
  startedAt?: unknown
  entries?: unknown
  buckets?: unknown
}

function isFreshSnapshot(payload: SnapshotPayload): boolean {
  if (typeof payload.generatedAt !== 'string') return false
  const generatedAt = Date.parse(payload.generatedAt)
  return Number.isFinite(generatedAt) && Date.now() - generatedAt <= SNAPSHOT_MAX_AGE_MS
}

// Reads every other process's snapshot file exactly once. Both readSnapshotEntries and
// readSnapshotBuckets used to each force a flush and independently re-scan/re-parse the whole
// directory; callers now do that single scan once (see getModuleResourceUsageReport) and pass
// the result to both.
function readSnapshotPayloads(): SnapshotPayload[] {
  if (!isSnapshotEnabled()) return []
  const dir = getSnapshotDir()
  if (!fs.existsSync(dir)) return []
  const payloads: SnapshotPayload[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as SnapshotPayload
      if (payload.pid === process.pid) continue
      if (!isFreshSnapshot(payload)) continue
      payloads.push(payload)
    } catch {
      // Ignore malformed or concurrently-written snapshots.
    }
  }
  return payloads
}

function readSnapshotEntries(payloads: SnapshotPayload[]): ModuleResourceUsageEntry[] {
  const entries: ModuleResourceUsageEntry[] = []
  for (const payload of payloads) {
    if (!Array.isArray(payload.entries)) continue
    for (const entry of payload.entries) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Partial<ModuleResourceUsageEntry>
      if (typeof candidate.moduleId !== 'string' || typeof candidate.operation !== 'string') continue
      if (!candidate.surface) continue
      entries.push(candidate as ModuleResourceUsageEntry)
    }
  }
  return entries
}

function readSnapshotBuckets(payloads: SnapshotPayload[]): ModuleResourceUsageTimeBucket[] {
  const buckets: ModuleResourceUsageTimeBucket[] = []
  for (const payload of payloads) {
    try {
      if (!Array.isArray(payload.buckets)) continue
      for (const bucket of payload.buckets) {
        if (!bucket || typeof bucket !== 'object') continue
        const candidate = bucket as Partial<ModuleResourceUsageTimeBucket>
        if (typeof candidate.bucketStart !== 'string' || typeof candidate.bucketEnd !== 'string') continue
        if (!Array.isArray(candidate.modules)) continue
        const modules = (candidate.modules as Partial<ModuleResourceUsageTimeBucketModule>[]).map(normalizeTimeBucketModule)
        buckets.push({
          bucketStart: candidate.bucketStart,
          bucketEnd: candidate.bucketEnd,
          bucketIntervalMs: normalizeBucketIntervalMs(candidate),
          stage: candidate.stage === 'startup' || candidate.stage === 'running'
            ? candidate.stage
            : moduleResourceUsageBucketStage(
              Date.parse(candidate.bucketStart),
              Date.parse(candidate.bucketEnd),
              typeof payload.startedAt === 'string' ? Date.parse(payload.startedAt) : Date.parse(candidate.bucketStart),
            ),
          partial: candidate.partial === true,
          totals: candidate.totals ?? timeBucketTotals(modules),
          modules,
        })
      }
    } catch {
      // Ignore malformed or concurrently-written snapshots.
    }
  }
  return buckets
}

function normalizeBucketIntervalMs(bucket: Partial<ModuleResourceUsageTimeBucket>): number {
  if (Number.isFinite(bucket.bucketIntervalMs) && Number(bucket.bucketIntervalMs) > 0) {
    return Number(bucket.bucketIntervalMs)
  }
  const bucketStartMs = typeof bucket.bucketStart === 'string' ? Date.parse(bucket.bucketStart) : NaN
  const bucketEndMs = typeof bucket.bucketEnd === 'string' ? Date.parse(bucket.bucketEnd) : NaN
  const inferred = bucketEndMs - bucketStartMs
  return Number.isFinite(inferred) && inferred > 0 ? inferred : moduleResourceUsageBucketIntervalMs()
}

function normalizeTimeBucketModule(module: Partial<ModuleResourceUsageTimeBucketModule>): ModuleResourceUsageTimeBucketModule {
  return {
    moduleId: typeof module.moduleId === 'string' ? module.moduleId : 'unknown',
    calls: Number.isFinite(module.calls) ? Number(module.calls) : 0,
    errors: Number.isFinite(module.errors) ? Number(module.errors) : 0,
    totalDurationMs: Number.isFinite(module.totalDurationMs) ? Number(module.totalDurationMs) : 0,
    p95DurationMs: Number.isFinite(module.p95DurationMs) ? Number(module.p95DurationMs) : 0,
    totalCpuMs: Number.isFinite(module.totalCpuMs) ? Number(module.totalCpuMs) : 0,
    positiveHeapDeltaBytes: Number.isFinite(module.positiveHeapDeltaBytes) ? Number(module.positiveHeapDeltaBytes) : 0,
    positiveRssDeltaBytes: Number.isFinite(module.positiveRssDeltaBytes) ? Number(module.positiveRssDeltaBytes) : 0,
    surfaces: Array.isArray(module.surfaces) ? module.surfaces : [],
    topOperations: Array.isArray(module.topOperations) ? module.topOperations : [],
    candidateReasons: Array.isArray(module.candidateReasons) ? module.candidateReasons : [],
  }
}

function mergeEntries(entries: ModuleResourceUsageEntry[]): ModuleResourceUsageEntry[] {
  const merged = new Map<string, ModuleResourceUsageEntry>()
  for (const entry of entries) {
    const key = entryKey({ moduleId: entry.moduleId, surface: entry.surface, operation: entry.operation })
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...entry,
        // Snapshot files written by an older process before concurrentCalls existed lack it.
        concurrentCalls: Number.isFinite(entry.concurrentCalls) ? entry.concurrentCalls : 0,
      })
      continue
    }
    existing.calls += entry.calls
    existing.errors += entry.errors
    existing.concurrentCalls += Number.isFinite(entry.concurrentCalls) ? entry.concurrentCalls : 0
    existing.totalDurationMs = round(existing.totalDurationMs + entry.totalDurationMs)
    existing.maxDurationMs = Math.max(existing.maxDurationMs, entry.maxDurationMs)
    existing.p95DurationMs = Math.max(existing.p95DurationMs, entry.p95DurationMs)
    existing.totalCpuUserMs = round(existing.totalCpuUserMs + entry.totalCpuUserMs)
    existing.totalCpuSystemMs = round(existing.totalCpuSystemMs + entry.totalCpuSystemMs)
    existing.maxCpuMs = Math.max(existing.maxCpuMs, entry.maxCpuMs)
    existing.totalHeapDeltaBytes += entry.totalHeapDeltaBytes
    existing.positiveHeapDeltaBytes += entry.positiveHeapDeltaBytes
    existing.maxHeapDeltaBytes = Math.max(existing.maxHeapDeltaBytes, entry.maxHeapDeltaBytes)
    existing.totalRssDeltaBytes += entry.totalRssDeltaBytes
    existing.positiveRssDeltaBytes += entry.positiveRssDeltaBytes
    existing.maxRssDeltaBytes = Math.max(existing.maxRssDeltaBytes, entry.maxRssDeltaBytes)
    existing.firstSeenAt = existing.firstSeenAt < entry.firstSeenAt ? existing.firstSeenAt : entry.firstSeenAt
    existing.lastSeenAt = existing.lastSeenAt > entry.lastSeenAt ? existing.lastSeenAt : entry.lastSeenAt
  }
  return Array.from(merged.values())
}

function mergeSurfaceSummaries(surfaces: ModuleResourceUsageSurfaceSummary[]): ModuleResourceUsageSurfaceSummary[] {
  const merged = new Map<ModuleResourceSurface, ModuleResourceUsageSurfaceSummary>()
  for (const surface of surfaces) {
    const existing = merged.get(surface.surface)
    if (!existing) {
      merged.set(surface.surface, { ...surface })
      continue
    }
    existing.calls += surface.calls
    existing.errors += surface.errors
    existing.totalDurationMs = round(existing.totalDurationMs + surface.totalDurationMs)
    existing.p95DurationMs = Math.max(existing.p95DurationMs, surface.p95DurationMs)
    existing.totalCpuMs = round(existing.totalCpuMs + surface.totalCpuMs)
    existing.positiveHeapDeltaBytes += surface.positiveHeapDeltaBytes
    existing.positiveRssDeltaBytes += surface.positiveRssDeltaBytes
  }
  return Array.from(merged.values()).sort((a, b) => b.totalCpuMs - a.totalCpuMs || b.totalDurationMs - a.totalDurationMs)
}

function mergeOperationEntries(entries: ModuleResourceUsageEntry[]): ModuleResourceUsageEntry[] {
  return mergeEntries(entries)
    .sort((a, b) => (b.totalCpuUserMs + b.totalCpuSystemMs) - (a.totalCpuUserMs + a.totalCpuSystemMs) || b.totalDurationMs - a.totalDurationMs)
    .slice(0, DEFAULT_TOP_OPERATIONS_LIMIT)
}

function mergeTimeBuckets(buckets: ModuleResourceUsageTimeBucket[]): ModuleResourceUsageTimeBucket[] {
  const merged = new Map<string, ModuleResourceUsageTimeBucket>()
  const thresholds = getModuleResourceUsageThresholds()
  for (const bucket of buckets) {
    const bucketStartMs = Date.parse(bucket.bucketStart)
    if (!Number.isFinite(bucketStartMs)) continue
    const bucketIntervalMs = normalizeBucketIntervalMs(bucket)
    const key = `${bucket.bucketStart}\u0000${bucketIntervalMs}`
    const existing = merged.get(key)
    if (!existing) {
      const modules = bucket.modules.map((module) => {
        const normalizedModule = normalizeTimeBucketModule(module)
        return {
          ...normalizedModule,
          candidateReasons: buildCandidateReasons(normalizedModule, thresholds),
        }
      })
      merged.set(key, {
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        bucketIntervalMs,
        stage: bucket.stage,
        partial: bucket.partial,
        totals: timeBucketTotals(modules),
        modules,
      })
      continue
    }
    existing.partial = existing.partial || bucket.partial
    if (existing.stage !== 'startup') existing.stage = bucket.stage
    const modulesById = new Map(existing.modules.map((module) => [module.moduleId, module]))
    for (const module of bucket.modules) {
      const normalizedModule = normalizeTimeBucketModule(module)
      const current = modulesById.get(normalizedModule.moduleId)
      if (!current) {
        const created = {
          ...normalizedModule,
          candidateReasons: buildCandidateReasons(normalizedModule, thresholds),
        }
        existing.modules.push(created)
        modulesById.set(normalizedModule.moduleId, created)
        continue
      }
      current.calls += normalizedModule.calls
      current.errors += normalizedModule.errors
      current.totalDurationMs = round(current.totalDurationMs + normalizedModule.totalDurationMs)
      current.p95DurationMs = Math.max(current.p95DurationMs, normalizedModule.p95DurationMs)
      current.totalCpuMs = round(current.totalCpuMs + normalizedModule.totalCpuMs)
      current.positiveHeapDeltaBytes += normalizedModule.positiveHeapDeltaBytes
      current.positiveRssDeltaBytes += normalizedModule.positiveRssDeltaBytes
      current.surfaces = mergeSurfaceSummaries([...current.surfaces, ...normalizedModule.surfaces])
      current.topOperations = mergeOperationEntries([...current.topOperations, ...normalizedModule.topOperations])
      current.candidateReasons = buildCandidateReasons(current, thresholds)
    }
    existing.modules.sort((a, b) =>
      b.totalCpuMs - a.totalCpuMs
        || b.positiveRssDeltaBytes - a.positiveRssDeltaBytes
        || b.calls - a.calls
    )
    existing.totals = timeBucketTotals(existing.modules)
  }
  return Array.from(merged.values())
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
    .slice(-moduleResourceUsageBucketLimit())
}

function readNumberEnv(name: string, fallback: number): number {
  return parseNumberWithDefault(process.env[name], fallback, { min: 0 })
}

function moduleResourceUsageBucketIntervalMs(): number {
  return MODULE_RESOURCE_USAGE_BUCKET_INTERVAL_MS
}

function moduleResourceUsageBucketLimit(): number {
  return Math.max(1, Math.ceil(TIME_BUCKET_RETENTION_MS / moduleResourceUsageBucketIntervalMs()))
}

export function getModuleResourceUsageThresholds(): ModuleResourceUsageThresholds {
  return {
    p95DurationMs: readNumberEnv('OM_MODULE_RESOURCE_HEAVY_P95_MS', 5_000),
    cpuMs: readNumberEnv('OM_MODULE_RESOURCE_HEAVY_CPU_MS', 25_000),
    positiveHeapDeltaBytes: readNumberEnv('OM_MODULE_RESOURCE_HEAVY_HEAP_BYTES', 250 * 1024 * 1024),
    positiveRssDeltaBytes: readNumberEnv('OM_MODULE_RESOURCE_HEAVY_RSS_BYTES', 250 * 1024 * 1024),
    errors: readNumberEnv('OM_MODULE_RESOURCE_HEAVY_ERRORS', 10),
  }
}

function buildCandidateReasons(
  summary: Omit<ModuleResourceUsageModuleSummary, 'candidateReasons'>,
  thresholds: ModuleResourceUsageThresholds,
): string[] {
  const reasons: string[] = []
  if (summary.p95DurationMs >= thresholds.p95DurationMs) reasons.push('p95_duration')
  if (summary.totalCpuMs >= thresholds.cpuMs) reasons.push('cpu')
  if (summary.positiveHeapDeltaBytes >= thresholds.positiveHeapDeltaBytes) reasons.push('heap_allocations')
  if (summary.positiveRssDeltaBytes >= thresholds.positiveRssDeltaBytes) reasons.push('rss_growth')
  if (summary.errors >= thresholds.errors) reasons.push('errors')
  return reasons
}

export function getModuleResourceUsageReport(): ModuleResourceUsageReport {
  const state = getState()
  // Force our own snapshot to disk once (fire-and-forget — see writeSnapshotFileAsync) so other
  // processes viewing the report around the same time see fresh data, then read every other
  // process's snapshot file exactly once and derive both entries and buckets from that one scan.
  flushModuleResourceUsageSnapshot(true)
  const snapshotPayloads = readSnapshotPayloads()
  const entries = mergeEntries([
    ...Array.from(state.entries.values()).map(serializeEntry),
    ...readSnapshotEntries(snapshotPayloads),
  ])
  const buckets = mergeTimeBuckets([
    ...serializeTimeBuckets(state),
    ...readSnapshotBuckets(snapshotPayloads),
  ])
  const thresholds = getModuleResourceUsageThresholds()
  const modules = new Map<string, ModuleResourceUsageEntry[]>()
  for (const entry of entries) {
    const list = modules.get(entry.moduleId) ?? []
    list.push(entry)
    modules.set(entry.moduleId, list)
  }

  const moduleSummaries: ModuleResourceUsageModuleSummary[] = []
  for (const [moduleId, moduleEntries] of modules) {
    const surfaces = new Map<ModuleResourceSurface, ModuleResourceUsageEntry[]>()
    for (const entry of moduleEntries) {
      const list = surfaces.get(entry.surface) ?? []
      list.push(entry)
      surfaces.set(entry.surface, list)
    }
    const totalDurationMs = moduleEntries.reduce((sum, entry) => sum + entry.totalDurationMs, 0)
    const totalCpuMs = moduleEntries.reduce((sum, entry) => sum + entry.totalCpuUserMs + entry.totalCpuSystemMs, 0)
    const summaryBase = {
      moduleId,
      calls: moduleEntries.reduce((sum, entry) => sum + entry.calls, 0),
      errors: moduleEntries.reduce((sum, entry) => sum + entry.errors, 0),
      totalDurationMs: round(totalDurationMs),
      p95DurationMs: round(Math.max(...moduleEntries.map((entry) => entry.p95DurationMs), 0)),
      totalCpuMs: round(totalCpuMs),
      positiveHeapDeltaBytes: moduleEntries.reduce((sum, entry) => sum + entry.positiveHeapDeltaBytes, 0),
      positiveRssDeltaBytes: moduleEntries.reduce((sum, entry) => sum + entry.positiveRssDeltaBytes, 0),
      surfaces: Array.from(surfaces.entries()).map(([surface, surfaceEntries]) => ({
        surface,
        calls: surfaceEntries.reduce((sum, entry) => sum + entry.calls, 0),
        errors: surfaceEntries.reduce((sum, entry) => sum + entry.errors, 0),
        totalDurationMs: round(surfaceEntries.reduce((sum, entry) => sum + entry.totalDurationMs, 0)),
        p95DurationMs: round(Math.max(...surfaceEntries.map((entry) => entry.p95DurationMs), 0)),
        totalCpuMs: round(surfaceEntries.reduce((sum, entry) => sum + entry.totalCpuUserMs + entry.totalCpuSystemMs, 0)),
        positiveHeapDeltaBytes: surfaceEntries.reduce((sum, entry) => sum + entry.positiveHeapDeltaBytes, 0),
        positiveRssDeltaBytes: surfaceEntries.reduce((sum, entry) => sum + entry.positiveRssDeltaBytes, 0),
      })).sort((a, b) => b.totalCpuMs - a.totalCpuMs || b.totalDurationMs - a.totalDurationMs),
      topOperations: moduleEntries
        .slice()
        .sort((a, b) => (b.totalCpuUserMs + b.totalCpuSystemMs) - (a.totalCpuUserMs + a.totalCpuSystemMs) || b.totalDurationMs - a.totalDurationMs)
        .slice(0, DEFAULT_TOP_OPERATIONS_LIMIT),
    }
    moduleSummaries.push({
      ...summaryBase,
      candidateReasons: buildCandidateReasons(summaryBase, thresholds),
    })
  }

  const sortedModules = moduleSummaries.sort((a, b) =>
    b.candidateReasons.length - a.candidateReasons.length
      || b.totalCpuMs - a.totalCpuMs
      || b.totalDurationMs - a.totalDurationMs
  )

  return {
    generatedAt: new Date().toISOString(),
    startedAt: state.startedAt,
    enabled: isModuleResourceUsageEnabled(),
    bucketIntervalMs: moduleResourceUsageBucketIntervalMs(),
    totals: {
      modules: sortedModules.length,
      operations: entries.length,
      calls: entries.reduce((sum, entry) => sum + entry.calls, 0),
      errors: entries.reduce((sum, entry) => sum + entry.errors, 0),
      totalDurationMs: round(entries.reduce((sum, entry) => sum + entry.totalDurationMs, 0)),
      totalCpuMs: round(entries.reduce((sum, entry) => sum + entry.totalCpuUserMs + entry.totalCpuSystemMs, 0)),
      positiveHeapDeltaBytes: entries.reduce((sum, entry) => sum + entry.positiveHeapDeltaBytes, 0),
      positiveRssDeltaBytes: entries.reduce((sum, entry) => sum + entry.positiveRssDeltaBytes, 0),
    },
    thresholds,
    modules: sortedModules,
    candidates: sortedModules.filter((module) => module.candidateReasons.length > 0),
    buckets,
  }
}
