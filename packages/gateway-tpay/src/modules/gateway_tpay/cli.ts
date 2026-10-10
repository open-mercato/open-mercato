import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { applyTpayEnvPreset, readTpayEnvPreset } from './lib/preset'
import { syncTpayReconciliationSchedule } from './lib/reconciliation-schedule'

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
  console.log('Usage: yarn mercato gateway_tpay configure-from-env --tenant <tenantId> --org <organizationId> [--force]')
  console.log('')
  console.log('Required env vars:')
  console.log('  OM_INTEGRATION_TPAY_CLIENT_ID')
  console.log('  OM_INTEGRATION_TPAY_CLIENT_SECRET')
  console.log('')
  console.log('Optional env vars:')
  console.log('  OM_INTEGRATION_TPAY_ENVIRONMENT (sandbox|production, default sandbox)')
  console.log('  OM_INTEGRATION_TPAY_NOTIFICATION_URL')
  console.log('  OM_INTEGRATION_TPAY_NOTIFICATION_SECURITY_CODE')
  console.log('  OM_INTEGRATION_TPAY_ENABLED')
  console.log('  OM_INTEGRATION_TPAY_FORCE_PRECONFIGURE')
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

    let preset: Awaited<ReturnType<typeof readTpayEnvPreset>>
    try {
      preset = await readTpayEnvPreset()
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'gateway_tpay', code: 'gateway_tpay.preset_failed' })
      const message = error instanceof Error ? error.message : 'Unknown Tpay preset error'
      console.error(`[gateway_tpay] ${message}`)
      process.exitCode = 1
      return
    }
    if (!preset) {
      console.error('[gateway_tpay] No Tpay env preset was found.')
      printHelp()
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    try {
      const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
      const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService
      const integrationLogService = container.resolve('integrationLogService') as IntegrationLogService

      const result = await applyTpayEnvPreset({
        credentialsService,
        integrationStateService,
        integrationLogService,
        scope: { tenantId, organizationId },
        force,
      })

      if (result.status === 'skipped') {
        console.log(`[gateway_tpay] Skipped: ${result.reason}`)
        return
      }

      console.log(
        `[gateway_tpay] Tpay credentials were configured from env. enabled=${String(result.enabled)} apiVersion=${result.appliedApiVersion ?? 'default'}`,
      )

      try {
        await syncTpayReconciliationSchedule({
          container,
          scope: { tenantId, organizationId },
          enabled: result.enabled,
        })
      } catch (error) {
        getTelemetryRuntime()?.reportError(error, {
          module: 'gateway_tpay',
          code: 'gateway_tpay.reconciliation_schedule_failed',
        })
        const message = error instanceof Error ? error.message : 'Unknown Tpay reconciliation schedule error'
        console.error(`[gateway_tpay] Failed to sync the Tpay reconciliation schedule: ${message}`)
        process.exitCode = 1
      }
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'gateway_tpay', code: 'gateway_tpay.preset_failed' })
      const message = error instanceof Error ? error.message : 'Unknown Tpay preset error'
      console.error(`[gateway_tpay] ${message}`)
      process.exitCode = 1
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
