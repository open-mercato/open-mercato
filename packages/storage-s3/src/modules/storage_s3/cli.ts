import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { runConfigureFromEnv } from './lib/configure-from-env'

function parseArgs(args: string[]): Record<string, string | boolean> {
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

function printHelp(): void {
  console.log('Usage: yarn mercato storage_s3 configure-from-env --tenant <tenantId> --org <organizationId> [--force]')
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

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const force = args.force === true ? true : undefined

    if (!tenantId || !organizationId) {
      printHelp()
      return
    }

    const container = await createRequestContainer()
    try {
      const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
      const integrationLogService = container.resolve('integrationLogService') as IntegrationLogService

      const outcome = await runConfigureFromEnv(
        { credentialsService, integrationLogService },
        { tenantId, organizationId, force },
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
