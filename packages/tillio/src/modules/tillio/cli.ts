import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { applyTillioEnvPreset, TILLIO_ENV_VARS } from './lib/preset'
import type { TillioCredentialsService } from './lib/operators-store'

const USAGE = [
  'Usage: yarn mercato tillio configure-from-env --tenant <tenantId> --org <organizationId> [--force]',
  `Required env: ${TILLIO_ENV_VARS.apiUrl}, ${TILLIO_ENV_VARS.apiKey}`,
  `Optional env: ${TILLIO_ENV_VARS.ringostatKey} (attaches the operator), ${TILLIO_ENV_VARS.force} (overwrites existing credentials)`,
].join('\n')

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg || !arg.startsWith('--')) continue

    const [key, inlineValue] = arg.replace(/^--/, '').split('=')
    if (inlineValue !== undefined) {
      args[key] = inlineValue
      continue
    }

    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
      continue
    }

    args[key] = true
  }

  return args
}

function readScopeArg(args: Record<string, string | boolean>, keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const configureFromEnv: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = readScopeArg(args, ['tenantId', 'tenant'])
    const organizationId = readScopeArg(args, ['organizationId', 'orgId', 'org'])
    const force = args.force === true

    if (!tenantId || !organizationId) {
      console.log(USAGE)
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    try {
      console.log(`[tillio] Configuring tenant ${tenantId}, organization ${organizationId}${force ? ' (force)' : ''}.`)

      const result = await applyTillioEnvPreset({
        credentialsService: container.resolve('integrationCredentialsService') as TillioCredentialsService,
        integrationStateService: container.resolve('integrationStateService'),
        integrationHealthService: container.resolve('integrationHealthService'),
        integrationLogService: container.resolve('integrationLogService'),
        scope: { tenantId, organizationId },
        force,
      })

      if (result.status === 'skipped') {
        console.log(`[tillio] Skipped: ${result.reason}`)
        return
      }

      console.log(`[tillio] Credentials ${result.credentialsAction}, health check reported ${result.health}, operator ${result.operator}.`)
      if (result.health !== 'healthy') {
        console.log('[tillio] Fix the environment, then rerun this command to finish provisioning.')
      } else if (result.operator === 'not-requested') {
        console.log(`[tillio] Set ${TILLIO_ENV_VARS.ringostatKey} and rerun to attach the operator, or attach it in the UI.`)
      }
    } catch (error) {
      console.error(`[tillio] ${error instanceof Error ? error.message : 'Failed to apply the env preset'}`)
      process.exitCode = 1
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}

const commands: ModuleCli[] = [configureFromEnv]

export default commands
