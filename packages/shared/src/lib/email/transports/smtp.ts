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
    throw new Error('SMTP_SEND_FAILED: nodemailer.createTransport is unavailable')
  }
  return createTransport
}

function buildTransporterOptions(config: SmtpConfig): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    tls: config.allowCleartext ? undefined : { rejectUnauthorized: true },
    ...(config.user && config.password ? { auth: { user: config.user, pass: config.password } } : {}),
    ...(config.timeoutMs ? { connectionTimeout: config.timeoutMs, socketTimeout: config.timeoutMs } : {}),
  }
}

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  return {
    async send({ to, subject, react, from, replyTo, attachments }: ResolvedEmailMessage): Promise<void> {
      const createTransport = await loadCreateTransport()
      const { render } = await import('@react-email/render')
      const html = await render(react)
      const text = await render(react, { plainText: true })
      const transporter = createTransport(buildTransporterOptions(config))
      try {
        await transporter.sendMail({
          from,
          to,
          subject,
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
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`SMTP_SEND_FAILED: ${message}`)
      } finally {
        transporter.close()
      }
    },
  }
}
