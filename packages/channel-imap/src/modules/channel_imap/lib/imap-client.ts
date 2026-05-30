import type { ImapCredentials } from './credentials'
import { assertTransportAllowed } from './transport'

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
  /** Connection + greeting timeout (ms). Default 60000 (Spec B). */
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
  /**
   * Run an IMAP `SEARCH` (with `UID` flag) and return matching UIDs.
   * Supports `OR FROM` chaining (server-side sender filter) and `SINCE` date
   * narrowing. Used by the inbound poll path to avoid pulling the entire
   * mailbox when the hub only cares about messages from known CRM contacts.
   *
   * `fromAddresses` is OR'd: `OR FROM "a@x.com" OR FROM "b@y.com" FROM "c@z.com"`.
   * `sinceDate` is formatted as IMAP date (`DD-Mon-YYYY`) for the SINCE clause.
   * Returns UIDs in mailbox order (typically ascending). Empty array = no match.
   */
  searchUidsByFromAndSince(
    options: ImapConnectionOptions,
    criteria: { fromAddresses?: string[]; sinceDate?: Date },
  ): Promise<number[]>
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
      // Gmail's IMAP can take 15-30s to respond to NAMESPACE under load even
      // after a successful AUTHENTICATE — observed during demo with valid
      // credentials and clean TLS. A 10s socket timeout aborts the command
      // mid-stream and surfaces as "NoConnection"/"Unexpected close" to the
      // worker, which then marks the channel as 'error'. 60s is enough for
      // any reasonable IMAP server while still bailing on truly dead hosts.
      socketTimeout: options.timeoutMs ?? 60_000,
      // Initial TCP+TLS handshake is usually fast; cap at 15s so a non-responsive
      // host bails before the UI flow stalls. Greeting can be slow on some
      // providers (Gmail occasionally takes 5-10s), so allow 15s there too.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
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
        // `{ uid: true }` as the THIRD arg (FetchOptions) makes imapflow treat
        // `range` as a UID range. Without it the range is read as message-sequence
        // numbers, and a sequence range like "200:*" collapses to the single newest
        // message ("*") — so each poll would fetch only the latest mail and silently
        // skip every other message that arrived in the same gap. The `uid: true` in
        // the SECOND arg (FetchQueryObject) is unrelated: it only asks to include the
        // UID field in each response row.
        const iterator = client.fetch(
          range,
          { uid: true, source: true, internalDate: true, flags: true },
          { uid: true },
        )
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

  async searchUidsByFromAndSince(
    options: ImapConnectionOptions,
    criteria: { fromAddresses?: string[]; sinceDate?: Date },
  ): Promise<number[]> {
    const client = await this.openConnection(options)
    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        // imapflow's search() takes a SearchQuery object. We construct one that
        // mirrors `SEARCH (OR FROM ... FROM ...) SINCE DD-Mon-YYYY` using its
        // documented shapes:
        //   - `from` accepts a single string; for multiple we use `or: [{from}, {from}]`
        //     (recursive — imapflow flattens to `OR (FROM a) (FROM b)` IMAP syntax).
        //   - `since` accepts a Date and imapflow formats as `SINCE DD-Mon-YYYY`.
        const query: Record<string, unknown> = {}
        const addresses = (criteria.fromAddresses ?? [])
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter((s) => s.length > 0)
        if (addresses.length === 1) {
          query.from = addresses[0]
        } else if (addresses.length > 1) {
          // Build nested OR: imapflow's `or` field expects an array of SearchQuery
          // objects. With 2 entries: `OR (FROM a) (FROM b)`. With N > 2 entries
          // we chain right-associatively: `OR (FROM a) (OR (FROM b) (FROM c) ...)`.
          let acc: Record<string, unknown> = { from: addresses[addresses.length - 1] }
          for (let i = addresses.length - 2; i >= 0; i--) {
            acc = { or: [{ from: addresses[i] }, acc] }
          }
          Object.assign(query, acc)
        }
        if (criteria.sinceDate instanceof Date && !Number.isNaN(criteria.sinceDate.getTime())) {
          query.since = criteria.sinceDate
        }
        if (Object.keys(query).length === 0) return []

        const searchFn = (client as unknown as {
          search?: (q: Record<string, unknown>, opts?: { uid?: boolean }) => Promise<Array<number | bigint> | false>
        }).search
        if (typeof searchFn !== 'function') return []
        const raw = await searchFn.call(client, query, { uid: true })
        if (raw === false || !Array.isArray(raw)) return []
        return raw.map((u) => (typeof u === 'bigint' ? Number(u) : u)).filter((u) => Number.isFinite(u))
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  async appendSent(options: ImapConnectionOptions, rawMessage: Buffer): Promise<void> {
    const client = await this.openConnection(options)
    try {
      const sentMailbox = resolveSentMailbox()
      await client.append(sentMailbox, rawMessage, ['\\Seen'])
    } finally {
      await client.logout().catch(() => undefined)
    }
  }
}

function resolveSentMailbox(): string {
  // ImapFlow has no synchronous mailbox listing, so default to the conventional
  // 'Sent' folder and let the server reject if it's missing (the adapter
  // swallows append failures).
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
  fetch(range: string, query: Record<string, unknown>, options?: Record<string, unknown>): AsyncIterable<{ uid: number; source?: Buffer | string; internalDate?: Date | string; flags?: Iterable<string> }>
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

export function credentialsToConnection(credentials: ImapCredentials): ImapConnectionOptions {
  assertTransportAllowed(credentials)
  return {
    host: credentials.imapHost,
    port: Number(credentials.imapPort),
    user: credentials.imapUser,
    pass: credentials.imapPassword,
    transport: credentials.imapTls,
  }
}
