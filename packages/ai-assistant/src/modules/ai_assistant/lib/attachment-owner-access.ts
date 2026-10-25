import type { EntityManager } from '@mikro-orm/postgresql'
import type { AttachmentAccessDestination } from '@open-mercato/core/modules/attachments/lib/access-rows'
import type { AttachmentAccessAction, AttachmentAccessRecord } from '@open-mercato/core/modules/attachments/lib/access-types'
import type { McpToolContext } from './types'

export type AttachmentOwnerAccessAction = Extract<AttachmentAccessAction, 'read' | 'metadata' | 'reassign'>

export type AttachmentOwnerAccessRow = AttachmentAccessRecord

export type AttachmentOwnerAccessDestination = AttachmentAccessDestination

export type AttachmentOwnerAccessPrincipal = Pick<McpToolContext, 'tenantId' | 'organizationId' | 'userId' | 'apiKeyId'> & {
  isSuperAdmin?: boolean
  /** Required to evaluate the principal; without it, protected rows are denied. */
  container?: McpToolContext['container']
  /** Used to load partitions when no container is available. */
  em?: EntityManager
}

type AttachmentRowAccessModule = typeof import('@open-mercato/core/modules/attachments/lib/access-rows')

async function loadAttachmentRowAccess(): Promise<AttachmentRowAccessModule> {
  return import('@open-mercato/core/modules/attachments/lib/access-rows')
}

/**
 * Applies attachment owner access policies (e.g. a Documents or inbox owner resolver)
 * to rows an AI tool or the chat attachment bridge loaded directly. Key-authenticated
 * calls are evaluated as the key; rows whose owner has no policy are returned unchanged.
 */
export async function filterAttachmentRowsByOwnerAccess<Row extends AttachmentOwnerAccessRow>(
  principal: AttachmentOwnerAccessPrincipal,
  rows: readonly Row[],
  action: AttachmentOwnerAccessAction,
  destination?: AttachmentOwnerAccessDestination,
): Promise<{ allowed: Row[]; denied: Row[] }> {
  if (rows.length === 0) return { allowed: [], denied: [] }
  const access = await loadAttachmentRowAccess()
  const auth = access.buildAttachmentAccessAuth({
    tenantId: principal.tenantId,
    organizationId: principal.organizationId,
    userId: principal.userId,
    apiKeyId: principal.apiKeyId,
    isSuperAdmin: principal.isSuperAdmin,
  })
  return access.evaluateAttachmentRowAccess({
    container: principal.container,
    em: principal.em,
    auth: principal.container ? auth : undefined,
    rows,
    action,
    destination,
  })
}
