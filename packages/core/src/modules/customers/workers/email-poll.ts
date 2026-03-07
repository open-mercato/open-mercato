import type { WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDealEmail } from '../data/entities'
import { emitCustomersEvent } from '../events'
import type { EmailProviderAdapter, InboundEmail } from '../lib/email/adapter'

export const metadata: WorkerMeta = {
  queue: 'customers:email-poll',
  id: 'customers-email-poll',
  concurrency: 1,
}

export default async function handler(_payload: unknown, ctx: Record<string, unknown>): Promise<void> {
  const container = ctx.container as { resolve: (key: string) => unknown }
  if (!container?.resolve) return

  let adapter: EmailProviderAdapter
  try {
    adapter = container.resolve('emailProviderAdapter') as EmailProviderAdapter
  } catch {
    return
  }

  if (!adapter.poll) return

  const em = container.resolve('em') as EntityManager

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

    const existing = await em.findOne(CustomerDealEmail, { messageId: msg.messageId })
    if (existing) continue

    let dealEmail: CustomerDealEmail | null = null
    if (msg.inReplyTo) {
      const parent = await em.findOne(CustomerDealEmail, { messageId: msg.inReplyTo })
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
