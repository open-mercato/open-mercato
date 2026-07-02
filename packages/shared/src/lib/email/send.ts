import React from 'react'
import {
  isEmailDeliveryDisabled,
  resolveDefaultEmailFromAddress,
} from './config'
import { getRegisteredEmailTransport } from './transport'

export type EmailAttachment = {
  filename: string
  content: string
  contentType?: string
}

export type SendEmailOptions = {
  to: string
  subject: string
  react?: React.ReactElement
  html?: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: EmailAttachment[]
  tenantId?: string
  organizationId?: string | null
}

export type ResolvedEmailPayload = {
  to: string
  subject: string
  react?: React.ReactElement
  html?: string
  text?: string
  from: string
  replyTo?: string
  attachments?: EmailAttachment[]
  tenantId?: string
  organizationId?: string | null
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (isEmailDeliveryDisabled()) return

  const fromAddr = options.from || resolveDefaultEmailFromAddress()
  if (!fromAddr) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED: set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL')
  }

  const transport = getRegisteredEmailTransport()
  if (!transport) {
    throw new Error('EMAIL_TRANSPORT_NOT_CONFIGURED: enable an outbound email provider module')
  }

  await transport.send({
    to: options.to,
    subject: options.subject,
    react: options.react,
    html: options.html,
    text: options.text,
    from: fromAddr,
    replyTo: options.replyTo,
    attachments: options.attachments,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  })
}
