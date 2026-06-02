import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  mapOrganizationsToScopes,
  parseCliArgs,
  resolveCliMode,
  runConfigureFromEnv,
  runConfigureFromEnvForScopes,
} from './lib/configure-from-env'

function printHelp(): void {
  console.log('Usage: yarn mercato storage_s3 configure-from-env [--tenant <tenantId> --org <organizationId> | --all-tenants] [--force]')
  console.log('')
  console.log('Modes:')
  console.log('  --tenant <id> --org <id>   Apply the preset to a single tenant + organization pair.')
  console.log('  --all-tenants              Apply the preset to every active (tenant, organization) pair.')
  console.log('                             Designed for unattended deploy hooks; per-tenant skip/force semantics still apply.')
  console.log('')
  console.log('Required env vars:')
  console.log('  OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID')
  console.log('  OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY')
  console.log('  OM_INTEGRATION_STORAGE_S3_REGION')
  console.log('  OM_INTEGRATION_STORAGE_S3_BUCKET')
  console.log('')
  console.log('Optional env vars:')
  console.log('  OM_INTEGRATION_STORAGE_S3_SESSION_TOKEN')
  console.log('  OM_INTEGRATION_STORAGE_S3_ENDPOINT')
  console.log('  OM_INTEGRATION_STORAGE_S3_FORCE_PATH_STYLE')
  console.log('  OM_INTEGRATION_STORAGE_S3_FORCE_PRECONFIGURE')
}

async function listActiveScopes(em: EntityManager): Promise<IntegrationScope[]> {
  const organizations = await findWithDecryption(
    em,
    Organization,
    { deletedAt: null, isActive: true },
    { populate: ['tenant'] },
  )
  return mapOrganizationsToScopes(organizations)
}

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const mode = resolveCliMode(parseCliArgs(rest))

    if (mode.kind === 'help') {
      printHelp()
      return
    }

    if (mode.kind === 'conflict') {
      console.error(`[storage_s3] ${mode.message}`)
      throw new Error(`Conflicting CLI arguments: ${mode.message}`)
    }

    const container = await createRequestContainer()
    try {
      const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
      const integrationLogService = container.resolve('integrationLogService') as IntegrationLogService

      if (mode.kind === 'all') {
        const em = container.resolve('em') as EntityManager
        const scopes = await listActiveScopes(em)

        if (scopes.length === 0) {
          console.log('[storage_s3] --all-tenants: no active organizations found. Nothing to do.')
          return
        }

        const summary = await runConfigureFromEnvForScopes(
          { credentialsService, integrationLogService },
          scopes,
          { force: mode.force },
        )

        for (const entry of summary.perScope) {
          const prefix = `[storage_s3] tenant=${entry.scope.tenantId} org=${entry.scope.organizationId}`
          if (entry.outcome.code === 1) {
            console.error(`${prefix} ERROR: ${entry.outcome.message}`)
          } else if (entry.outcome.status === 'skipped') {
            console.log(`${prefix} skipped: ${entry.outcome.message}`)
          } else {
            console.log(`${prefix} configured: ${entry.outcome.message}`)
          }
        }

        console.log(
          `[storage_s3] --all-tenants summary: ${summary.configured} configured, ` +
            `${summary.skipped} skipped, ${summary.errored} error(s).`,
        )

        if (summary.code === 1) {
          throw new Error(
            `--all-tenants completed with ${summary.errored} error(s) across ${scopes.length} scope(s). See per-scope errors above.`,
          )
        }
        return
      }

      const outcome = await runConfigureFromEnv(
        { credentialsService, integrationLogService },
        {
          tenantId: mode.tenantId,
          organizationId: mode.organizationId,
          force: mode.force,
        },
      )

      if (outcome.code === 0) {
        if (outcome.status === 'skipped') {
          console.log(`[storage_s3] Skipped: ${outcome.message}`)
        } else {
          console.log(`[storage_s3] ${outcome.message}`)
        }
        return
      }

      throw new Error(outcome.message)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const helpCommand: ModuleCli = {
  command: 'help',
  async run() {
    printHelp()
  },
}

export default [configureFromEnvCommand, helpCommand]
