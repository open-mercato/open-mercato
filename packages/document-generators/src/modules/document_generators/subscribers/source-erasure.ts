import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { templateRegistry } from '../lib/template-registry'
import { GeneratedDocumentRetentionService } from '../services/generated-document-retention-service'

const DELETED_SUFFIX = '.deleted'

const logger = createLogger('document_generators')

export const metadata = {
  event: '*',
  persistent: true,
  id: 'document_generators:source-erasure',
}

type ErasureContext = {
  eventId?: string
  eventName?: string
  resolve?: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function resolveErasedResourceKind(eventId: string | null | undefined): string | null {
  if (!eventId || !eventId.endsWith(DELETED_SUFFIX)) return null
  const resourceKind = eventId.slice(0, -DELETED_SUFFIX.length)
  if (!resourceKind || resourceKind.startsWith('document_generators.')) return null
  return templateRegistry.listTemplates({ resourceKind }).length > 0 ? resourceKind : null
}

export default async function handler(payload: Record<string, unknown>, ctx: ErasureContext): Promise<void> {
  const eventId = ctx.eventId ?? ctx.eventName ?? readString(payload.eventId)
  const resourceKind = resolveErasedResourceKind(eventId)
  if (!resourceKind) return
  const resourceId = readString(payload.id)
  const tenantId = readString(payload.tenantId)
  const organizationId = readString(payload.organizationId)
  if (!resourceId || !tenantId || !organizationId) return

  const resolve = ctx.resolve ?? (ctx.container ? ctx.container.resolve.bind(ctx.container) : null)
  if (!resolve) return

  try {
    const em = resolve<EntityManager>('em')
    const service = new GeneratedDocumentRetentionService(em)
    await service.eraseForResource({ tenantId, organizationId, resourceKind, resourceId })
  } catch (error) {
    logger.error('Failed to erase generated documents for a deleted source record', {
      err: error as Error,
      resourceKind,
      eventId,
    })
    try {
      getTelemetryRuntime()?.reportError(error, { module: 'document_generators', code: 'document_generators.source_erasure_failed' })
    } catch (telemetryError) {
      logger.error('Failed to report a source erasure error to telemetry', { err: telemetryError as Error })
    }
    throw error
  }
}
