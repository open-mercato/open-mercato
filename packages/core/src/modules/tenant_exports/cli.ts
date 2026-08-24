import { resolve } from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { TenantExitExportService } from './services/tenantExitExportService'

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (!item?.startsWith('--')) continue
    const [key, inlineValue] = item.slice(2).split('=', 2)
    if (!key) continue
    if (inlineValue !== undefined) {
      args[key] = inlineValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function requireString(args: ParsedArgs, names: string[], label: string): string {
  for (const name of names) {
    const value = args[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  throw new Error(`[internal] Missing required ${label}`)
}

const exportTenant: ModuleCli = {
  command: 'export',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = requireString(args, ['tenant', 'tenantId'], 'tenant id')
    if (!UUID_REGEX.test(tenantId)) throw new Error('[internal] Invalid tenant id')
    const actor = requireString(args, ['actor'], 'actor identifier')
    const outputPath = resolve(requireString(args, ['out', 'output'], 'output path'))
    if (!outputPath.endsWith('.tar.gz')) {
      throw new Error('[internal] Tenant export output must end with .tar.gz')
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const encryption = container.hasRegistration('tenantEncryptionService')
      ? container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
      : null
    const storage = container.hasRegistration('storageDriverFactory')
      ? container.resolve<StorageDriverFactory>('storageDriverFactory')
      : null
    const service = new TenantExitExportService({
      em,
      tenantEncryptionService: encryption,
      storageDriverFactory: storage,
    })

    const result = await service.export({
      actor,
      allowMissingAttachments: args['allow-missing-attachments'] === true,
      outputPath,
      tenantId,
    })

    console.log(`Tenant exit package created: ${result.outputPath}`)
    console.log(`Tables: ${result.tableCount}; rows: ${result.rowCount}; attachments: ${result.attachmentCount}`)
    if (result.missingAttachmentCount > 0) {
      console.log(`Missing attachments recorded in manifest: ${result.missingAttachmentCount}`)
    }
  },
}

export default [exportTenant]
