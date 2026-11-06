import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { signTraceIngest, TRACE_INGEST_HEADERS } from '../../lib/trace/ingestAuth'

/**
 * Fixtures for the OTel export specs (TC-AGENT-OTEL-*).
 *
 * The fake OTLP receiver listens on the endpoint the app under test was
 * started with (`OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces`),
 * gunzips each POST body and keeps the parsed OTLP/JSON request. Specs close it
 * in `finally`. The settings helpers read/write the tenant's export settings
 * and restore the previous value; when the tenant had no row the restore
 * leaves a tenant row equal to the disabled default (there is no DELETE route).
 *
 * The receiver records each request's content type and decodes both wire
 * encodings: OTLP/JSON, and OTLP/HTTP protobuf through a minimal wire-format
 * reader that keeps span names, ids, kinds, attributes and event names
 * (enough for assertions, not a full OTLP decoder). The integration helpers
 * save and erase the organization's `agent_orchestrator_otel_export`
 * credentials and state; erasing hard-deletes the rows, so the spec must run
 * against the database of the app under test (`DATABASE_URL`).
 */

export const OTEL_SETTINGS_PATH = '/api/agent_orchestrator/otel-export/settings'
export const OTEL_TEST_SPAN_PATH = '/api/agent_orchestrator/otel-export/test'
export const OTEL_RECEIVER_HOST = '127.0.0.1'
export const OTEL_RECEIVER_PORT = 4319
export const OTEL_RECEIVER_PORT_BUSY_REASON = `port ${OTEL_RECEIVER_PORT} is in use — the fake OTLP receiver cannot listen on the endpoint the app exports to`
export const OTEL_INTEGRATION_ID = 'agent_orchestrator_otel_export'
export const OTEL_INTEGRATION_PATH = `/api/integrations/${OTEL_INTEGRATION_ID}`
export const OTEL_TRACE_INGEST_PATH = '/api/agent_orchestrator/trace/ingest'
export const OTEL_INGEST_SKIP_REASON =
  'trace ingest rejected the signature — the test process does not share JWT_SECRET with the app under test'
export const OTLP_PROTOBUF_CONTENT_TYPE = 'application/x-protobuf'
export const OTLP_JSON_CONTENT_TYPE = 'application/json'
const TEST_SPAN_RATE_LIMIT_WAIT_MS = 10_500
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
  destination?: 'deployment' | 'integration'
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
    tenantEndpointsAllowed?: boolean
    traceLinkConfigured?: boolean
  }
  health?: { lastSuccessAt?: string | null; lastErrorAt?: string | null; lastErrorCode?: string | null }
  integration?: { configured?: boolean; enabled?: boolean }
}

export type OtlpAnyValue = {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpAnyValue[] }
}
export type OtlpKeyValue = { key: string; value?: OtlpAnyValue }
export type OtlpSpanEvent = { name: string; attributes?: OtlpKeyValue[] }
export type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  attributes?: OtlpKeyValue[]
  events?: OtlpSpanEvent[]
}
export type OtlpTraceRequest = {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpKeyValue[] }
    scopeSpans?: Array<{ scope?: { name?: string }; spans?: OtlpSpan[] }>
  }>
}

export type ReceivedOtlpRequest = {
  path: string
  contentType: string | null
  contentEncoding: string | null
  headers: Record<string, string>
  raw: string
  body: OtlpTraceRequest | null
}

export type FakeOtlpReceiver = {
  requests: ReceivedOtlpRequest[]
  close: () => Promise<void>
}

function decodeBody(chunks: Buffer[], contentEncoding: string | null): Buffer {
  const buffer = Buffer.concat(chunks)
  return contentEncoding === 'gzip' ? gunzipSync(buffer) : buffer
}

function parseJsonBody(raw: string): OtlpTraceRequest | null {
  try {
    return JSON.parse(raw) as OtlpTraceRequest
  } catch {
    return null
  }
}

type ProtoField = { field: number; wireType: number; varint: bigint; bytes: Buffer }

const PROTO_WIRE_VARINT = 0
const PROTO_WIRE_FIXED64 = 1
const PROTO_WIRE_LENGTH_DELIMITED = 2
const PROTO_WIRE_FIXED32 = 5
const EMPTY_BUFFER = Buffer.alloc(0)

function readProtoVarint(buffer: Buffer, start: number): { value: bigint; offset: number } {
  let value = BigInt(0)
  let shift = BigInt(0)
  let offset = start
  while (offset < buffer.length) {
    const byte = buffer[offset]
    offset += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += BigInt(7)
  }
  throw new Error('[internal] truncated protobuf varint')
}

function readProtoFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < buffer.length) {
    const tag = readProtoVarint(buffer, offset)
    offset = tag.offset
    const field = Number(tag.value >> BigInt(3))
    const wireType = Number(tag.value & BigInt(7))
    if (wireType === PROTO_WIRE_VARINT) {
      const varint = readProtoVarint(buffer, offset)
      offset = varint.offset
      fields.push({ field, wireType, varint: varint.value, bytes: EMPTY_BUFFER })
    } else if (wireType === PROTO_WIRE_FIXED64 || wireType === PROTO_WIRE_FIXED32) {
      const size = wireType === PROTO_WIRE_FIXED64 ? 8 : 4
      if (offset + size > buffer.length) throw new Error('[internal] truncated protobuf fixed field')
      fields.push({ field, wireType, varint: BigInt(0), bytes: buffer.subarray(offset, offset + size) })
      offset += size
    } else if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const length = readProtoVarint(buffer, offset)
      offset = length.offset
      const end = offset + Number(length.value)
      if (end > buffer.length) throw new Error('[internal] truncated protobuf message')
      fields.push({ field, wireType, varint: BigInt(0), bytes: buffer.subarray(offset, end) })
      offset = end
    } else {
      throw new Error(`[internal] unsupported protobuf wire type ${wireType}`)
    }
  }
  return fields
}

function protoFieldsOf(fields: ProtoField[], field: number): ProtoField[] {
  return fields.filter((entry) => entry.field === field)
}

function protoString(fields: ProtoField[], field: number): string | undefined {
  const entry = protoFieldsOf(fields, field).at(-1)
  return entry ? entry.bytes.toString('utf8') : undefined
}

function protoHex(fields: ProtoField[], field: number): string | undefined {
  const entry = protoFieldsOf(fields, field).at(-1)
  return entry && entry.bytes.length > 0 ? entry.bytes.toString('hex') : undefined
}

function decodeProtoAnyValue(buffer: Buffer): OtlpAnyValue {
  const fields = readProtoFields(buffer)
  const value: OtlpAnyValue = {}
  for (const entry of fields) {
    if (entry.field === 1) value.stringValue = entry.bytes.toString('utf8')
    else if (entry.field === 2) value.boolValue = entry.varint !== BigInt(0)
    else if (entry.field === 3) value.intValue = BigInt.asIntN(64, entry.varint).toString()
    else if (entry.field === 4) value.doubleValue = entry.bytes.readDoubleLE(0)
    else if (entry.field === 5) {
      value.arrayValue = {
        values: protoFieldsOf(readProtoFields(entry.bytes), 1).map((item) => decodeProtoAnyValue(item.bytes)),
      }
    }
  }
  return value
}

function decodeProtoKeyValues(fields: ProtoField[], field: number): OtlpKeyValue[] {
  return protoFieldsOf(fields, field).map((entry) => {
    const keyValue = readProtoFields(entry.bytes)
    const value = protoFieldsOf(keyValue, 2).at(-1)
    return { key: protoString(keyValue, 1) ?? '', value: value ? decodeProtoAnyValue(value.bytes) : undefined }
  })
}

function decodeProtoSpan(buffer: Buffer): OtlpSpan {
  const fields = readProtoFields(buffer)
  const kind = protoFieldsOf(fields, 6).at(-1)
  return {
    traceId: protoHex(fields, 1) ?? '',
    spanId: protoHex(fields, 2) ?? '',
    parentSpanId: protoHex(fields, 4),
    name: protoString(fields, 5) ?? '',
    kind: kind ? Number(kind.varint) : 0,
    attributes: decodeProtoKeyValues(fields, 9),
    events: protoFieldsOf(fields, 11).map((entry) => {
      const event = readProtoFields(entry.bytes)
      return { name: protoString(event, 2) ?? '', attributes: decodeProtoKeyValues(event, 3) }
    }),
  }
}

/**
 * Decodes an OTLP/HTTP protobuf `ExportTraceServiceRequest` into the OTLP/JSON
 * shape the other helpers read: resource attributes, scope names, and spans
 * with ids, name, kind, attributes and events. Returns `null` on malformed input.
 */
export function decodeOtlpProtobufTraceRequest(buffer: Buffer): OtlpTraceRequest | null {
  try {
    return {
      resourceSpans: protoFieldsOf(readProtoFields(buffer), 1).map((resourceEntry) => {
        const resourceSpans = readProtoFields(resourceEntry.bytes)
        const resource = protoFieldsOf(resourceSpans, 1).at(-1)
        return {
          resource: { attributes: resource ? decodeProtoKeyValues(readProtoFields(resource.bytes), 1) : [] },
          scopeSpans: protoFieldsOf(resourceSpans, 2).map((scopeEntry) => {
            const scopeSpans = readProtoFields(scopeEntry.bytes)
            const scope = protoFieldsOf(scopeSpans, 1).at(-1)
            return {
              scope: { name: scope ? protoString(readProtoFields(scope.bytes), 1) : undefined },
              spans: protoFieldsOf(scopeSpans, 2).map((spanEntry) => decodeProtoSpan(spanEntry.bytes)),
            }
          }),
        }
      }),
    }
  } catch {
    return null
  }
}

function stringHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') result[name.toLowerCase()] = value
  }
  return result
}

/**
 * Starts the receiver (default port 4319, the deployment endpoint), or returns
 * `null` when the port is already taken.
 */
export async function startFakeOtlpReceiver(options: { port?: number } = {}): Promise<FakeOtlpReceiver | null> {
  const requests: ReceivedOtlpRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const encodingHeader = req.headers['content-encoding']
      const contentEncoding = typeof encodingHeader === 'string' ? encodingHeader.toLowerCase() : null
      const typeHeader = req.headers['content-type']
      const contentType = typeof typeHeader === 'string' ? typeHeader.split(';')[0].trim().toLowerCase() : null
      try {
        const bytes = decodeBody(chunks, contentEncoding)
        const raw = bytes.toString('utf8')
        const body =
          contentType === OTLP_PROTOBUF_CONTENT_TYPE ? decodeOtlpProtobufTraceRequest(bytes) : parseJsonBody(raw)
        requests.push({
          path: req.url ?? '',
          contentType,
          contentEncoding,
          headers: stringHeaders(req.headers),
          raw,
          body,
        })
        res.writeHead(200, { 'content-type': contentType ?? OTLP_JSON_CONTENT_TYPE })
        res.end(contentType === OTLP_PROTOBUF_CONTENT_TYPE ? '' : '{}')
      } catch {
        res.writeHead(400, { 'content-type': OTLP_JSON_CONTENT_TYPE })
        res.end('{}')
      }
    })
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(options.port ?? OTEL_RECEIVER_PORT, OTEL_RECEIVER_HOST, () => resolve(true))
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

export function spanEvents(span: OtlpSpan, name: string): OtlpSpanEvent[] {
  return (span.events ?? []).filter((event) => event.name === name)
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

export type OtelTestSpanResult = {
  status: number
  body: { ok?: boolean; httpStatus?: number | null; latencyMs?: number; errorCode?: string | null; error?: string } | null
  raw: string
}

/** POSTs the test span, waiting out the per-tenant ceiling once on a 429. */
export async function postOtelTestSpan(request: APIRequestContext, token: string): Promise<OtelTestSpanResult> {
  let response = await apiRequest(request, 'POST', OTEL_TEST_SPAN_PATH, { token, data: {} })
  if (response.status() === 429) {
    await new Promise((resolve) => setTimeout(resolve, TEST_SPAN_RATE_LIMIT_WAIT_MS))
    response = await apiRequest(request, 'POST', OTEL_TEST_SPAN_PATH, { token, data: {} })
  }
  const raw = await response.text()
  return { status: response.status(), body: parseJsonBody(raw) as OtelTestSpanResult['body'], raw }
}

/** POSTs a trace to the HMAC ingest route as the token's tenant and organization. */
export async function postSignedTrace(request: APIRequestContext, token: string, body: unknown) {
  const scope = getTokenScope(token)
  const raw = JSON.stringify(body)
  const messageId = `msg_${randomUUID()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signTraceIngest(scope.tenantId, messageId, timestamp, raw)
  const baseUrl = process.env.BASE_URL?.trim() || ''
  return request.fetch(baseUrl ? `${baseUrl}${OTEL_TRACE_INGEST_PATH}` : OTEL_TRACE_INGEST_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TRACE_INGEST_HEADERS.tenant]: scope.tenantId,
      [TRACE_INGEST_HEADERS.organization]: scope.organizationId,
      [TRACE_INGEST_HEADERS.id]: messageId,
      [TRACE_INGEST_HEADERS.timestamp]: timestamp,
      [TRACE_INGEST_HEADERS.signature]: signature,
    },
    data: raw,
  })
}

/** Ingests a trace and returns the run id, or `null` when the signature is rejected. */
export async function ingestSignedRun(request: APIRequestContext, token: string, body: unknown): Promise<string | null> {
  const ingest = await postSignedTrace(request, token, body)
  if (ingest.status() === 401) return null
  expect(ingest.status(), await ingest.text()).toBe(202)
  const ingested = await readJsonSafe<{ runId?: string }>(ingest)
  expect(typeof ingested?.runId).toBe('string')
  return ingested!.runId!
}

export function requestsForRun(requests: ReceivedOtlpRequest[], runId: string): ReceivedOtlpRequest[] {
  return requests.filter((received) =>
    spansOf(received.body).some((span) => attributeString(span.attributes, 'om.run.id') === runId),
  )
}

export type OtelIntegrationDetail = {
  hasCredentials?: boolean
  state?: { isEnabled?: boolean; updatedAt?: string | null }
}

export type OtelIntegrationCredentials = {
  endpoint: string
  headers?: string
  protocol?: 'http/json' | 'http/protobuf'
}

export async function readOtelIntegration(request: APIRequestContext, token: string): Promise<OtelIntegrationDetail> {
  const response = await apiRequest(request, 'GET', OTEL_INTEGRATION_PATH, { token })
  expect(response.status(), await response.text()).toBe(200)
  return (await readJsonSafe<OtelIntegrationDetail>(response)) ?? {}
}

export async function saveOtelIntegrationCredentials(
  request: APIRequestContext,
  token: string,
  credentials: OtelIntegrationCredentials,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `${OTEL_INTEGRATION_PATH}/credentials`, {
    token,
    data: { credentials },
  })
  expect(response.status(), await response.text()).toBe(200)
}

export async function setOtelIntegrationEnabled(
  request: APIRequestContext,
  token: string,
  isEnabled: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `${OTEL_INTEGRATION_PATH}/state`, {
    token,
    data: { isEnabled },
  })
  expect(response.status(), await response.text()).toBe(200)
}

/**
 * Removes the organization's export integration credentials, state and logs.
 * Disables and blanks it over the API first, so a failed direct-DB delete
 * still leaves no usable destination behind.
 */
export async function eraseOtelIntegration(request: APIRequestContext, token: string): Promise<void> {
  const scope = getTokenScope(token)
  await apiRequest(request, 'PUT', `${OTEL_INTEGRATION_PATH}/state`, { token, data: { isEnabled: false } }).catch(
    () => undefined,
  )
  await apiRequest(request, 'PUT', `${OTEL_INTEGRATION_PATH}/credentials`, {
    token,
    data: { credentials: {} },
  }).catch(() => undefined)
  await withClient(async (client) => {
    for (const table of ['integration_credentials', 'integration_states', 'integration_logs']) {
      await client.query(
        `delete from ${table} where integration_id = $1 and tenant_id = $2 and organization_id = $3`,
        [OTEL_INTEGRATION_ID, scope.tenantId, scope.organizationId],
      )
    }
  }).catch(() => undefined)
}
