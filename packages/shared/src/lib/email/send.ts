import { Resend } from 'resend'
import React from 'react'

export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
}

export async function sendEmail({ to, subject, react, from, replyTo }: SendEmailOptions) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)
  const fromAddr = from || process.env.EMAIL_FROM || 'no-reply@localhost'
  await resend.emails.send({ to, subject, from: fromAddr, react, reply_to: replyTo })
}
