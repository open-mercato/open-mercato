import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { applyS3EnvPreset, readS3EnvPreset } from './preset'

export type ConfigureFromEnvDeps = {
  credentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  env?: NodeJS.ProcessEnv
}

export type ConfigureFromEnvOptions = {
  tenantId: string
  organizationId: string
  force?: boolean
}

export type ConfigureFromEnvOutcome =
  | { code: 0; status: 'configured' | 'skipped'; message: string }
  | { code: 1; status: 'error'; message: string }

export async function runConfigureFromEnv(
  deps: ConfigureFromEnvDeps,
  options: ConfigureFromEnvOptions,
): Promise<ConfigureFromEnvOutcome> {
  try {
    const preset = readS3EnvPreset(deps.env ?? process.env)
    if (!preset) {
      return {
        code: 0,
        status: 'skipped',
        message: 'No S3 env preset was found. Set OM_INTEGRATION_STORAGE_S3_* variables to enable preconfiguration.',
      }
    }

    const result = await applyS3EnvPreset({
      credentialsService: deps.credentialsService,
      integrationLogService: deps.integrationLogService,
      scope: { tenantId: options.tenantId, organizationId: options.organizationId },
      force: options.force,
      env: deps.env ?? process.env,
    })

    if (result.status === 'skipped') {
      return { code: 0, status: 'skipped', message: result.reason }
    }

    return { code: 0, status: 'configured', message: 'S3 credentials were configured from env.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown S3 preset error'
    return { code: 1, status: 'error', message }
  }
}

export type ConfigureFromEnvScopeOutcome = {
  scope: IntegrationScope
  outcome: ConfigureFromEnvOutcome
}

export type ConfigureFromEnvAllOutcome = {
  code: 0 | 1
  configured: number
  skipped: number
  errored: number
  perScope: ConfigureFromEnvScopeOutcome[]
}

export async function runConfigureFromEnvForScopes(
  deps: ConfigureFromEnvDeps,
  scopes: IntegrationScope[],
  options: { force?: boolean } = {},
): Promise<ConfigureFromEnvAllOutcome> {
  const perScope: ConfigureFromEnvScopeOutcome[] = []
  let configured = 0
  let skipped = 0
  let errored = 0

  for (const scope of scopes) {
    const outcome = await runConfigureFromEnv(deps, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      force: options.force,
    })
    perScope.push({ scope, outcome })
    if (outcome.code === 1) errored += 1
    else if (outcome.status === 'configured') configured += 1
    else skipped += 1
  }

  const code: 0 | 1 = errored > 0 ? 1 : 0
  return { code, configured, skipped, errored, perScope }
}

export function parseCliArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue

    const key = arg.slice(2)
    if (key.includes('=')) {
      const [name, value] = key.split('=')
      result[name] = value
      continue
    }

    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      i += 1
      continue
    }

    result[key] = true
  }

  return result
}

export type ConfigureFromEnvCliMode =
  | { kind: 'help' }
  | { kind: 'conflict'; message: string }
  | { kind: 'all'; force?: boolean }
  | { kind: 'single'; tenantId: string; organizationId: string; force?: boolean }

export function resolveCliMode(args: Record<string, string | boolean>): ConfigureFromEnvCliMode {
  const allTenants = args['all-tenants'] === true || args.allTenants === true
  const tenantId = String(args.tenantId ?? args.tenant ?? '')
  const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
  const force = args.force === true ? true : undefined

  if (allTenants && (tenantId || organizationId)) {
    return {
      kind: 'conflict',
      message: '--all-tenants cannot be combined with --tenant or --org. Pick one mode.',
    }
  }

  if (allTenants) {
    return { kind: 'all', force }
  }

  if (!tenantId || !organizationId) {
    return { kind: 'help' }
  }

  return { kind: 'single', tenantId, organizationId, force }
}

type OrganizationRow = {
  id: string
  tenant?: { id?: string | null } | null
}

export function mapOrganizationsToScopes(organizations: OrganizationRow[]): IntegrationScope[] {
  const scopes: IntegrationScope[] = []
  for (const organization of organizations) {
    const tenantId = organization.tenant?.id
    if (!tenantId) continue
    scopes.push({ tenantId, organizationId: organization.id })
  }
  return scopes
}
