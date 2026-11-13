import type { DecisionModelAdapter } from '@open-mercato/shared/lib/ai/decision-model'
import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createFixtureDecisionAdapter } from './decision-adapters/fixture'
import { createOpenRouterDecisionAdapter } from './decision-adapters/openrouter'

const PROVIDER_ENV = 'OM_DECISION_PROVIDER'
const MODEL_ENV = 'OM_DECISION_MODEL'
const FIXTURE_ENABLED_ENV = 'OM_DECISION_FIXTURE_ENABLED'
const FIXTURE_ADAPTER_ID = 'fixture'

/** @experimental Why no decision model adapter could be resolved. */
export type DecisionModelUnavailableReason =
  | 'not_configured'
  | 'unknown_provider'
  | 'credentials_missing'
  | 'model_missing'
  | 'fixture_disabled'

/** @experimental Outcome of resolving the active decision model adapter from env. */
export type DecisionModelResolution =
  | { ok: true; adapter: DecisionModelAdapter; modelId: string }
  | { ok: false; reason: DecisionModelUnavailableReason }

/** @experimental Pure, instance-scoped registry of decision model adapters. */
export interface DecisionModelRegistry {
  /** Registers an adapter. Idempotent by id: re-registering an id replaces the previous entry in place. */
  register(adapter: DecisionModelAdapter): void
  get(id: string): DecisionModelAdapter | undefined
  /** Registered adapters in registration order. */
  list(): DecisionModelAdapter[]
  /**
   * Resolves the adapter and model from `OM_DECISION_PROVIDER`,
   * `OM_DECISION_<MODULE>_MODEL` and `OM_DECISION_MODEL`.
   */
  resolve(input?: { moduleId?: string; env?: EnvLookup }): DecisionModelResolution
}

/** Env key of the per-module model override, e.g. `workflows` → `OM_DECISION_WORKFLOWS_MODEL`. */
export function decisionModuleModelEnvKey(moduleId: string): string {
  return `OM_DECISION_${moduleId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_MODEL`
}

/** True when the fixture adapter is opted in and the process is not running in production. */
export function isDecisionFixtureEnabled(env: EnvLookup): boolean {
  return parseBooleanToken(env[FIXTURE_ENABLED_ENV]) === true && env.NODE_ENV !== 'production'
}

function readTrimmed(env: EnvLookup, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
}

/**
 * Creates a decision model registry with its built-in adapters registered:
 * `openrouter` always, `fixture` only when `isDecisionFixtureEnabled` holds
 * for the creation env.
 *
 * @experimental
 */
export function createDecisionModelRegistry(input?: { env?: EnvLookup }): DecisionModelRegistry {
  const creationEnv = input?.env
  const adapters = new Map<string, DecisionModelAdapter>()

  const registry: DecisionModelRegistry = {
    register(adapter) {
      adapters.set(normalizeId(adapter.id), adapter)
    },
    get(id) {
      return adapters.get(normalizeId(id))
    },
    list() {
      return Array.from(adapters.values())
    },
    resolve(options) {
      const lookup = options?.env ?? creationEnv ?? process.env
      const providerId = readTrimmed(lookup, PROVIDER_ENV)
      if (!providerId) return { ok: false, reason: 'not_configured' }
      const normalizedProvider = normalizeId(providerId)
      const adapter = adapters.get(normalizedProvider)
      if (!adapter) {
        return {
          ok: false,
          reason: normalizedProvider === FIXTURE_ADAPTER_ID ? 'fixture_disabled' : 'unknown_provider',
        }
      }
      if (!adapter.isConfigured(lookup)) return { ok: false, reason: 'credentials_missing' }
      const moduleModel = options?.moduleId
        ? readTrimmed(lookup, decisionModuleModelEnvKey(options.moduleId))
        : undefined
      const modelId = moduleModel ?? readTrimmed(lookup, MODEL_ENV)
      if (!modelId) return { ok: false, reason: 'model_missing' }
      return { ok: true, adapter, modelId }
    },
  }

  registry.register(createOpenRouterDecisionAdapter())
  if (isDecisionFixtureEnabled(creationEnv ?? process.env)) {
    registry.register(createFixtureDecisionAdapter())
  }
  return registry
}
