import type { Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import type { SmtpConfig } from '../config'
import type { EmailTransport, ResolvedEmailMessage } from './types'

type CreateTransport = (options: SMTPTransport.Options) => Transporter

async function loadCreateTransport(): Promise<CreateTransport> {
  const mod = (await import('nodemailer')) as {
    createTransport?: CreateTransport
    default?: { createTransport?: CreateTransport }
  }
  const createTransport = mod.createTransport ?? mod.default?.createTransport
  if (typeof createTransport !== 'function') {
    throw new Error('[internal] nodemailer.createTransport is unavailable')
  }
  return createTransport
}

function buildTransporterOptions(config: SmtpConfig): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    // `requireTLS: false` alone leaves nodemailer's opportunistic STARTTLS in place, which then
    // verifies certificates — so a self-signed MailDev/Mailpit sink would fail despite the
    // operator opting into cleartext. `ignoreTLS` makes the opt-in deterministic.
    ignoreTLS: config.allowCleartext,
    tls: config.allowCleartext ? undefined : { rejectUnauthorized: true },
    connectionTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    ...(config.user && config.password ? { auth: { user: config.user, pass: config.password } } : {}),
  }
}

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  return {
    async send({ to, subject, react, from, replyTo, attachments }: ResolvedEmailMessage): Promise<void> {
      let transporter: Transporter | undefined
      try {
        const createTransport = await loadCreateTransport()
        const { render } = await import('@react-email/render')
        const html = await render(react)
        const text = await render(react, { plainText: true })
        transporter = createTransport(buildTransporterOptions(config))
        await transporter.sendMail({
          from,
          to,
          subject,
          html,
          text,
          ...(replyTo ? { replyTo } : {}),
          // `SendEmailOptions['attachments'].content` is typed `string` and carries base64 on the
          // Resend path, so the encoding is fixed here rather than sniffed.
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
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`SMTP_SEND_FAILED: ${message}`)
      } finally {
        transporter?.close()
      }
    },
  }
}
