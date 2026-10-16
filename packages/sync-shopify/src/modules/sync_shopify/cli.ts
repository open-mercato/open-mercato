import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyShopifyEnvPreset, readShopifyEnvPreset } from './lib/preset'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      i += 1
    } else {
      result[key] = true
    }
  }
  return result
}

function printHelp(): void {
  console.log('Usage: yarn mercato sync_shopify configure-from-env --tenant <tenantId> --org <organizationId> [--force]')
  console.log('')
  console.log('Required env vars:')
  console.log('  OM_INTEGRATION_SHOPIFY_SHOP_DOMAIN')
  console.log('  OM_INTEGRATION_SHOPIFY_CLIENT_ID')
  console.log('  OM_INTEGRATION_SHOPIFY_CLIENT_SECRET')
  console.log('')
  console.log('Optional env vars:')
  console.log('  OM_INTEGRATION_SHOPIFY_API_VERSION')
  console.log('  OM_INTEGRATION_SHOPIFY_FORCE')
}

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      printHelp()
      return
    }
    if (!readShopifyEnvPreset()) {
      console.error('[sync_shopify] No Shopify env preset was found.')
      printHelp()
      process.exitCode = 1
      return
    }
    const container = await createRequestContainer()
    try {
      const result = await applyShopifyEnvPreset({
        credentialsService: container.resolve('integrationCredentialsService') as CredentialsService,
        integrationStateService: container.resolve('integrationStateService') as IntegrationStateService,
        integrationLogService: container.resolve('integrationLogService') as IntegrationLogService,
        scope: { tenantId, organizationId },
        force: args.force === true,
      })
      if (result.status === 'skipped') {
        console.log(`[sync_shopify] Skipped: ${result.reason}`)
        return
      }
      console.log('[sync_shopify] Shopify credentials were configured from env.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Shopify preset error'
      console.error(`[sync_shopify] ${message}`)
      process.exitCode = 1
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
    }
  },
}

export default [configureFromEnvCommand, { command: 'help', async run() { printHelp() } }]
