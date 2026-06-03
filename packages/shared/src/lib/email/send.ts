import { Resend } from 'resend'
import React from 'react'
import type { TransportOptions } from 'nodemailer'
import {
  resolveAwsSesRegion,
  resolveDefaultEmailFromAddress,
  resolveEmailProvider,
  isEmailDeliveryDisabled,
} from './config'

export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
}

type ResendSendResult = {
  error?: unknown
}

type ResolvedEmailPayload = {
  to: string
  subject: string
  react: React.ReactElement
  from: string
  replyTo?: string
  attachments?: SendEmailOptions['attachments']
}

type SesTransportOptions = TransportOptions & {
  SES: {
    sesClient: unknown
    SendEmailCommand: unknown
  }
}

function resolveResendErrorMessage(result: unknown): string | null {
  const value = result as ResendSendResult
  if (typeof value.error === 'string') return value.error
  if (value.error && typeof value.error === 'object' && 'message' in value.error) {
    const message = (value.error as { message?: unknown }).message
    return typeof message === 'string' ? message : null
  }
  return null
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function renderEmailHtml(react: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const markup = renderToStaticMarkup(react)
  return markup.startsWith('<!doctype html>') || markup.startsWith('<!DOCTYPE html>')
    ? markup
    : `<!doctype html>${markup}`
}

function renderEmailText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  )
}

async function sendWithResend({
  to,
  subject,
  react,
  from,
  replyTo,
  attachments,
}: ResolvedEmailPayload) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
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
  const errorMessage = resolveResendErrorMessage(result)
  if (errorMessage) {
    throw new Error(`RESEND_SEND_FAILED: ${errorMessage}`)
  }
}

async function sendWithSes({
  to,
  subject,
  react,
  from,
  replyTo,
  attachments,
}: ResolvedEmailPayload) {
  const [{ SESv2Client, SendEmailCommand }, nodemailerModule] = await Promise.all([
    import('@aws-sdk/client-sesv2'),
    import('nodemailer'),
  ])
  const region = resolveAwsSesRegion()
  const sesClient = new SESv2Client(region ? { region } : {})
  const sesTransportOptions: SesTransportOptions = {
    SES: { sesClient, SendEmailCommand },
  }
  const createTransport = nodemailerModule.default?.createTransport ?? nodemailerModule.createTransport
  const transporter = createTransport(sesTransportOptions)
  const html = await renderEmailHtml(react)
  const text = renderEmailText(html)
  try {
    await transporter.sendMail({
      to,
      subject,
      from,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
      ...(attachments?.length
        ? {
            attachments: attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              encoding: 'base64',
              ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
            })),
          }
        : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`SES_SEND_FAILED: ${message}`)
  }
}

export async function sendEmail({ to, subject, react, from, replyTo, attachments }: SendEmailOptions) {
  if (isEmailDeliveryDisabled()) return

  const fromAddr = from || resolveDefaultEmailFromAddress()
  if (!fromAddr) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED: set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL')
  }

  const payload = { to, subject, react, from: fromAddr, replyTo, attachments }
  const provider = resolveEmailProvider()
  if (provider === 'ses') {
    await sendWithSes(payload)
    return
  }
  await sendWithResend(payload)
}
