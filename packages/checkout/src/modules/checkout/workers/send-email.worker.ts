import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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

async function renderMarkdownBody(markdown: string): Promise<string> {
  try {
    const [{ default: React }, { default: ReactMarkdown }, { default: remarkGfm }, { renderToStaticMarkup }] = await Promise.all([
      import('react'),
      import('react-markdown'),
      import('remark-gfm'),
      import('react-dom/server'),
    ])
    return renderToStaticMarkup(
      React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
    )
  } catch {
    return markdown.replace(/\n/g, '<br/>')
  }
}

export default async function handle(job: QueuedJob<CheckoutEmailJob>, ctx: HandlerContext): Promise<void> {
  const { payload } = job
  const em = (ctx.resolve('em') as EntityManager).fork()

  const transaction = await findOneWithDecryption<CheckoutTransaction>(em, 'CheckoutTransaction', {
    id: payload.transactionId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
  })
  if (!transaction) return

  const email = transaction.email
  if (!email) return

  const link = await em.findOne(CheckoutLink, {
    id: transaction.linkId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
    deletedAt: null,
  })

  const firstName = transaction.firstName ?? 'Customer'
  const linkTitle = link?.title ?? link?.name ?? 'Payment'
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

  async function resolveEmailContent(
    subjectField: string | null | undefined,
    bodyField: string | null | undefined,
    defaultSubject: string,
  ): Promise<{ subject: string; bodyHtml: string | null }> {
    const subject = subjectField
      ? interpolateVariables(subjectField, variables)
      : defaultSubject
    const bodyHtml = bodyField
      ? await renderMarkdownBody(interpolateVariables(bodyField, variables))
      : null
    return { subject, bodyHtml }
  }

  if (payload.type === 'start') {
    const { subject, bodyHtml } = await resolveEmailContent(
      link?.startEmailSubject,
      link?.startEmailBody,
      `Payment initiated — ${linkTitle}`,
    )
    await sendEmail({
      to: email,
      subject,
      react: PaymentStartEmail({ firstName, amount, currencyCode, linkTitle, bodyHtml }),
    })
  } else if (payload.type === 'success') {
    const { subject, bodyHtml } = await resolveEmailContent(
      link?.successEmailSubject,
      link?.successEmailBody,
      `Payment successful — ${linkTitle}`,
    )
    await sendEmail({
      to: email,
      subject,
      react: PaymentSuccessEmail({ firstName, amount, currencyCode, linkTitle, transactionId: transaction.id, bodyHtml }),
    })
  } else if (payload.type === 'error') {
    const { subject, bodyHtml } = await resolveEmailContent(
      link?.errorEmailSubject,
      link?.errorEmailBody,
      `Payment failed — ${linkTitle}`,
    )
    await sendEmail({
      to: email,
      subject,
      react: PaymentErrorEmail({ firstName, linkTitle, errorMessage, bodyHtml }),
    })
  }
}
