import { lookup as dnsLookup } from 'node:dns/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  assertSafeOutboundUrl,
  assertStaticallySafeOutboundUrl,
  parseOutboundUrl,
  resolveSafeOutboundUrl,
  type HostLookup,
  type ResolvedHostAddress,
  type UrlSafetyReason,
} from '@open-mercato/shared/lib/url-safety'

const SUBJECT = 'S3 endpoint'

export class UnsafeS3EndpointError extends Error {
  public readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? `S3 endpoint rejected: ${reason}`)
    this.name = 'UnsafeS3EndpointError'
    this.reason = reason
  }
}

const s3EndpointErrorFactory = (reason: UrlSafetyReason, message: string) =>
  new UnsafeS3EndpointError(reason, message)

export type AssertStaticS3EndpointDeps = {
  allowInternal?: boolean
}

export function assertStaticallySafeS3Endpoint(
  rawEndpoint: string | null | undefined,
  deps: AssertStaticS3EndpointDeps = {},
): void {
  if (!rawEndpoint) return
  const allowPrivate = deps.allowInternal ?? isAllowInternalS3EndpointsEnabled()
  assertStaticallySafeOutboundUrl(rawEndpoint, {
    errorFactory: s3EndpointErrorFactory,
    subject: SUBJECT,
    allowPrivate,
  })
}

export type AssertSafeS3EndpointDeps = {
  lookupHost?: HostLookup
  allowInternal?: boolean
}

export async function assertSafeS3Endpoint(
  rawEndpoint: string | null | undefined,
  deps: AssertSafeS3EndpointDeps = {},
): Promise<void> {
  if (!rawEndpoint) return
  const allowPrivate = deps.allowInternal ?? isAllowInternalS3EndpointsEnabled()
  await assertSafeOutboundUrl(rawEndpoint, {
    errorFactory: s3EndpointErrorFactory,
    subject: SUBJECT,
    allowPrivate,
    lookupHost: deps.lookupHost,
  })
}

export type SafeS3EndpointLookupDeps = {
  lookupHost?: HostLookup
  allowInternal?: boolean
}

export function createSafeS3EndpointLookup(
  rawEndpoint: string | null | undefined,
  deps: SafeS3EndpointLookupDeps = {},
): LookupFunction | undefined {
  if (!rawEndpoint) return undefined
  const allowPrivate = deps.allowInternal ?? isAllowInternalS3EndpointsEnabled()
  if (allowPrivate) return undefined

  const { hostname } = parseOutboundUrl(rawEndpoint, {
    errorFactory: s3EndpointErrorFactory,
    subject: SUBJECT,
  })
  const endpointHostname = normalizeLookupHostname(hostname)

  return (host, options, callback) => {
    const lookupHostname = normalizeLookupHostname(host)
    if (!isAllowedS3LookupHost(lookupHostname, endpointHostname)) {
      callback(new UnsafeS3EndpointError(
        'blocked_hostname',
        `S3 endpoint lookup host "${host}" does not match configured host "${endpointHostname}"`,
      ), '', 0)
      return
    }

    resolveSafeOutboundUrl(buildLookupValidationUrl(rawEndpoint, lookupHostname), {
      errorFactory: s3EndpointErrorFactory,
      subject: SUBJECT,
      lookupHost: deps.lookupHost ?? defaultLookupHost,
    }).then(({ addresses }) => {
      if (!addresses || addresses.length === 0) {
        const family = isIP(lookupHostname)
        if (options.all) callback(null, [{ address: lookupHostname, family }] as ResolvedHostAddress[])
        else callback(null, lookupHostname, family)
        return
      }
      if (options.all) {
        callback(null, addresses.map((record) => ({ address: record.address, family: record.family })))
        return
      }
      callback(null, addresses[0].address, addresses[0].family)
    }).catch((error: unknown) => {
      callback(error instanceof Error ? error : new UnsafeS3EndpointError('dns_resolution_failed'), '', 0)
    })
  }
}

function normalizeLookupHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  while (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function isAllowedS3LookupHost(lookupHostname: string, endpointHostname: string): boolean {
  if (lookupHostname === endpointHostname) return true
  if (isIP(endpointHostname)) return false
  return lookupHostname.endsWith(`.${endpointHostname}`)
}

function buildLookupValidationUrl(rawEndpoint: string, lookupHostname: string): string {
  const { url } = parseOutboundUrl(rawEndpoint, {
    errorFactory: s3EndpointErrorFactory,
    subject: SUBJECT,
  })
  const host = isIP(lookupHostname) === 6 ? `[${lookupHostname}]` : lookupHostname
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${host}${port}`
}

export type SafeS3RequestHandlerOptions = {
  httpAgent: HttpAgent
  httpsAgent: HttpsAgent
}

export function createSafeS3RequestHandler(
  rawEndpoint: string | null | undefined,
  deps: SafeS3EndpointLookupDeps = {},
): SafeS3RequestHandlerOptions | undefined {
  const lookup = createSafeS3EndpointLookup(rawEndpoint, deps)
  if (!lookup) return undefined
  return {
    httpAgent: new HttpAgent({ lookup }),
    httpsAgent: new HttpsAgent({ lookup }),
  }
}

export function isAllowInternalS3EndpointsEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS, false)
}

const defaultLookupHost: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true })
  return records
}
