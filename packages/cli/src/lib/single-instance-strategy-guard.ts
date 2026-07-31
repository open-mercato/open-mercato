import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { resolveQueueStrategy } from '@open-mercato/queue'

/**
 * Boot-time guard that refuses to start (or warns) when an infrastructure
 * strategy that is only safe for a single process/instance is configured under
 * a declared multi-instance topology.
 *
 * Background: `CACHE_STRATEGY`, `RATE_LIMIT_STRATEGY` and `QUEUE_STRATEGY` all
 * default to single-instance modes (`memory`/`memory`/`local`). Running more
 * than one app instance against those defaults silently breaks three
 * correctness invariants at once — stale RBAC caches after a privilege
 * revocation, rate limits multiplied by the instance count, and duplicate job
 * processing from the leaderless local file queue. None of them warn.
 *
 * Only strategies that coordinate across processes via shared external state
 * are considered multi-instance safe. Everything else (the in-process memory
 * strategies, the local file queue, and disk-backed caches that are not shared
 * across hosts) is treated as single-instance.
 */
const MULTI_INSTANCE_SAFE_STRATEGIES = {
  cache: ['redis'],
  queue: ['async'],
  rateLimit: ['redis'],
} as const

export type SingleInstanceGuardComponent = 'cache' | 'queue' | 'rateLimit'

export type SingleInstanceGuardOffender = {
  component: SingleInstanceGuardComponent
  envVar: string
  configured: string
  safeValues: readonly string[]
}

export type SingleInstanceGuardAction = 'ok' | 'warn' | 'fail'

export type SingleInstanceGuardResult = {
  action: SingleInstanceGuardAction
  offenders: SingleInstanceGuardOffender[]
  production: boolean
  multiInstance: boolean
  overridden: boolean
}

export type InfraStrategySnapshot = {
  cacheStrategy: string
  queueStrategy: string
  rateLimitStrategy: string
}

const COMPONENT_ENV_VARS: Record<SingleInstanceGuardComponent, string> = {
  cache: 'CACHE_STRATEGY',
  queue: 'QUEUE_STRATEGY',
  rateLimit: 'RATE_LIMIT_STRATEGY',
}

export class SingleInstanceStrategyError extends Error {
  readonly offenders: SingleInstanceGuardOffender[]

  constructor(result: SingleInstanceGuardResult) {
    super(
      `Refusing to start: single-instance infrastructure strategies (${result.offenders
        .map((offender) => `${offender.envVar}=${offender.configured}`)
        .join(', ')}) are configured under a declared multi-instance topology. ` +
        'Switch to a multi-instance-safe strategy or set OM_ALLOW_SINGLE_INSTANCE_STRATEGIES=1 to override.',
    )
    this.name = 'SingleInstanceStrategyError'
    this.offenders = result.offenders
  }
}

/**
 * Read the configured infrastructure strategies. Queue resolution reuses the
 * canonical `resolveQueueStrategy()` so the default stays single-sourced; cache
 * and rate-limit values are read directly with their documented defaults
 * (`packages/cache/src/service.ts`, `packages/shared/src/lib/ratelimit/config.ts`)
 * because the guard's safe-set policy — not the resolver default — decides what
 * counts as single-instance.
 */
export function readInfraStrategySnapshot(env: NodeJS.ProcessEnv = process.env): InfraStrategySnapshot {
  return {
    cacheStrategy: env.CACHE_STRATEGY?.trim() || 'memory',
    queueStrategy: resolveQueueStrategy(),
    rateLimitStrategy: env.RATE_LIMIT_STRATEGY?.trim() || 'memory',
  }
}

function resolveMultiInstanceHint(env: NodeJS.ProcessEnv): boolean {
  if (parseBooleanWithDefault(env.OM_MULTI_INSTANCE, false)) return true
  const instanceCount = Number.parseInt(env.OM_INSTANCE_COUNT ?? '', 10)
  return Number.isFinite(instanceCount) && instanceCount > 1
}

export function evaluateSingleInstanceGuard(
  snapshot: InfraStrategySnapshot,
  env: NodeJS.ProcessEnv = process.env,
): SingleInstanceGuardResult {
  const configured: Record<SingleInstanceGuardComponent, string> = {
    cache: snapshot.cacheStrategy,
    queue: snapshot.queueStrategy,
    rateLimit: snapshot.rateLimitStrategy,
  }

  const offenders: SingleInstanceGuardOffender[] = []
  for (const component of Object.keys(configured) as SingleInstanceGuardComponent[]) {
    const safeValues: readonly string[] = MULTI_INSTANCE_SAFE_STRATEGIES[component]
    if (!safeValues.includes(configured[component])) {
      offenders.push({
        component,
        envVar: COMPONENT_ENV_VARS[component],
        configured: configured[component],
        safeValues,
      })
    }
  }

  const production = (env.NODE_ENV ?? '').trim() === 'production'
  const multiInstance = resolveMultiInstanceHint(env)
  const overridden = parseBooleanWithDefault(env.OM_ALLOW_SINGLE_INSTANCE_STRATEGIES, false)

  let action: SingleInstanceGuardAction = 'ok'
  if (offenders.length > 0 && production) {
    action = multiInstance && !overridden ? 'fail' : 'warn'
  }

  return { action, offenders, production, multiInstance, overridden }
}

export function formatSingleInstanceGuardMessage(result: SingleInstanceGuardResult): string[] {
  const offenderLines = result.offenders.map(
    (offender) =>
      `  - ${offender.envVar}=${offender.configured} (multi-instance-safe: ${offender.safeValues.join(', ')})`,
  )
  const header =
    result.action === 'fail'
      ? '[server] Refusing to start: single-instance infrastructure strategies under a multi-instance topology.'
      : '[server] WARNING: single-instance infrastructure strategies detected in production.'
  const guidance =
    result.action === 'fail'
      ? '[server] Switch each strategy above to a multi-instance-safe value, or set OM_ALLOW_SINGLE_INSTANCE_STRATEGIES=1 to override (accepting duplicate jobs, stale ACLs, and weakened rate limits).'
      : result.multiInstance
        ? '[server] OM_ALLOW_SINGLE_INSTANCE_STRATEGIES=1 is set — proceeding despite the risks above (duplicate jobs, stale ACLs, weakened rate limits).'
        : '[server] Running multiple instances against these strategies will cause duplicate jobs, stale ACLs, and weakened rate limits. Set OM_MULTI_INSTANCE=1 to make this a hard failure once you scale out.'
  return [header, ...offenderLines, guidance]
}

export type SingleInstanceGuardLogger = Pick<Console, 'warn' | 'error'>

/**
 * Evaluate the guard and enforce it: throw on `fail`, log prominently on
 * `warn`, and stay silent on `ok`. Safe to call on every `start`; it never
 * fires for dev boots or single-instance production deployments.
 */
export function assertSingleInstanceStrategies(
  env: NodeJS.ProcessEnv = process.env,
  options?: { snapshot?: InfraStrategySnapshot; logger?: SingleInstanceGuardLogger },
): SingleInstanceGuardResult {
  const snapshot = options?.snapshot ?? readInfraStrategySnapshot(env)
  const result = evaluateSingleInstanceGuard(snapshot, env)
  const logger = options?.logger ?? console

  if (result.action === 'fail') {
    for (const line of formatSingleInstanceGuardMessage(result)) logger.error(line)
    throw new SingleInstanceStrategyError(result)
  }
  if (result.action === 'warn') {
    for (const line of formatSingleInstanceGuardMessage(result)) logger.warn(line)
  }

  return result
}
