import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Fixtures for the OTel export specs (TC-AGENT-OTEL-*).
 *
 * The fake OTLP receiver listens on the endpoint the app under test was
 * started with (`OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces`),
 * gunzips each POST body and keeps the parsed OTLP/JSON request. Specs close it
 * in `finally`. The settings helpers read/write the tenant's export settings
 * and restore the previous value; when the tenant had no row the restore
 * leaves a tenant row equal to the disabled default (there is no DELETE route).
 */

export const OTEL_SETTINGS_PATH = '/api/agent_orchestrator/otel-export/settings'
export const OTEL_TEST_SPAN_PATH = '/api/agent_orchestrator/otel-export/test'
export const OTEL_RECEIVER_HOST = '127.0.0.1'
export const OTEL_RECEIVER_PORT = 4319
export const OTEL_RECEIVER_PORT_BUSY_REASON = `port ${OTEL_RECEIVER_PORT} is in use — the fake OTLP receiver cannot listen on the endpoint the app exports to`
export const OTEL_DEPLOYMENT_DISABLED_REASON =
  'the app under test was not started with OM_AGENT_OTEL_EXPORT=on and OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces'
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const helpersDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(helpersDirectory, '../../i18n/en.json'), 'utf8'),
) as Record<string, string>

export function englishMessage(key: string): string {
  const message = englishMessages[key]
  if (!message) throw new Error(`[internal] en.json is missing "${key}"`)
  return message
}

export type OtelExportSettingsBody = {
  enabled: boolean
  content: 'none' | 'full'
  exportUserIds: boolean
  agentAllowlist?: string[]
}

export type OtelExportSettingsResponse = {
  settings?: OtelExportSettingsBody
  source?: 'tenant' | 'default'
  updatedAt?: string | null
  deployment?: {
    enabled?: boolean
    switchOn?: boolean
    endpointConfigured?: boolean
    protocol?: string
    protocolSupported?: boolean
    contentAllowed?: boolean
    traceLinkConfigured?: boolean
  }
  health?: { lastSuccessAt?: string | null; lastErrorAt?: string | null; lastErrorCode?: string | null }
}

export type OtlpAnyValue = {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpAnyValue[] }
}
export type OtlpKeyValue = { key: string; value?: OtlpAnyValue }
export type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  attributes?: OtlpKeyValue[]
}
export type OtlpTraceRequest = {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpKeyValue[] }
    scopeSpans?: Array<{ scope?: { name?: string }; spans?: OtlpSpan[] }>
  }>
}

export type ReceivedOtlpRequest = {
  path: string
  contentEncoding: string | null
  raw: string
  body: OtlpTraceRequest | null
}

export type FakeOtlpReceiver = {
  requests: ReceivedOtlpRequest[]
  close: () => Promise<void>
}

function decodeBody(chunks: Buffer[], contentEncoding: string | null): string {
  const buffer = Buffer.concat(chunks)
  return contentEncoding === 'gzip' ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8')
}

function parseRequestBody(raw: string): OtlpTraceRequest | null {
  try {
    return JSON.parse(raw) as OtlpTraceRequest
  } catch {
    return null
  }
}

/** Starts the receiver, or returns `null` when the port is already taken. */
export async function startFakeOtlpReceiver(): Promise<FakeOtlpReceiver | null> {
  const requests: ReceivedOtlpRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const encodingHeader = req.headers['content-encoding']
      const contentEncoding = typeof encodingHeader === 'string' ? encodingHeader.toLowerCase() : null
      try {
        const raw = decodeBody(chunks, contentEncoding)
        requests.push({ path: req.url ?? '', contentEncoding, raw, body: parseRequestBody(raw) })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end('{}')
      }
    })
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(OTEL_RECEIVER_PORT, OTEL_RECEIVER_HOST, () => resolve(true))
  })
  if (!listening) return null
  return {
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export function attributeMap(attributes: OtlpKeyValue[] | undefined): Map<string, OtlpAnyValue | undefined> {
  return new Map((attributes ?? []).map((entry) => [entry.key, entry.value]))
}

export function attributeString(attributes: OtlpKeyValue[] | undefined, key: string): string | null {
  const value = attributeMap(attributes).get(key)
  return typeof value?.stringValue === 'string' ? value.stringValue : null
}

export function attributeNumber(attributes: OtlpKeyValue[] | undefined, key: string): number | null {
  const value = attributeMap(attributes).get(key)
  if (value?.intValue !== undefined) return Number(value.intValue)
  if (typeof value?.doubleValue === 'number') return value.doubleValue
  return null
}

export function spansOf(request: OtlpTraceRequest | null): OtlpSpan[] {
  return (request?.resourceSpans ?? []).flatMap((resourceSpans) =>
    (resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) => scopeSpans.spans ?? []),
  )
}

/** Every object property name and every OTLP attribute key in the request. */
export function collectKeyNames(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeyNames(entry, into)
    return into
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.key === 'string' && 'value' in record) into.add(record.key)
    for (const [name, nested] of Object.entries(record)) {
      into.add(name)
      collectKeyNames(nested, into)
    }
  }
  return into
}

function lockHeaders(updatedAt: string | null | undefined): Record<string, string> {
  return updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: updatedAt } : {}
}

export async function readOtelSettings(
  request: APIRequestContext,
  token: string,
): Promise<OtelExportSettingsResponse> {
  const response = await apiRequest(request, 'GET', OTEL_SETTINGS_PATH, { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<OtelExportSettingsResponse>(response)
  expect(body?.settings, 'GET returns the resolved settings').toBeTruthy()
  return body!
}

export async function saveOtelSettings(
  request: APIRequestContext,
  token: string,
  settings: OtelExportSettingsBody,
  updatedAt: string | null | undefined,
) {
  return apiRequest(request, 'PUT', OTEL_SETTINGS_PATH, { token, data: settings, headers: lockHeaders(updatedAt) })
}

export async function restoreOtelSettings(
  request: APIRequestContext,
  token: string,
  previous: OtelExportSettingsBody | null,
): Promise<void> {
  if (!previous) return
  const current = await readOtelSettings(request, token).catch(() => null)
  await saveOtelSettings(request, token, previous, current?.updatedAt ?? null).catch(() => undefined)
}
