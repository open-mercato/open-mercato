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

  if (payload.type === 'start') {
    await sendEmail({
      to: email,
      subject: link?.startEmailSubject ?? `Payment initiated — ${linkTitle}`,
      react: PaymentStartEmail({ firstName, amount, currencyCode, linkTitle }),
    })
  } else if (payload.type === 'success') {
    await sendEmail({
      to: email,
      subject: link?.successEmailSubject ?? `Payment successful — ${linkTitle}`,
      react: PaymentSuccessEmail({ firstName, amount, currencyCode, linkTitle, transactionId: transaction.id }),
    })
  } else if (payload.type === 'error') {
    await sendEmail({
      to: email,
      subject: link?.errorEmailSubject ?? `Payment failed — ${linkTitle}`,
      react: PaymentErrorEmail({ firstName, linkTitle, errorMessage: payload.errorMessage }),
    })
  }
}
