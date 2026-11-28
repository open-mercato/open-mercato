import nodemailer from 'nodemailer'
import { resolveSafeHostAddress } from '@open-mercato/shared/lib/host-pinning'
import {
  allowsInsecureTransport,
  allowsInternalHosts,
  INSECURE_TRANSPORT_MESSAGE,
  INTERNAL_HOST_MESSAGE,
  UNRESOLVABLE_HOST_MESSAGE,
  type SmtpCredentials,
  type SmtpTlsMode,
} from './credentials'

export interface SmtpConnection {
  host: string
  port: number
  tls: SmtpTlsMode
  user: string
  password: string
  timeoutMs?: number
}

export interface SmtpAttachment {
  filename: string
  content: string
  encoding: 'base64'
  contentType?: string
}

export interface SmtpMessage {
  from: string
  to: string[]
  subject: string
  text?: string
  html?: string
  replyTo?: string
  attachments?: SmtpAttachment[]
}

export interface SmtpSendInfo {
  messageId?: string
  response?: string
  /**
   * Nodemailer resolves the send as soon as the relay accepts *at least one*
   * recipient, reporting the split in `accepted`/`rejected`. Both are carried
   * through so the adapter can qualify a partial delivery instead of reporting
   * an unqualified success.
   */
  accepted?: string[]
  rejected?: string[]
}

/**
 * Thin seam over `nodemailer` so the adapter and the health check share one
 * connect path and tests can swap in a fake without reaching for module mocks.
 */
export interface SmtpTransport {
  send(connection: SmtpConnection, message: SmtpMessage): Promise<SmtpSendInfo>
  verify(connection: SmtpConnection): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 10_000

type Transporter = ReturnType<typeof nodemailer.createTransport>

async function createTransporter(connection: SmtpConnection): Promise<Transporter> {
  if (connection.tls === 'none' && !allowsInsecureTransport()) {
    throw new Error(`[internal] ${INSECURE_TRANSPORT_MESSAGE}`)
  }
  const pinned = await resolveSafeHostAddress(connection.host, {
    allowInternal: allowsInternalHosts(),
    internalMessage: INTERNAL_HOST_MESSAGE,
    unresolvableMessage: UNRESOLVABLE_HOST_MESSAGE,
  })
  const timeout = connection.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return nodemailer.createTransport({
    host: pinned.host,
    port: connection.port,
    secure: connection.tls === 'tls',
    requireTLS: connection.tls === 'starttls',
    auth: { user: connection.user, pass: connection.password },
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    // Certificate verification stays on for every encrypted mode; only an
    // explicit `'none'` (already gated above) talks cleartext. A relay with a
    // self-signed certificate is a misconfiguration to fix at the relay, not
    // something to silently accept here.
    tls:
      connection.tls === 'none'
        ? undefined
        : { rejectUnauthorized: true, ...(pinned.servername ? { servername: pinned.servername } : {}) },
  })
}

/**
 * Nodemailer reports `accepted`/`rejected` as addresses or `{ address }`
 * objects depending on how the envelope was built; flatten both to plain
 * strings so the adapter has one shape to reason about.
 */
function toAddressStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((entry) => {
    if (typeof entry === 'string') return entry
    if (entry && typeof entry === 'object' && 'address' in entry) {
      return String((entry as { address: unknown }).address)
    }
    return String(entry)
  })
}

class NodemailerTransport implements SmtpTransport {
  async send(connection: SmtpConnection, message: SmtpMessage): Promise<SmtpSendInfo> {
    const transporter = await createTransporter(connection)
    try {
      const info = (await transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        ...(message.text ? { text: message.text } : {}),
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      })) as SmtpSendInfo
      return {
        ...info,
        ...(toAddressStrings(info.accepted) ? { accepted: toAddressStrings(info.accepted) } : {}),
        ...(toAddressStrings(info.rejected) ? { rejected: toAddressStrings(info.rejected) } : {}),
      }
    } finally {
      // Close on every path: a failed send (bad password, unreachable relay —
      // the common case) would otherwise leak the socket pool.
      transporter.close()
    }
  }

  async verify(connection: SmtpConnection): Promise<void> {
    const transporter = await createTransporter(connection)
    try {
      await transporter.verify()
    } finally {
      transporter.close()
    }
  }
}

let cachedTransport: SmtpTransport | null = null

export function getSmtpTransport(): SmtpTransport {
  if (!cachedTransport) cachedTransport = new NodemailerTransport()
  return cachedTransport
}

/** Test-only hook; pass `null` to restore the real nodemailer transport. */
export function setSmtpTransport(transport: SmtpTransport | null): void {
  cachedTransport = transport
}

export function credentialsToConnection(credentials: SmtpCredentials): SmtpConnection {
  return {
    host: credentials.host,
    port: Number(credentials.port),
    tls: credentials.tls,
    user: credentials.user,
    password: credentials.password,
  }
}
