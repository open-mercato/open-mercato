import { cliLogger } from '@open-mercato/cli/lib/helpers'
const logger = cliLogger.forModule('core')
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
const logger = cliLogger.forModule('core')
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from './data/entities'
const logger = cliLogger.forModule('core')
import { deletePartitionFile } from './lib/storage'

type ParsedArgs = Record<string, string | boolean>
const logger = cliLogger.forModule('core')

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part || !part.startsWith('--')) continue
    const [rawKey, rawValue] = part.replace(/^--/, '').split('=')
    const key = rawKey.trim()
    if (!key) continue
    if (rawValue !== undefined) {
      args[key] = rawValue
      continue
    }
    const next = rest[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function coerceIdList(value?: string | boolean): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const deleteAttachments: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'delete',
  async run(rest) {
    const args = parseArgs(rest)
    const ids = new Set<string>()
    coerceIdList(args.id).forEach((id) => ids.add(id))
    coerceIdList(args.ids).forEach((id) => ids.add(id))

    if (ids.size === 0) {
      logger.error('Usage: mercato attachments delete --id <attachmentId> [--ids id1,id2] [--org <organizationId>] [--tenant <tenantId>]')
      return
    }
    const organizationId =
      typeof args.org === 'string'
        ? args.org
        : typeof args.organizationId === 'string'
          ? args.organizationId
          : undefined
    const tenantId =
      typeof args.tenant === 'string'
        ? args.tenant
        : typeof args.tenantId === 'string'
          ? args.tenantId
          : undefined

    try {
      const container = await createRequestContainer()
      const em = container.resolve<EntityManager>('em')
      const idList = Array.from(ids)
      const where: Record<string, unknown> = { id: { $in: idList } }
      if (organizationId) where.organizationId = organizationId
      if (tenantId) where.tenantId = tenantId
      const attachments = await em.find(Attachment, where)
      if (!attachments.length) {
        logger.info('No attachments matched the provided filters.')
        return
      }
      const removedIds = new Set<string>()
      for (const entry of attachments) {
        await deletePartitionFile(entry.partitionCode, entry.storagePath, entry.storageDriver)
        em.remove(entry)
        removedIds.add(entry.id)
        logger.info(`Deleted attachment ${entry.id}${entry.fileName ? ` (${entry.fileName})` : ''}`)
      }
      await em.flush()
      const missing = idList.filter((id) => !removedIds.has(id))
      if (missing.length > 0) {
        logger.info(`Not found: ${missing.join(', ')}`)
      }
    } catch (err) {
      logger.error('[attachments] delete command failed:', err)
    }
  },
}

export default [deleteAttachments]
