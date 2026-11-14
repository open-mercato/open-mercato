import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  TRACE_CAPTURE_LEVELS,
  traceCapturePolicySchema,
  type TraceCapturePolicy,
} from '../../data/validators'
import type { RunManifestCapture, RunManifestCaptureLevel } from './runManifest'

const logger = createLogger('agent_orchestrator').child({ component: 'trace-capture-policy' })

export const TRACE_CAPTURE_CONFIG_MODULE = 'agent_orchestrator'
export const TRACE_CAPTURE_CONFIG_NAME = 'trace_capture_policy'

export const TRACE_CONTENT_DEFAULT_ENV = 'OM_AGENT_TRACE_CONTENT_DEFAULT'
export const TRACE_CONTENT_MAX_ENV = 'OM_AGENT_TRACE_CONTENT_MAX'

const DEPLOYMENT_DEFAULT_FALLBACK: RunManifestCaptureLevel = 'metadata'
const DEPLOYMENT_CEILING_FALLBACK: RunManifestCaptureLevel = 'full'

const LEVEL_RANK: Record<RunManifestCaptureLevel, number> = { off: 0, metadata: 1, full: 2 }

export const DEFAULT_TRACE_CAPTURE_POLICY: TraceCapturePolicy = traceCapturePolicySchema.parse({})

export type TraceCapturePolicySource = 'tenant' | 'default'

export type TraceCaptureRunSource = 'runtime' | 'eval'

type EnvLike = Record<string, string | undefined>

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown; source?: string; updatedAt?: string } | null>
}

const warnedEnvValues = new Set<string>()

function isCaptureLevel(value: string): value is RunManifestCaptureLevel {
  return (TRACE_CAPTURE_LEVELS as readonly string[]).includes(value)
}

function readLevelEnv(
  env: EnvLike,
  name: string,
  fallback: RunManifestCaptureLevel,
): RunManifestCaptureLevel {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const normalized = raw.trim().toLowerCase()
  if (isCaptureLevel(normalized)) return normalized
  const warnKey = `${name}=${raw}`
  if (!warnedEnvValues.has(warnKey)) {
    warnedEnvValues.add(warnKey)
    logger.warn('unrecognized trace capture level in environment; using the fallback', {
      variable: name,
      fallback,
    })
  }
  return fallback
}

/**
 * The deployment-wide capture level a run gets when neither the agent nor the
 * tenant decided anything (`OM_AGENT_TRACE_CONTENT_DEFAULT`, default `metadata`).
 * An unrecognized value reads as `metadata`, never as a looser level.
 */
export function resolveDeploymentCaptureDefault(env: EnvLike = process.env): RunManifestCaptureLevel {
  return readLevelEnv(env, TRACE_CONTENT_DEFAULT_ENV, DEPLOYMENT_DEFAULT_FALLBACK)
}

/**
 * The deployment ceiling (`OM_AGENT_TRACE_CONTENT_MAX`, default `full`). Every
 * resolved level is clamped to it, so `metadata` forbids content capture
 * everywhere regardless of tenant or per-agent settings.
 */
export function resolveDeploymentCaptureCeiling(env: EnvLike = process.env): RunManifestCaptureLevel {
  return readLevelEnv(env, TRACE_CONTENT_MAX_ENV, DEPLOYMENT_CEILING_FALLBACK)
}

function resolveModuleConfig(container: AwilixContainer): ModuleConfigServiceLike | null {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return null
  }
}

export type StoredTraceCapturePolicy = {
  policy: TraceCapturePolicy
  source: TraceCapturePolicySource
  updatedAt: string | null
}

/**
 * The tenant's stored capture policy, whether it actually saved one, and the
 * tenant row's `updatedAt` (the optimistic-lock version; `null` when the
 * tenant has no row of its own).
 *
 * Every failure arm — no config store, no record, a cleared (`null`) value, a
 * malformed or unreadable record — reports `'default'`, which
 * `resolveCaptureLevel` reads as "use the deployment default", never as a
 * looser level.
 */
export async function readTraceCapturePolicy(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<StoredTraceCapturePolicy> {
  const fallback = (updatedAt: string | null = null): StoredTraceCapturePolicy => ({
    policy: DEFAULT_TRACE_CAPTURE_POLICY,
    source: 'default',
    updatedAt,
  })
  const service = resolveModuleConfig(container)
  if (!service) return fallback()
  try {
    const record = await service.getRecord(TRACE_CAPTURE_CONFIG_MODULE, TRACE_CAPTURE_CONFIG_NAME, {
      tenantId,
    })
    if (!record) return fallback()
    const updatedAt =
      record.source !== 'instance' && typeof record.updatedAt === 'string' ? record.updatedAt : null
    if (record.value === null || record.value === undefined) return fallback(updatedAt)
    const parsed = traceCapturePolicySchema.safeParse(record.value)
    if (!parsed.success) {
      logger.warn('stored trace capture policy is malformed; using the deployment default', {
        tenantId,
      })
      return fallback(updatedAt)
    }
    return { policy: parsed.data, source: 'tenant', updatedAt }
  } catch (error) {
    logger.warn('trace capture policy unreadable; using the deployment default', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback()
  }
}

function isOverrideActive(until: string | undefined, now: Date): boolean {
  if (!until) return true
  const expiresAt = Date.parse(until)
  if (Number.isNaN(expiresAt)) return false
  return expiresAt > now.getTime()
}

export type ResolveCaptureLevelInput = {
  policy: TraceCapturePolicy
  policySource: TraceCapturePolicySource
  agentId: string
  runSource?: TraceCaptureRunSource
  now?: Date
  env?: EnvLike
}

/**
 * The capture level for one run, most specific first: an unexpired per-agent
 * override (`agent`), then the tenant's `evalLevel` for eval runs or `level`
 * otherwise (`tenant`), then the deployment default (`deployment`). The result
 * is clamped to the deployment ceiling; a clamped level reports `deployment`
 * because the ceiling is what decided it.
 */
export function resolveCaptureLevel(input: ResolveCaptureLevelInput): RunManifestCapture {
  const env = input.env ?? process.env
  const now = input.now ?? new Date()
  const { policy } = input
  const tenantDecided = input.policySource === 'tenant'

  let level: RunManifestCaptureLevel = resolveDeploymentCaptureDefault(env)
  let source: RunManifestCapture['source'] = 'deployment'

  const override = tenantDecided ? policy.perAgent[input.agentId] : undefined
  if (override && isOverrideActive(override.until, now)) {
    level = override.level
    source = 'agent'
  } else if (tenantDecided) {
    level = input.runSource === 'eval' ? policy.evalLevel ?? policy.level : policy.level
    source = 'tenant'
  }

  const ceiling = resolveDeploymentCaptureCeiling(env)
  if (LEVEL_RANK[level] > LEVEL_RANK[ceiling]) {
    level = ceiling
    source = 'deployment'
  }

  return {
    level,
    source,
    retentionDays: policy.retentionDays,
    redactPii: policy.redactPii,
  }
}

/**
 * The capture a run falls back to when the policy cannot be resolved: metadata
 * only, decided by the deployment. Never a looser level than the default.
 */
export function fallbackRunCapture(): RunManifestCapture {
  return {
    level: DEPLOYMENT_DEFAULT_FALLBACK,
    source: 'deployment',
    retentionDays: DEFAULT_TRACE_CAPTURE_POLICY.retentionDays,
    redactPii: DEFAULT_TRACE_CAPTURE_POLICY.redactPii,
  }
}

export type ResolveRunCaptureInput = {
  tenantId: string | null
  agentId: string
  runSource?: TraceCaptureRunSource
  now?: Date
  env?: EnvLike
}

/**
 * Reads the tenant policy and resolves one run's capture level. Never throws:
 * any failure logs, reports, and yields {@link fallbackRunCapture} so a policy
 * problem can never fail a run.
 */
export async function resolveRunCapture(
  container: AwilixContainer,
  input: ResolveRunCaptureInput,
): Promise<RunManifestCapture> {
  try {
    const { policy, source } = await readTraceCapturePolicy(container, input.tenantId)
    return resolveCaptureLevel({
      policy,
      policySource: source,
      agentId: input.agentId,
      runSource: input.runSource,
      now: input.now,
      env: input.env,
    })
  } catch (error) {
    logger.warn('trace capture policy resolution failed; using metadata capture', {
      agentId: input.agentId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'trace_capture_policy_resolve_failed',
      attributes: { agentId: input.agentId },
    })
    return fallbackRunCapture()
  }
}
