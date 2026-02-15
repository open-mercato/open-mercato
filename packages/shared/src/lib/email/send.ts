import { Resend } from 'resend'
import React from 'react'
import { parseBooleanWithDefault } from '../boolean'

export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
}

export async function sendEmail({ to, subject, react, from, replyTo }: SendEmailOptions) {
  const emailDisabled =
    parseBooleanWithDefault(process.env.OM_DISABLE_EMAIL_DELIVERY, false) ||
    parseBooleanWithDefault(process.env.OM_TEST_MODE, false)
  if (emailDisabled) return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)
  const fromAddr = from || process.env.EMAIL_FROM || 'no-reply@localhost'
  const payload = {
    to,
    subject,
    from: fromAddr,
    react,
    ...(replyTo ? { reply_to: replyTo } : {}),
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
}
