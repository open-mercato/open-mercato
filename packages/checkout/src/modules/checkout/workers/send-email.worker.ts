import type { EntityManager } from '@mikro-orm/postgresql'
import { DEFAULT_NOTIFICATION_DELIVERY_CONFIG, resolveNotificationDeliveryConfig } from '@open-mercato/core/modules/notifications/lib/deliveryConfig'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CheckoutTransaction, CheckoutLink } from '../data/entities'
import PaymentStartEmail from '../emails/PaymentStartEmail'
import PaymentSuccessEmail from '../emails/PaymentSuccessEmail'
import PaymentErrorEmail from '../emails/PaymentErrorEmail'

export const CHECKOUT_EMAIL_QUEUE = 'checkout-email'

export type CheckoutEmailJob =
  | { type: 'start'; transactionId: string; tenantId: string; organizationId: string }
  | { type: 'success'; transactionId: string; tenantId: string; organizationId: string }
  | { type: 'error'; transactionId: string; tenantId: string; organizationId: string; errorMessage?: string | null }

export const metadata: WorkerMeta = {
  queue: CHECKOUT_EMAIL_QUEUE,
  id: 'checkout:send-email',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

function interpolateVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => variables[key] ?? match)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value: string): string {
  let rendered = escapeHtml(value)
  rendered = rendered.replace(/`([^`]+)`/g, '<code>$1</code>')
  rendered = rendered.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  rendered = rendered.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  rendered = rendered.replace(/(^|[\s(])\*([^*]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  rendered = rendered.replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  return rendered
}

function renderParagraph(lines: string[]): string {
  return `<p>${renderInlineMarkdown(lines.join(' '))}</p>`
}

function renderMarkdownBody(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''

  const blocks: string[] = []
  const lines = normalized.split('\n')
  let paragraph: string[] = []
  let listItems: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(renderParagraph(paragraph))
    paragraph = []
  }

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`)
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`)
      continue
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(line)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1])
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()

  return blocks.join('')
}

export default async function handle(job: QueuedJob<CheckoutEmailJob>, ctx: HandlerContext): Promise<void> {
  const { payload } = job
  const em = (ctx.resolve('em') as EntityManager).fork()
  const { t } = await resolveTranslations()

  const transaction = await findOneWithDecryption<CheckoutTransaction>(em, 'CheckoutTransaction', {
    id: payload.transactionId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
  })
  if (!transaction) return

  const email = transaction.email
  if (!email) return

  const link = await findOneWithDecryption(em, CheckoutLink, {
    id: transaction.linkId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
    deletedAt: null,
  }, undefined, { organizationId: payload.organizationId, tenantId: payload.tenantId })

  const firstName = transaction.firstName ?? t('checkout.systemEmails.common.customerFallback')
  const linkTitle = link?.title ?? link?.name ?? t('checkout.systemEmails.common.linkTitleFallback')
  const amount = String(transaction.amount ?? '0.00')
  const currencyCode = transaction.currencyCode ?? ''
  const errorMessage = payload.type === 'error' ? (payload.errorMessage ?? null) : null

  const variables: Record<string, string> = {
    firstName,
    amount,
    currencyCode,
    linkTitle,
    transactionId: transaction.id,
    errorMessage: errorMessage ?? '',
  }
  const deliveryConfig = await resolveNotificationDeliveryConfig(ctx, {
    defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
  })
  const from = deliveryConfig.strategies.email.from
  const replyTo = deliveryConfig.strategies.email.replyTo

  async function resolveEmailContent(
    subjectField: string | null | undefined,
    bodyField: string | null | undefined,
    defaultSubject: string,
  ): Promise<{ subject: string; bodyHtml: string | null }> {
    const subject = subjectField
      ? interpolateVariables(subjectField, variables)
      : defaultSubject
    const bodyHtml = bodyField
      ? renderMarkdownBody(interpolateVariables(bodyField, variables))
      : null
    return { subject, bodyHtml }
  }

  if (payload.type === 'start') {
    if (link?.sendStartEmail === false) return
    const { subject, bodyHtml } = await resolveEmailContent(
      link?.startEmailSubject,
      link?.startEmailBody,
      t('checkout.systemEmails.start.subject', 'Payment initiated - {linkTitle}', { linkTitle }),
    )
    await sendEmail({
      to: email,
      subject,
      from,
      replyTo,
      react: PaymentStartEmail({
        firstName,
        amount,
        currencyCode,
        linkTitle,
        bodyHtml,
        copy: {
          title: t('checkout.systemEmails.start.title'),
          preview: t('checkout.systemEmails.start.preview', { amount, currencyCode }),
          greeting: t('checkout.systemEmails.start.greeting', { firstName, linkTitle }),
          message: t('checkout.systemEmails.start.message'),
          hint: t('checkout.systemEmails.start.hint'),
        },
      }),
    })
  } else if (payload.type === 'success') {
    if (link?.sendSuccessEmail === false) return
    const { subject, bodyHtml } = await resolveEmailContent(
      link?.successEmailSubject,
      link?.successEmailBody,
      t('checkout.systemEmails.success.subject', 'Payment successful - {linkTitle}', { linkTitle }),
    )
    await sendEmail({
      to: email,
      subject,
      from,
      replyTo,
      react: PaymentSuccessEmail({
        firstName,
        amount,
        currencyCode,
        linkTitle,
        transactionId: transaction.id,
        bodyHtml,
        copy: {
          title: t('checkout.systemEmails.success.title'),
          preview: t('checkout.systemEmails.success.preview', { amount, currencyCode }),
          greeting: t('checkout.systemEmails.success.greeting', { firstName, linkTitle }),
          receipt: t('checkout.systemEmails.success.receipt'),
          hint: t('checkout.systemEmails.success.hint'),
          transactionLabel: t('checkout.systemEmails.success.transactionLabel'),
        },
      }),
    })
  } else if (payload.type === 'error') {
    if (link?.sendErrorEmail === false) return
    const { subject, bodyHtml } = await resolveEmailContent(
      link?.errorEmailSubject,
      link?.errorEmailBody,
      t('checkout.systemEmails.error.subject', 'Payment failed - {linkTitle}', { linkTitle }),
    )
    await sendEmail({
      to: email,
      subject,
      from,
      replyTo,
      react: PaymentErrorEmail({
        firstName,
        linkTitle,
        errorMessage,
        bodyHtml,
        copy: {
          title: t('checkout.systemEmails.error.title'),
          preview: t('checkout.systemEmails.error.preview', { linkTitle }),
          greeting: t('checkout.systemEmails.error.greeting', { firstName, linkTitle }),
          retry: t('checkout.systemEmails.error.retry'),
          hint: t('checkout.systemEmails.error.hint'),
        },
      }),
    })
  }
}
