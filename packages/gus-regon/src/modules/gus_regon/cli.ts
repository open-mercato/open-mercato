import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { applyGusRegonEnvPreset, readGusRegonEnvPreset } from './lib/preset'

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
  console.log('Usage: yarn mercato gus_regon configure-from-env --tenant <tenantId> --org <organizationId> [--force]')
  console.log('')
  console.log('Required env vars:')
  console.log('  OM_INTEGRATION_GUS_REGON_API_KEY')
  console.log('')
  console.log('Optional env vars:')
  console.log('  OM_INTEGRATION_GUS_REGON_ENVIRONMENT (test|production, default test)')
  console.log('  OM_INTEGRATION_GUS_REGON_SHOW_ON_COMPANY_FORMS (default false)')
  console.log('  OM_INTEGRATION_GUS_REGON_ENABLED (default true)')
  console.log('  OM_INTEGRATION_GUS_REGON_FORCE_PRECONFIGURE')
}

function reportPresetError(error: unknown): void {
  getTelemetryRuntime()?.reportError(error, { module: 'gus_regon', code: 'gus_regon.preset_failed' })
  const message = error instanceof Error ? error.message : 'Unknown GUS REGON preset error'
  console.error(`[gus_regon] ${message}`)
  process.exitCode = 1
}

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const force = args.force === true

    if (!tenantId || !organizationId) {
      printHelp()
      return
    }

    let preset: ReturnType<typeof readGusRegonEnvPreset>
    try {
      preset = readGusRegonEnvPreset()
    } catch (error) {
      reportPresetError(error)
      return
    }
    if (!preset) {
      console.error('[gus_regon] No GUS REGON env preset was found.')
      printHelp()
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    try {
      const result = await applyGusRegonEnvPreset({
        credentialsService: container.resolve('integrationCredentialsService') as CredentialsService,
        integrationStateService: container.resolve('integrationStateService') as IntegrationStateService,
        integrationLogService: container.resolve('integrationLogService') as IntegrationLogService,
        scope: { tenantId, organizationId },
        force,
      })
      if (result.status === 'skipped') {
        console.log(`[gus_regon] Skipped: ${result.reason}`)
        return
      }
      console.log(`[gus_regon] GUS REGON credentials were configured from env. enabled=${String(result.enabled)}`)
    } catch (error) {
      reportPresetError(error)
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

const commands: ModuleCli[] = [configureFromEnvCommand, helpCommand]

export default commands
