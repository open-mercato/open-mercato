import type { EmailTransport, ResolvedEmailMessage } from './types'

export function createResendTransport(): EmailTransport {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  return {
    async send({ to, subject, react, from, replyTo, attachments }: ResolvedEmailMessage): Promise<void> {
      const { Resend } = await import('resend')
      const resend = new Resend(apiKey)
      const payload = {
        to,
        subject,
        from,
        react,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments?.length ? { attachments } : {}),
      }
      const result = await resend.emails.send(payload)
      const errorMessage =
        typeof (result as any)?.error === 'string'
          ? (result as any).error
          : typeof (result as any)?.error?.message === 'string'
            ? (result as any).error.message
            : null
      if (errorMessage) {
        throw new Error(`RESEND_SEND_FAILED: ${errorMessage}`)
      }
    },
  }
}
