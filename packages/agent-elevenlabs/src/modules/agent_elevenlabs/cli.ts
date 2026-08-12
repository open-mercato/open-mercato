/**
 * `yarn mercato agent_elevenlabs configure-from-env --tenant <id> --org <id> [--force]`
 *
 * The rerunnable half of the env preconfiguration: `setup.ts` applies it once,
 * at tenant creation, and this command applies the same logic afterwards — after
 * a key rotation, or on a tenant that existed before the integration did.
 */

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyElevenLabsEnvPreset, readElevenLabsEnvPreset } from './lib/preset'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let index = 0; index < args.length; index++) {
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
  console.log(
    'Usage: yarn mercato agent_elevenlabs configure-from-env --tenant <tenantId> --org <organizationId> [--force]',
  )
  console.log('')
  console.log('Required env vars:')
  console.log('  OM_INTEGRATION_ELEVENLABS_API_KEY')
  console.log('  OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET')
  console.log('  OM_INTEGRATION_ELEVENLABS_AGENT_ID              default profile; optional if PROFILES has a "default"')
  console.log('  OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID       default profile; optional if PROFILES has a "default"')
  console.log('')
  console.log('Optional env vars:')
  console.log('  OM_INTEGRATION_ELEVENLABS_PROFILES            JSON named profiles, e.g.')
  console.log('                                               [{"name":"survey","agentId":"agent_...","phoneNumberId":"phnum_..."}]')
  console.log('  OM_INTEGRATION_ELEVENLABS_TELEPHONY_PROVIDER   twilio | sip_trunk (default twilio)')
  console.log('  OM_INTEGRATION_ELEVENLABS_DEFAULT_CALLER_ID')
  console.log('  OM_INTEGRATION_ELEVENLABS_CALL_RECORDING_ENABLED')
  console.log('  OM_INTEGRATION_ELEVENLABS_ENABLED             default false')
  console.log('  OM_INTEGRATION_ELEVENLABS_FORCE_PRECONFIGURE  default false')
  console.log('  OM_INTEGRATION_ELEVENLABS_API_BASE_URL        default https://api.elevenlabs.io')
}

const configureFromEnvCommand: ModuleCli = {
  command: 'configure-from-env',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    if (args.help === true) {
      printHelp()
      return
    }

    const tenantId = typeof args.tenant === 'string' ? args.tenant : undefined
    const organizationId = typeof args.org === 'string' ? args.org : undefined
    if (!tenantId || !organizationId) {
      printHelp()
      throw new Error('[agent_elevenlabs] --tenant and --org are required.')
    }

    if (!readElevenLabsEnvPreset()) {
      console.log('No ElevenLabs preset env variables were provided; nothing to do.')
      return
    }

    const container = await createRequestContainer()
    const result = await applyElevenLabsEnvPreset({
      credentialsService: container.resolve('integrationCredentialsService') as CredentialsService,
      integrationStateService: container.resolve('integrationStateService') as IntegrationStateService,
      integrationLogService: container.resolve('integrationLogService') as IntegrationLogService,
      scope: { tenantId, organizationId },
      force: args.force === true || args.force === 'true',
    })

    if (result.status === 'skipped') {
      console.log(`Skipped: ${result.reason}`)
      return
    }
    // Never echoes a credential value — only what was decided.
    console.log(`Configured ElevenLabs for tenant ${tenantId} (enabled: ${result.enabled}).`)
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
