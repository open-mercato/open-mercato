import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A loopback fake of the Xero endpoints this package calls: GET /connections and a paged
 * GET /api.xro/2.0/Contacts. Test-only; it never imports a test runner. Contacts are returned in
 * Xero's default order (UpdatedDateUTC ascending, then ContactID), filtered by If-Modified-Since
 * inclusively at the second, with the quota headers and the Date header of a real response.
 */

export type FakeXeroOrganisation = {
  tenantId: string
  connectionId: string
  name: string
  authEventId?: string
  tenantType?: 'ORGANISATION' | 'PRACTICE'
}

export type FakeXeroContact = Record<string, unknown> & {
  ContactID: string
  UpdatedDateUTC: string
  ContactStatus?: string
}

export type FakeXeroInjection = {
  status: number
  path?: 'connections' | 'contacts'
  retryAfter?: number
  rateLimitProblem?: string
  wwwAuthenticate?: string
  minLimitRemaining?: number
  delayMs?: number
  times?: number
}

export type FakeXeroRequest = {
  path: 'connections' | 'contacts' | 'other'
  query: Readonly<Record<string, string>>
  xeroTenantId: string | null
  ifModifiedSince: string | null
  status: number
}

export type FakeXeroApi = {
  readonly url: string
  readonly endpoints: { connections: string; accounting: string }
  seed(input: { organisations?: FakeXeroOrganisation[]; contacts?: Record<string, FakeXeroContact[]> }): void
  inject(injection: FakeXeroInjection): void
  requests(): ReadonlyArray<FakeXeroRequest>
  reset(): void
  close(): Promise<void>
}

export type FakeXeroApiOptions = {
  isTokenValid: (accessToken: string) => boolean
  dailyLimit?: number
  now?: () => Date
}

const MAX_PAGE_SIZE = 1000
const DEFAULT_PAGE_SIZE = 100
const DOT_NET_DATE = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/

export function toXeroDotNetDate(value: Date): string {
  return `/Date(${value.getTime()}+0000)/`
}

function parseXeroTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const dotNet = DOT_NET_DATE.exec(value)
  if (dotNet) return Number(dotNet[1])
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function parseIfModifiedSince(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed) ? `${trimmed}Z` : trimmed
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000) * 1000
}

function compareContacts(left: FakeXeroContact, right: FakeXeroContact): number {
  const byTime = (parseXeroTimestamp(left.UpdatedDateUTC) ?? 0) - (parseXeroTimestamp(right.UpdatedDateUTC) ?? 0)
  if (byTime !== 0) return byTime
  return left.ContactID < right.ContactID ? -1 : left.ContactID > right.ContactID ? 1 : 0
}

function readBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

export async function startFakeXeroApi(options: FakeXeroApiOptions): Promise<FakeXeroApi> {
  const now = options.now ?? (() => new Date())
  const dailyLimit = options.dailyLimit ?? 1000
  let organisations: FakeXeroOrganisation[] = []
  let contacts = new Map<string, FakeXeroContact[]>()
  let injections: Array<FakeXeroInjection & { remaining: number }> = []
  let recorded: FakeXeroRequest[] = []
  let dayCalls = new Map<string, number>()

  function quotaHeaders(xeroTenantId: string | null, minLimitRemaining?: number): Record<string, string> {
    const used = xeroTenantId ? (dayCalls.get(xeroTenantId) ?? 0) : 0
    return {
      'x-daylimit-remaining': String(Math.max(0, dailyLimit - used)),
      'x-minlimit-remaining': String(minLimitRemaining ?? 59),
      'x-appminlimit-remaining': '9995',
      date: now().toUTCString(),
    }
  }

  function takeInjection(path: FakeXeroRequest['path']): (FakeXeroInjection & { remaining: number }) | null {
    const match = injections.find((entry) => entry.remaining > 0 && (!entry.path || entry.path === path))
    if (!match) return null
    match.remaining -= 1
    injections = injections.filter((entry) => entry.remaining > 0)
    return match
  }

  function listContacts(xeroTenantId: string, query: URLSearchParams, ifModifiedSince: number | null) {
    const includeArchived = query.get('includeArchived') === 'true'
    const pageSize = Math.min(Math.max(Number(query.get('pageSize') ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const page = Math.max(Number(query.get('page') ?? 1) || 1, 1)
    const matching = (contacts.get(xeroTenantId) ?? [])
      .filter((contact) => includeArchived || contact.ContactStatus !== 'ARCHIVED')
      .filter((contact) => ifModifiedSince === null || (parseXeroTimestamp(contact.UpdatedDateUTC) ?? 0) >= ifModifiedSince)
      .sort(compareContacts)
    const pageCount = Math.max(1, Math.ceil(matching.length / pageSize))
    return {
      Status: 'OK',
      DateTimeUTC: toXeroDotNetDate(now()),
      pagination: { page, pageSize, pageCount, itemCount: matching.length },
      Contacts: matching.slice((page - 1) * pageSize, page * pageSize),
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path: FakeXeroRequest['path'] =
      url.pathname === '/connections' ? 'connections' : url.pathname === '/api.xro/2.0/Contacts' ? 'contacts' : 'other'
    const xeroTenantId = typeof req.headers['xero-tenant-id'] === 'string' ? req.headers['xero-tenant-id'] : null
    const ifModifiedSince = typeof req.headers['if-modified-since'] === 'string' ? req.headers['if-modified-since'] : null
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      recorded.push({ path, query: Object.fromEntries(url.searchParams), xeroTenantId, ifModifiedSince, status })
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    req.resume()

    const injection = takeInjection(path)
    const respond = () => {
      if (injection) {
        const headers: Record<string, string> = { ...quotaHeaders(xeroTenantId, injection.minLimitRemaining) }
        if (injection.retryAfter !== undefined) headers['retry-after'] = String(injection.retryAfter)
        if (injection.rateLimitProblem) headers['x-rate-limit-problem'] = injection.rateLimitProblem
        if (injection.wwwAuthenticate) headers['www-authenticate'] = injection.wwwAuthenticate
        send(injection.status, { Title: 'Injected failure' }, headers)
        return
      }
      const token = readBearer(req.headers.authorization)
      if (!token || !options.isTokenValid(token)) {
        send(401, { Title: 'Unauthorized', Detail: 'TokenExpired' }, { 'www-authenticate': 'Bearer error="invalid_token"' })
        return
      }
      if (path === 'connections') {
        const authEventId = url.searchParams.get('authEventId')
        const records = organisations
          .filter((organisation) => !authEventId || organisation.authEventId === authEventId)
          .map((organisation) => ({
            id: organisation.connectionId,
            tenantId: organisation.tenantId,
            tenantType: organisation.tenantType ?? 'ORGANISATION',
            tenantName: organisation.name,
            authEventId: organisation.authEventId ?? null,
            createdDateUtc: now().toISOString(),
            updatedDateUtc: now().toISOString(),
          }))
        send(200, records)
        return
      }
      if (path === 'contacts') {
        if (!xeroTenantId || !organisations.some((organisation) => organisation.tenantId === xeroTenantId)) {
          send(403, { Title: 'Forbidden', Detail: 'AuthenticationUnsuccessful' }, quotaHeaders(xeroTenantId))
          return
        }
        dayCalls.set(xeroTenantId, (dayCalls.get(xeroTenantId) ?? 0) + 1)
        send(200, listContacts(xeroTenantId, url.searchParams, parseIfModifiedSince(ifModifiedSince)), quotaHeaders(xeroTenantId))
        return
      }
      send(404, { Title: 'Not Found' })
    }
    if (injection?.delayMs) setTimeout(respond, injection.delayMs)
    else respond()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`

  return {
    url,
    endpoints: { connections: `${url}/connections`, accounting: `${url}/api.xro/2.0` },
    seed(input) {
      if (input.organisations) organisations = input.organisations.map((organisation) => ({ ...organisation }))
      if (input.contacts) {
        for (const [xeroTenantId, list] of Object.entries(input.contacts)) {
          contacts.set(xeroTenantId, list.map((contact) => ({ ...contact })))
        }
      }
    },
    inject(injection) {
      injections.push({ ...injection, remaining: injection.times ?? 1 })
    },
    requests: () => recorded.slice(),
    reset() {
      organisations = []
      contacts = new Map()
      injections = []
      recorded = []
      dayCalls = new Map()
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
