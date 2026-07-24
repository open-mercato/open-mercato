import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { TillioApiError } from './errors'
import { createTillioClient } from './client'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { IntegrationState } from '@open-mercato/core/modules/integrations/data/entities'
import { TILLIO_INTEGRATION_ID, environmentSchema } from './environment'
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

export type TillioResolvedEnvironment = {
  apiUrl: string
  apiKey: string
  tenantSystemId: string
}

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
  if (!parsed.success || !parsed.data.tenantSystemId) return null
  return {
    apiUrl: parsed.data.apiUrl,
    apiKey: parsed.data.apiKey,
    tenantSystemId: parsed.data.tenantSystemId,
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
    await saveOperatorsBlob(deps.credentialsService, deps.scope, {
      operators: [record],
      defaultOperatorId: operatorId,
    })
  } catch (err) {
    // `addConfig` already registered this operator on Tillio's side. If we cannot persist it
    // locally we would lose the only reference to that remote config, so undo it before failing.
    await client.deleteConfig(plugin, token, tenantDomain).catch(() => undefined)
    throw err
  }

  return record
}

export type DetachOperatorDeps = {
  credentialsService: TillioCredentialsService
  scope: IntegrationScope
}

export async function detachOperator(
  deps: DetachOperatorDeps,
  operatorId: string,
): Promise<{ ok: boolean; detached: boolean }> {
  const blob = await readOperatorsBlob(deps.credentialsService, deps.scope)
  const operator = blob.operators.find((entry) => entry.id === operatorId)
  if (!operator) return { ok: true, detached: false }

  const environment = await resolveEnvironment(deps.credentialsService, deps.scope)
  if (environment) {
    const client = createTillioClient(environment)
    await client.deleteConfig(operator.plugin, operator.token, operator.tenantDomain).catch(() => undefined)
  }

  const remaining = blob.operators.filter((entry) => entry.id !== operatorId)
  await saveOperatorsBlob(deps.credentialsService, deps.scope, {
    operators: remaining,
    defaultOperatorId: blob.defaultOperatorId === operatorId
      ? (remaining[0]?.id ?? null)
      : blob.defaultOperatorId,
  })

  return { ok: true, detached: true }
}
