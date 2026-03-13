import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDealEmail } from '../data/entities'
import { emitCustomersEvent } from '../events'
import type { EmailProviderAdapter, InboundEmail } from '../lib/email/adapter'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata: WorkerMeta = {
  queue: 'customers:email-poll',
  id: 'customers-email-poll',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

interface EmailPollJobPayload {
  tenantId: string
  organizationId: string
}

export default async function handler(job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const payload = job.payload as EmailPollJobPayload

  if (!payload?.tenantId || !payload?.organizationId) {
    console.warn('[customers.email-poll] Missing tenantId or organizationId in job payload, skipping')
    return
  }

  const decryptionScope = { tenantId: payload.tenantId, organizationId: payload.organizationId }

  let adapter: EmailProviderAdapter
  try {
    adapter = ctx.resolve<EmailProviderAdapter>('emailProviderAdapter')
  } catch {
    return
  }

  if (!adapter.poll) return

  const em = ctx.resolve<EntityManager>('em')

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
  let inbound: InboundEmail[]
  try {
    inbound = await adapter.poll(fiveMinutesAgo)
  } catch (err) {
    console.warn('[customers.email-poll] Failed to poll emails:', err)
    return
  }

  if (!inbound.length) return

  for (const msg of inbound) {
    if (!msg.messageId) continue

    const existing = await findOneWithDecryption(
      em,
      CustomerDealEmail,
      { messageId: msg.messageId, organizationId: payload.organizationId, tenantId: payload.tenantId },
      {},
      decryptionScope,
    )
    if (existing) continue

    let dealEmail: CustomerDealEmail | null = null
    if (msg.inReplyTo) {
      const parent = await findOneWithDecryption(
        em,
        CustomerDealEmail,
        { messageId: msg.inReplyTo, organizationId: payload.organizationId, tenantId: payload.tenantId },
        {},
        decryptionScope,
      )
      if (parent) {
        dealEmail = em.create(CustomerDealEmail, {
          organizationId: parent.organizationId,
          tenantId: parent.tenantId,
          dealId: parent.dealId,
          threadId: msg.threadId ?? parent.threadId ?? null,
          messageId: msg.messageId,
          inReplyTo: msg.inReplyTo,
          direction: 'inbound',
          fromAddress: msg.from.email,
          fromName: msg.from.name ?? null,
          toAddresses: msg.to,
          ccAddresses: msg.cc ?? [],
          subject: msg.subject,
          bodyText: msg.bodyText ?? null,
          bodyHtml: msg.bodyHtml ?? null,
          sentAt: msg.sentAt,
          provider: adapter.provider,
          providerMessageId: msg.providerMessageId ?? null,
          providerMetadata: msg.providerMetadata ?? null,
          hasAttachments: msg.hasAttachments,
          isRead: false,
        })
      }
    }

    if (!dealEmail) continue

    await em.flush()

    await emitCustomersEvent('customers.deal.email.received', {
      id: dealEmail.id,
      dealId: dealEmail.dealId,
      organizationId: dealEmail.organizationId,
      tenantId: dealEmail.tenantId,
      subject: dealEmail.subject,
      direction: 'inbound',
    })
  }
}
