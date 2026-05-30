import type { ImapCredentials } from './credentials'
import { assertTransportAllowed } from './transport'

/**
 * Outbound SMTP client wrapper. Same trade-offs as `imap-client.ts`: we wrap
 * `nodemailer` behind a tiny interface so tests can swap in a mock and the
 * adapter doesn't import SDK types directly.
 */

export interface SmtpConnectionOptions {
  host: string
  port: number
  user: string
  pass: string
  transport: 'tls' | 'starttls' | 'none'
  timeoutMs?: number
}

export interface SmtpMessage {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  text?: string
  html?: string
  /** RFC2822 Message-ID; if omitted nodemailer generates one. */
  messageId?: string
  /** RFC2822 In-Reply-To (single value). */
  inReplyTo?: string
  /** RFC2822 References (whitespace-delimited list). */
  references?: string[]
  attachments?: Array<{
    filename: string
    content: Buffer
    contentType?: string
    cid?: string
    inline?: boolean
  }>
  headers?: Record<string, string>
}

export interface SmtpSendResult {
  /** Effective Message-ID. */
  messageId: string
  /** Raw RFC2822 message buffer (used for Sent-folder append). */
  raw: Buffer
  /** Provider response string. */
  response?: string
}

export interface SmtpClient {
  verify(options: SmtpConnectionOptions): Promise<void>
  send(options: SmtpConnectionOptions, message: SmtpMessage): Promise<SmtpSendResult>
}

class NodemailerClient implements SmtpClient {
  async verify(options: SmtpConnectionOptions): Promise<void> {
    const { transporter } = await this.createTransporter(options)
    await transporter.verify()
    transporter.close()
  }

  async send(options: SmtpConnectionOptions, message: SmtpMessage): Promise<SmtpSendResult> {
    const { transporter, MailComposer } = await this.createTransporter(options)
    try {
      const mailOptions: Record<string, unknown> = {
        from: message.from,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: message.messageId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.cid,
          contentDisposition: a.inline ? 'inline' : 'attachment',
        })),
        headers: message.headers,
      }

      // Build the RFC2822 bytes ourselves via MailComposer so we can capture
      // them for the Sent-folder append (review H1, 2026-05-26).
      // nodemailer's `transporter.sendMail` info object does NOT contain `raw`
      // unless you configure a streamTransport, so naively reading
      // `info.raw` produces a 0-byte buffer and the Sent-folder append uploads
      // a corrupt message.
      let raw: Buffer = Buffer.alloc(0)
      let composedMessageId = message.messageId
      if (typeof MailComposer === 'function') {
        try {
          const composed = new MailComposer(mailOptions) as unknown as {
            compile: () => {
              build: (callback: (err: Error | null, output: Buffer) => void) => void
              messageId?: () => string | undefined
            }
          }
          const compiled = composed.compile()
          raw = await new Promise<Buffer>((resolve, reject) => {
            compiled.build((err, output) => {
              if (err) reject(err)
              else resolve(output)
            })
          })
          const messageIdFn = compiled.messageId
          if (typeof messageIdFn === 'function') {
            composedMessageId = messageIdFn.call(compiled) ?? composedMessageId
          }
        } catch {
          raw = Buffer.alloc(0)
        }
      }

      const info = (await transporter.sendMail(mailOptions)) as {
        messageId?: string
        envelope?: { messageId?: string }
        response?: string
      }
      const id = info.messageId ?? composedMessageId ?? info.envelope?.messageId
      if (!id) throw new Error('SMTP server did not return a Message-ID')
      return { messageId: id, raw, response: info.response }
    } finally {
      transporter.close()
    }
  }

  private async createTransporter(
    options: SmtpConnectionOptions,
  ): Promise<{
    transporter: NodemailerTransporter
    MailComposer: (new (mail: Record<string, unknown>) => unknown) | undefined
  }> {
    const mod = (await import('nodemailer')) as unknown as {
      default?: {
        createTransport: (opts: Record<string, unknown>) => NodemailerTransporter
        MailComposer?: new (mail: Record<string, unknown>) => unknown
      }
      createTransport?: (opts: Record<string, unknown>) => NodemailerTransporter
      MailComposer?: new (mail: Record<string, unknown>) => unknown
    }
    const createTransport = mod.createTransport ?? mod.default?.createTransport
    if (typeof createTransport !== 'function') {
      throw new Error('nodemailer.createTransport is unavailable')
    }
    const MailComposer = mod.MailComposer ?? mod.default?.MailComposer
    const transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.transport === 'tls',
      requireTLS: options.transport === 'starttls',
      auth: { user: options.user, pass: options.pass },
      connectionTimeout: options.timeoutMs ?? 10_000,
      // Reject downgrade attacks: only allow cleartext when the operator
      // explicitly opts into `transport: 'none'`. Even then, refuse to skip
      // certificate verification on STARTTLS / TLS.
      tls: options.transport === 'none' ? undefined : { rejectUnauthorized: true },
    })
    return { transporter, MailComposer }
  }
}

interface NodemailerTransporter {
  verify(): Promise<true>
  sendMail(options: Record<string, unknown>): Promise<unknown>
  close(): void
}

let cachedClient: SmtpClient | null = null

export function getSmtpClient(): SmtpClient {
  if (!cachedClient) cachedClient = new NodemailerClient()
  return cachedClient
}

export function setSmtpClient(client: SmtpClient | null): void {
  cachedClient = client
}

export function credentialsToSmtpConnection(credentials: ImapCredentials): SmtpConnectionOptions {
  assertTransportAllowed(credentials)
  return {
    host: credentials.smtpHost,
    port: Number(credentials.smtpPort),
    user: credentials.smtpUser,
    pass: credentials.smtpPassword,
    transport: credentials.smtpTls,
  }
}
