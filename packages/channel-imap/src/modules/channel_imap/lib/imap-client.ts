import type { ImapCredentials } from './credentials'

/**
 * Thin wrapper around `imapflow` so the adapter and tests can stay agnostic of
 * the SDK shape. We only expose the operations the adapter actually performs:
 *   - `connectAndValidate` — open + LOGIN + LIST capabilities (used by `validateCredentials`)
 *   - `selectInbox` — open the INBOX mailbox and read UIDVALIDITY / UIDNEXT
 *   - `fetchUidRange` — fetch RFC822 bodies for a UID range (used by polling worker)
 *   - `appendSent` — append a sent message to the Sent folder if available
 *
 * The wrapper avoids leaking `imapflow` types to callers so we can swap to
 * `node-imap` or a mock without touching adapter code.
 */

export type ImapTransport = 'tls' | 'starttls' | 'none'

export interface ImapConnectionOptions {
  host: string
  port: number
  user: string
  pass: string
  transport: ImapTransport
  /** Connection + greeting timeout (ms). Default 10000. */
  timeoutMs?: number
}

export interface ImapFolderState {
  uidValidity?: number
  uidNext?: number
  exists?: number
}

export interface ImapFetchedMessage {
  uid: number
  rawBody: Buffer
  /** Server-reported INTERNALDATE — fallback when MIME date headers are missing. */
  internalDate?: Date
  /** Server flags (`\Seen`, `\Answered`, …). */
  flags?: string[]
}

export interface ImapClient {
  connectAndValidate(options: ImapConnectionOptions): Promise<{ capabilities: string[] }>
  selectInbox(
    options: ImapConnectionOptions,
  ): Promise<ImapFolderState>
  fetchUidRange(
    options: ImapConnectionOptions,
    range: string,
    opts?: { limit?: number },
  ): Promise<ImapFetchedMessage[]>
  appendSent(
    options: ImapConnectionOptions,
    rawMessage: Buffer,
  ): Promise<void>
}

/**
 * Default IMAP client backed by `imapflow`. Imported lazily so test environments
 * that don't install `imapflow` (the unit tests use a hand-rolled mock) keep working.
 */
class ImapflowClient implements ImapClient {
  private async openConnection(options: ImapConnectionOptions): Promise<ImapflowConnection> {
    const { ImapFlow } = await loadImapFlow()
    const client = new ImapFlow({
      host: options.host,
      port: options.port,
      secure: options.transport === 'tls',
      auth: { user: options.user, pass: options.pass },
      // Allow STARTTLS to advertise itself on plain connections.
      tls: options.transport === 'starttls' ? { rejectUnauthorized: true } : undefined,
      logger: false,
      socketTimeout: options.timeoutMs ?? 10_000,
      // Cap initial socket + greeting waits so a non-responsive host bails
      // quickly during credential validation rather than the imapflow default
      // (~90s) which would block the UI flow.
      connectionTimeout: options.timeoutMs ?? 10_000,
      greetingTimeout: 10_000,
    } as Record<string, unknown>)
    // Attach a defensive 'error' listener so tcp-level errors emitted on the
    // EventEmitter (e.g. socket reset during an idle lock) don't crash the
    // Node process via `unhandledError`. The error still bubbles up through
    // the awaited operation; the listener exists purely to satisfy Node's
    // EventEmitter contract.
    const eventClient = client as unknown as { on?: (event: string, listener: (err: unknown) => void) => void }
    if (typeof eventClient.on === 'function') {
      eventClient.on('error', () => {
        // Swallow — surfaced to the caller via the awaited promise.
      })
    }
    await client.connect()
    if (options.transport === 'starttls') {
      // Verify STARTTLS actually upgraded the connection. ImapFlow exposes the
      // negotiated state via `secureConnection` (true after STARTTLS) — refuse
      // to proceed if the server didn't advertise it.
      const secured = (client as unknown as { secureConnection?: boolean }).secureConnection === true
      if (!secured) {
        await client.logout().catch(() => undefined)
        throw new Error(
          'IMAP server did not advertise STARTTLS — cannot authenticate over cleartext. Switch transport to tls (port 993) or contact the mailbox provider.',
        )
      }
    }
    return client
  }

  async connectAndValidate(options: ImapConnectionOptions): Promise<{ capabilities: string[] }> {
    const client = await this.openConnection(options)
    try {
      // imapflow exposes capabilities as a `Map<string, boolean | string>` —
      // iterating yields `[key, value]` tuples which break `.map(String)`.
      // Read the keys explicitly so consumers get the capability names.
      const capabilityKeys = extractCapabilityKeys(client)
      return { capabilities: capabilityKeys }
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  async selectInbox(options: ImapConnectionOptions): Promise<ImapFolderState> {
    const client = await this.openConnection(options)
    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const mailbox = client.mailbox as { uidValidity?: number | bigint; uidNext?: number | bigint; exists?: number } | null
        if (!mailbox) return {}
        return {
          uidValidity: typeof mailbox.uidValidity === 'bigint' ? Number(mailbox.uidValidity) : mailbox.uidValidity,
          uidNext: typeof mailbox.uidNext === 'bigint' ? Number(mailbox.uidNext) : mailbox.uidNext,
          exists: mailbox.exists,
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  async fetchUidRange(
    options: ImapConnectionOptions,
    range: string,
    opts: { limit?: number } = {},
  ): Promise<ImapFetchedMessage[]> {
    const client = await this.openConnection(options)
    const out: ImapFetchedMessage[] = []
    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const iterator = client.fetch(range, { uid: true, source: true, internalDate: true, flags: true })
        for await (const message of iterator) {
          if (!message.source) continue
          out.push({
            uid: Number(message.uid),
            rawBody: Buffer.isBuffer(message.source) ? message.source : Buffer.from(message.source),
            internalDate: message.internalDate ? new Date(message.internalDate) : undefined,
            flags: message.flags ? Array.from(message.flags as Iterable<string>) : undefined,
          })
          if (opts.limit && out.length >= opts.limit) break
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
    return out
  }

  async appendSent(options: ImapConnectionOptions, rawMessage: Buffer): Promise<void> {
    const client = await this.openConnection(options)
    try {
      const sentMailbox = resolveSentMailbox(client)
      if (!sentMailbox) return
      await client.append(sentMailbox, rawMessage, ['\\Seen'])
    } finally {
      await client.logout().catch(() => undefined)
    }
  }
}

function resolveSentMailbox(client: ImapflowConnection): string | null {
  const list = (client as unknown as { list?: () => unknown[] }).list
  if (typeof list !== 'function') return 'Sent'
  // ImapFlow does not expose synchronous mailbox listing; default to 'Sent' and let
  // the server reject if missing. The adapter swallows append failures.
  return 'Sent'
}

function extractCapabilityKeys(client: ImapflowConnection): string[] {
  // imapflow's `client.capabilities` is a `Map<string, boolean | string>`
  // (see imapflow/lib/imap-flow.js — `this.capabilities = new Map()`). The
  // legacy `serverInfo?.capability` (set by the ID response) may be an
  // iterable of strings; prefer it when present, otherwise read the Map keys.
  const fromServerInfo = client.serverInfo?.capability
  if (fromServerInfo) {
    return Array.from(fromServerInfo).map((value) => String(value).toUpperCase())
  }
  const caps = client.capabilities
  if (!caps) return []
  if (caps instanceof Map) {
    return Array.from(caps.keys()).map((value) => String(value).toUpperCase())
  }
  // Fallback for non-Map iterables (test mocks).
  return Array.from(caps as Iterable<string>).map((value) => String(value).toUpperCase())
}

interface ImapflowConnection {
  serverInfo?: { capability?: Iterable<string> }
  capabilities?: Iterable<string> | Map<string, unknown>
  mailbox: unknown
  connect(): Promise<void>
  logout(): Promise<void>
  getMailboxLock(name: string): Promise<{ release(): void }>
  fetch(range: string, options: Record<string, unknown>): AsyncIterable<{ uid: number; source?: Buffer | string; internalDate?: Date | string; flags?: Iterable<string> }>
  append(mailbox: string, rawMessage: Buffer, flags?: string[]): Promise<void>
}

async function loadImapFlow(): Promise<{ ImapFlow: new (options: Record<string, unknown>) => ImapflowConnection }> {
  // Dynamic import so unit tests that mock the client don't require `imapflow` installed.
  const mod = (await import('imapflow')) as unknown as { ImapFlow: new (options: Record<string, unknown>) => ImapflowConnection }
  return { ImapFlow: mod.ImapFlow }
}

let cachedClient: ImapClient | null = null

export function getImapClient(): ImapClient {
  if (!cachedClient) cachedClient = new ImapflowClient()
  return cachedClient
}

/**
 * Test-only hook to swap the default IMAP client with a mock implementation.
 * Production code never calls this.
 */
export function setImapClient(client: ImapClient | null): void {
  cachedClient = client
}

export function credentialsToConnection(credentials: ImapCredentials, role: 'imap'): ImapConnectionOptions {
  return {
    host: credentials.imapHost,
    port: Number(credentials.imapPort),
    user: credentials.imapUser,
    pass: credentials.imapPassword,
    transport: credentials.imapTls,
  }
}
