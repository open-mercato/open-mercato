import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxEmail } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

async function resolveEm() {
  const { resolve } = await createRequestContainer()
  return resolve('em') as EntityManager
}

export async function loadInboxEmailPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  if (!ctx.organizationId) {
    return { title: 'Inbox Email', subtitle: entityId }
  }

  try {
    const em = await resolveEm()
    const email = await findOneWithDecryption(
      em,
      InboxEmail,
      {
        id: entityId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )

    if (!email) {
      return { title: 'Inbox Email', subtitle: entityId, status: 'Not found', statusColor: 'gray' }
    }

    const statusColorMap: Record<string, string> = {
      received: 'blue',
      processing: 'amber',
      processed: 'green',
      needs_review: 'amber',
      failed: 'red',
    }

    return {
      title: email.subject || 'Inbox Email',
      subtitle: email.forwardedByName || email.forwardedByAddress || undefined,
      status: email.status,
      statusColor: statusColorMap[email.status] || 'gray',
      metadata: {
        ...(email.forwardedByAddress ? { from: email.forwardedByAddress } : {}),
      },
    }
  } catch {
    return { title: 'Inbox Email', subtitle: entityId }
  }
}
