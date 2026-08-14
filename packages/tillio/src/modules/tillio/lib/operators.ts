import { createLogger } from '@open-mercato/shared/lib/logger'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { TillioApiError } from './errors'
import { createTillioClient } from './client'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { IntegrationState } from '@open-mercato/core/modules/integrations/data/entities'
import { environmentSchema, readTenantSystemId } from './environment'
import { TILLIO_INTEGRATION_ID } from '../integration'
import {
  buildTenantDomain,
  computeEnvFingerprint,
  operatorPluginSchema,
  readOperatorsBlob,
  ringostatConfigSchema,
  saveOperatorsBlob,
  type TillioCredentialsService,
  type TillioOperatorPlugin,
  type TillioOperatorRecord,
} from './operators-store'

const logger = createLogger('tillio').child({ component: 'operators' })

export type TillioResolvedEnvironment = {
  apiUrl: string
  apiKey: string
  tenantSystemId: string
}

export const TILLIO_OPERATOR_RESOURCE_KIND = 'tillio.operator'

export type OperatorErrorSection = 'environment' | 'operator'

export class TillioEnvironmentNotReadyError extends Error {
  constructor(message = 'The Tillio environment is not ready. Save credentials and run the health check first.') {
    super(message)
    this.name = 'TillioEnvironmentNotReadyError'
  }
}

export class TillioOperatorLimitError extends Error {
  constructor(message = 'An operator is already attached. Detach it before attaching another one.') {
    super(message)
    this.name = 'TillioOperatorLimitError'
  }
}

/**
 * Raised when the operator's token could not be revoked at Tillio. The local record stays in
 * place, because dropping it would leave a live token nobody holds a handle to any more.
 * `environmentMissing` separates the two outcomes for the caller: a provider failure is worth
 * retrying, a missing environment is not — it needs the credentials fixed, or a forced detach.
 */
export class TillioRevocationFailedError extends Error {
  readonly environmentMissing: boolean

  constructor(environmentMissing: boolean, message?: string) {
    super(
      message
        ?? (environmentMissing
          ? 'The Tillio environment is no longer configured, so the operator token cannot be revoked.'
          : 'Tillio did not confirm the operator token was revoked.'),
    )
    this.name = 'TillioRevocationFailedError'
    this.environmentMissing = environmentMissing
  }
}

export function classifyTillioError(err: unknown): OperatorErrorSection {
  if (err instanceof TillioApiError) {
    if (err.status === 0 || err.status === 401 || err.status === 403) return 'environment'
  }
  return 'operator'
}

export async function resolveEnvironment(
  credentialsService: TillioCredentialsService,
  scope: IntegrationScope,
): Promise<TillioResolvedEnvironment | null> {
  const raw = await credentialsService.getRaw(TILLIO_INTEGRATION_ID, scope)
  const parsed = environmentSchema.safeParse(raw ?? {})
  if (!parsed.success) return null
  // Falls back to the legacy location until the next health check moves the identity across.
  const tenantSystemId = (await readTenantSystemId(credentialsService, scope)) ?? parsed.data.tenantSystemId
  if (!tenantSystemId) return null
  return {
    apiUrl: parsed.data.apiUrl,
    apiKey: parsed.data.apiKey,
    tenantSystemId,
  }
}

export async function isTillioEnvironmentHealthy(
  em: EntityManager,
  scope: IntegrationScope,
): Promise<boolean> {
  const state = await findOneWithDecryption(
    em,
    IntegrationState,
    {
      integrationId: TILLIO_INTEGRATION_ID,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return state?.lastHealthStatus === 'healthy'
}

function operatorIdForPlugin(plugin: TillioOperatorPlugin): string {
  return `${plugin.toLowerCase()}-1`
}

function normalizeOperatorConfig(plugin: TillioOperatorPlugin, config: Record<string, unknown>): Record<string, unknown> {
  if (plugin === 'Ringostat') return ringostatConfigSchema.parse(config)
  return config
}

export type AttachOperatorDeps = {
  credentialsService: TillioCredentialsService
  scope: IntegrationScope
  appUrl: string
}

export type AttachOperatorInput = {
  plugin: TillioOperatorPlugin
  config: Record<string, unknown>
  label?: string
}

export async function attachOperator(
  deps: AttachOperatorDeps,
  input: AttachOperatorInput,
): Promise<TillioOperatorRecord> {
  const plugin = operatorPluginSchema.parse(input.plugin)
  const config = normalizeOperatorConfig(plugin, input.config)

  const environment = await resolveEnvironment(deps.credentialsService, deps.scope)
  if (!environment) throw new TillioEnvironmentNotReadyError()

  const blob = await readOperatorsBlob(deps.credentialsService, deps.scope)
  if (blob.operators.length > 0) throw new TillioOperatorLimitError()

  const operatorId = operatorIdForPlugin(plugin)
  const tenantDomain = buildTenantDomain(deps.appUrl, environment.tenantSystemId, operatorId)
  const client = createTillioClient(environment)

  await client.validateConfig(plugin, config, tenantDomain)
  const { token } = await client.addConfig(plugin, config, tenantDomain)

  const record: TillioOperatorRecord = {
    id: operatorId,
    plugin,
    ...(input.label ? { label: input.label } : {}),
    config,
    token,
    tenantDomain,
    // Pins the operator to the environment that issued its token. If the environment is later
    // edited the pairing is stale, and comparing this fingerprint is what raises `environment_drift`
    // instead of pulling against an instance the operator never belonged to.
    envFingerprint: computeEnvFingerprint(environment),
  }

  try {
    // Re-read right before the write: the credentials store has no compare-and-set, so the
    // only thing narrowing the window between the limit check and the save is checking again
    // once the slow remote calls are behind us. A concurrent attach that got here first wins,
    // and this one is undone rather than silently overwriting the stored operator.
    const current = await readOperatorsBlob(deps.credentialsService, deps.scope)
    if (current.operators.length > 0) throw new TillioOperatorLimitError()

    await saveOperatorsBlob(deps.credentialsService, deps.scope, {
      operators: [record],
      defaultOperatorId: operatorId,
    })
  } catch (err) {
    // `addConfig` already registered this operator on Tillio's side. If we cannot persist it
    // locally we would lose the only reference to that remote config, so undo it before failing.
    await client.deleteConfig(plugin, token, tenantDomain).catch((revokeErr: unknown) => {
      logger.error('could not roll back the remote operator config', { operatorId, err: revokeErr })
    })
    throw err
  }

  return record
}

export type DetachOperatorDeps = {
  credentialsService: TillioCredentialsService
  scope: IntegrationScope
}

export type DetachOperatorOptions = {
  /**
   * Drop the local record even though the token could not be revoked. The caller has to
   * decide this explicitly, because the token stays live on Tillio's side afterwards.
   */
  force?: boolean
}

export async function detachOperator(
  deps: DetachOperatorDeps,
  operatorId: string,
  options: DetachOperatorOptions = {},
): Promise<{ ok: boolean; detached: boolean; revoked: boolean }> {
  const blob = await readOperatorsBlob(deps.credentialsService, deps.scope)
  const operator = blob.operators.find((entry) => entry.id === operatorId)
  if (!operator) return { ok: true, detached: false, revoked: false }

  const environment = await resolveEnvironment(deps.credentialsService, deps.scope)
  let revoked = false
  if (!environment) {
    if (!options.force) throw new TillioRevocationFailedError(true)
  } else {
    try {
      const client = createTillioClient(environment)
      await client.deleteConfig(operator.plugin, operator.token, operator.tenantDomain)
      revoked = true
    } catch (err) {
      if (!options.force) {
        throw new TillioRevocationFailedError(false, err instanceof Error ? err.message : undefined)
      }
    }
  }

  const remaining = blob.operators.filter((entry) => entry.id !== operatorId)
  await saveOperatorsBlob(deps.credentialsService, deps.scope, {
    operators: remaining,
    defaultOperatorId: blob.defaultOperatorId === operatorId
      ? (remaining[0]?.id ?? null)
      : blob.defaultOperatorId,
  })

  return { ok: true, detached: true, revoked }
}
