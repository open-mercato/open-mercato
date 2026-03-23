/**
 * Email Provider Adapter Interface
 *
 * Defines the contract for email providers (SMTP, Gmail, Outlook).
 * Implementations are registered via DI as 'emailProviderAdapter'.
 */

export interface EmailRecipient {
  email: string
  name?: string
}

export interface SendEmailInput {
  from: EmailRecipient
  to: EmailRecipient[]
  cc?: EmailRecipient[]
  bcc?: EmailRecipient[]
  subject: string
  bodyHtml: string
  bodyText?: string
  inReplyTo?: string
  threadId?: string
}

export interface SendEmailResult {
  messageId: string
  threadId?: string
  providerMessageId?: string
  provider: string
}

export interface InboundEmail {
  messageId: string
  threadId?: string
  inReplyTo?: string
  from: EmailRecipient
  to: EmailRecipient[]
  cc?: EmailRecipient[]
  subject: string
  bodyHtml?: string
  bodyText?: string
  sentAt: Date
  hasAttachments: boolean
  providerMessageId?: string
  providerMetadata?: Record<string, unknown>
}

export interface EmailProviderAdapter {
  readonly provider: string
  send(input: SendEmailInput): Promise<SendEmailResult>
  poll?(since: Date): Promise<InboundEmail[]>
  getThread?(threadId: string): Promise<InboundEmail[]>
  testConnection?(): Promise<{ ok: boolean; error?: string }>
}

/**
 * Stub adapter used when no email provider is configured.
 * Logs a warning and returns a placeholder result.
 */
export class StubEmailAdapter implements EmailProviderAdapter {
  readonly provider = 'stub'

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.warn('[customers.email] No email provider configured — email not sent:', input.subject)
    const messageId = `<stub-${Date.now()}@open-mercato.local>`
    return {
      messageId,
      provider: 'stub',
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'No email provider configured' }
  }
}
