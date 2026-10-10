import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { applyBrevoEnvPreset, readBrevoEnvPreset } from './lib/preset'

const logger = createLogger('channel_brevo').child({ component: 'cli' })

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key.includes('=')) {
      const [name, value] = key.split('=')
      result[name] = value
      continue
    }
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      index += 1
      continue
    }
    result[key] = true
  }
  return result
}

function printHelp(): void {
  console.log('Usage: yarn mercato channel_brevo configure-from-env --tenant <tenantId> --org <organizationId>')
  console.log('')
  console.log('Required env vars:')
  console.log('  SYSTEM_EMAIL_PROVIDER=brevo')
  console.log('  OM_INTEGRATION_BREVO_API_KEY')
  console.log('  OM_INTEGRATION_BREVO_FROM_ADDRESS or a shared email sender variable')
}

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      printHelp()
      throw new Error('[internal] channel_brevo configure-from-env requires --tenant and --org')
    }
    if (process.env.SYSTEM_EMAIL_PROVIDER?.trim().toLowerCase() !== 'brevo' || !readBrevoEnvPreset()) {
      printHelp()
      throw new Error('[internal] No selected Brevo env preset was found')
    }

    const container = await createRequestContainer()
    try {
      const em = container.resolve('em') as EntityManager
      await applyBrevoEnvPreset({ em, container, tenantId, organizationId })
      logger.info('Brevo credentials and system email channel configured from environment', {
        tenantId,
        organizationId,
      })
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') await disposable.dispose()
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
