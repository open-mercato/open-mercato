import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { z } from 'zod'
import { Attachment, AttachmentPartition } from '../data/entities'
import {
  enqueueDocumentStructureExtraction,
  type DocumentStructureQueueContainer,
} from '../lib/documentStructure/queue'

export const metadata = {
  event: 'attachments.attachment.created',
  persistent: true,
  id: 'attachments:enqueue-structure-extraction',
}

const logger = createLogger('attachments').child({ component: 'enqueue-structure-extraction' })

const payloadSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
})

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

function toQueueContainer(ctx: SubscriberContext): DocumentStructureQueueContainer {
  return {
    hasRegistration(name: string): boolean {
      try {
        return ctx.resolve(name) != null
      } catch {
        return false
      }
    },
    resolve: <T>(name: string): T => ctx.resolve<T>(name),
  }
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return
  const scope = {
    tenantId: parsed.data.tenantId ?? null,
    organizationId: parsed.data.organizationId ?? null,
  }
  if ((scope.tenantId === null) !== (scope.organizationId === null)) return
  try {
    const em = ctx.resolve<EntityManager>('em').fork()
    const attachment = await findOneWithDecryption(
      em,
      Attachment,
      { id: parsed.data.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      undefined,
      scope,
    )
    if (!attachment) return
    const partition = await findOneWithDecryption(
      em,
      AttachmentPartition,
      { code: attachment.partitionCode },
      undefined,
      scope,
    )
    if (!partition || !partition.extractDocumentStructure) return
    await enqueueDocumentStructureExtraction(toQueueContainer(ctx), {
      attachmentId: attachment.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    logger.error('Failed to enqueue document structure extraction', {
      err: error,
      attachmentId: parsed.data.id,
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'attachments',
      code: 'attachments.document_structure_enqueue_failed',
    })
  }
}
