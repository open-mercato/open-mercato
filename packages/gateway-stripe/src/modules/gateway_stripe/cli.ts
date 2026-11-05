import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyStripeEnvPreset, readStripeEnvPreset } from './lib/preset'

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
  console.log('Usage: yarn mercato gateway_stripe configure-from-env --tenant <tenantId> --org <organizationId> [--force]')
  console.log('')
  console.log('Required env vars:')
  console.log('  OM_INTEGRATION_STRIPE_PUBLISHABLE_KEY')
  console.log('  OM_INTEGRATION_STRIPE_SECRET_KEY')
  console.log('  OM_INTEGRATION_STRIPE_WEBHOOK_SECRET')
  console.log('')
  console.log('Optional env vars:')
  console.log('  OM_INTEGRATION_STRIPE_API_VERSION')
  console.log('  OM_INTEGRATION_STRIPE_ENABLED')
  console.log('  OM_INTEGRATION_STRIPE_FORCE_PRECONFIGURE')
  console.log('')
  console.log('Legacy aliases still work:')
  console.log('  OPENMERCATO_STRIPE_*')
  console.log('  STRIPE_*')
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

    const preset = readStripeEnvPreset()
    if (!preset) {
      console.error('[gateway_stripe] No Stripe env preset was found.')
      printHelp()
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    try {
      const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
      const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService
      const integrationLogService = container.resolve('integrationLogService') as IntegrationLogService

      const result = await applyStripeEnvPreset({
        credentialsService,
        integrationStateService,
        integrationLogService,
        scope: { tenantId, organizationId },
        force,
      })

      if (result.status === 'skipped') {
        console.log(`[gateway_stripe] Skipped: ${result.reason}`)
        return
      }

      console.log(
        `[gateway_stripe] Stripe credentials were configured from env. enabled=${String(result.enabled)} apiVersion=${result.appliedApiVersion ?? 'default'}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Stripe preset error'
      console.error(`[gateway_stripe] ${message}`)
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
