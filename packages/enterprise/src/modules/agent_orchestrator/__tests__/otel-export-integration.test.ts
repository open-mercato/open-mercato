/** @jest-environment node */
import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'
import { integration, integrations, bundles } from '../integration'
import { register } from '../di'
import {
  OTEL_EXPORT_DESTINATION_NOT_ACTIVE,
  OTEL_EXPORT_HEALTH_CHECK_SERVICE,
  OTEL_EXPORT_INTEGRATION_ID,
  createOtelExportHealthCheck,
  parseOtelExportIntegrationCredentials,
  resolveInactiveOtelExportHealthDestination,
  type OtelExportHealthDestinationResolver,
} from '../lib/trace/otel/exportIntegration'
import { OTEL_EXPORT_TEST_SPAN_NAME, sendOtelTestSpan } from '../lib/trace/otel/sendTestSpan'
import type { OtlpExportResult, PostOtlpTracesInput } from '../lib/trace/otel/otlpHttpClient'

jest.mock('../lib/trace/otel/otlpHttpClient', () => {
  const actual = jest.requireActual('../lib/trace/otel/otlpHttpClient') as Record<string, unknown>
  return { ...actual, postOtlpTraces: jest.fn() }
})

const { postOtlpTraces } = jest.requireMock('../lib/trace/otel/otlpHttpClient') as {
  postOtlpTraces: jest.Mock<(input: PostOtlpTracesInput) => Promise<OtlpExportResult>>
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT, organizationId: ORG }
const ENDPOINT = 'https://collector.tenant.example.test/v1/traces'
const HEADER_SECRET = 'tenant-otlp-secret'

function okResult(overrides: Partial<OtlpExportResult> = {}): OtlpExportResult {
  return { outcome: 'ok', httpStatus: 200, retryAfterMs: null, errorCode: null, latencyMs: 9, ...overrides }
}

function fieldByKey(key: string): IntegrationCredentialField | undefined {
  return integration.credentials?.fields.find((field) => field.key === key)
}

const sendingResolver: OtelExportHealthDestinationResolver = async ({ credentials }) => ({
  endpoint: credentials.endpoint,
  headers: credentials.headers,
  protocol: credentials.protocol,
  serviceName: 'open-mercato-agents',
})

beforeEach(() => {
  postOtlpTraces.mockReset()
})

describe('agent_orchestrator_otel_export integration definition', () => {
  test('declares the integration with its health check service', () => {
    expect(integration.id).toBe(OTEL_EXPORT_INTEGRATION_ID)
    expect(integration.id).toBe('agent_orchestrator_otel_export')
    expect(integration.healthCheck).toEqual({ service: OTEL_EXPORT_HEALTH_CHECK_SERVICE })
    expect(OTEL_EXPORT_HEALTH_CHECK_SERVICE).toBe('agentOrchestratorOtelExportHealthCheck')
    expect(integration.title).toEqual(expect.any(String))
    expect(integration.description).toEqual(expect.any(String))
    expect(integration.category).toBe('other')
    expect(integration.bundleId).toBeUndefined()
    expect(integrations).toEqual([integration])
    expect(bundles).toEqual([])
  })

  test('keeps the endpoint a required url and the headers a secret field', () => {
    expect(integration.credentials?.fields.map((field) => field.key)).toEqual(['endpoint', 'headers', 'protocol'])
    expect(fieldByKey('endpoint')).toMatchObject({ type: 'url', required: true })
    expect(fieldByKey('headers')).toMatchObject({ type: 'secret', required: false })
    const protocol = fieldByKey('protocol')
    expect(protocol?.type).toBe('select')
    expect(protocol && protocol.type === 'select' ? protocol.options.map((option) => option.value) : []).toEqual([
      'http/json',
      'http/protobuf',
    ])
  })

  test('registers the health check service in DI under the declared name', () => {
    const registrations: Record<string, unknown> = {}
    const container = {
      register: (entries: Record<string, unknown>) => Object.assign(registrations, entries),
    }
    register(container as unknown as Parameters<typeof register>[0])
    expect(registrations[OTEL_EXPORT_HEALTH_CHECK_SERVICE]).toBeDefined()
  })
})

describe('parseOtelExportIntegrationCredentials', () => {
  test('parses the headers secret and defaults the protocol', () => {
    const parsed = parseOtelExportIntegrationCredentials({
      endpoint: ` ${ENDPOINT} `,
      headers: `authorization=Bearer%20${HEADER_SECRET},x-scope=acme`,
      protocol: '',
    })
    expect(parsed).toEqual({
      ok: true,
      credentials: {
        endpoint: ENDPOINT,
        headers: { authorization: `Bearer ${HEADER_SECRET}`, 'x-scope': 'acme' },
        protocol: 'http/json',
      },
    })
  })

  test('accepts http/protobuf', () => {
    const parsed = parseOtelExportIntegrationCredentials({ endpoint: ENDPOINT, protocol: 'http/protobuf' })
    expect(parsed.ok && parsed.credentials.protocol).toBe('http/protobuf')
  })

  test.each([
    ['missing endpoint', {}, 'endpoint'],
    ['non-http endpoint', { endpoint: 'ftp://collector.example.test/v1/traces' }, 'endpoint'],
    ['credentials in the URL', { endpoint: 'https://user:pass@collector.example.test/v1/traces' }, 'endpoint'],
    ['unsupported protocol', { endpoint: ENDPOINT, protocol: 'grpc' }, 'protocol'],
  ])('rejects %s and names only the field', (_label, raw, field) => {
    expect(parseOtelExportIntegrationCredentials(raw)).toEqual({ ok: false, field })
  })
})

describe('agentOrchestratorOtelExportHealthCheck', () => {
  test('reports invalid credentials as unhealthy without echoing values', async () => {
    const check = createOtelExportHealthCheck({ resolveDestination: sendingResolver })
    const result = await check.check({ endpoint: `https://u:${HEADER_SECRET}@collector.example.test` }, SCOPE)
    expect(result).toMatchObject({ status: 'unhealthy', details: { reason: 'invalid_credentials', field: 'endpoint' } })
    expect(JSON.stringify(result)).not.toContain(HEADER_SECRET)
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('reports an unavailable destination as degraded and sends nothing', async () => {
    const check = createOtelExportHealthCheck({ resolveDestination: resolveInactiveOtelExportHealthDestination })
    const result = await check.check({ endpoint: ENDPOINT, headers: `authorization=${HEADER_SECRET}` }, SCOPE)
    expect(result).toMatchObject({ status: 'degraded', details: { reason: OTEL_EXPORT_DESTINATION_NOT_ACTIVE } })
    expect(JSON.stringify(result)).not.toContain('collector.tenant.example.test')
    expect(JSON.stringify(result)).not.toContain(HEADER_SECRET)
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('sends the test span to the resolved destination and reports healthy', async () => {
    postOtlpTraces.mockResolvedValue(okResult({ latencyMs: 14 }))
    const check = createOtelExportHealthCheck({ resolveDestination: sendingResolver })
    const result = await check.check(
      { endpoint: ENDPOINT, headers: `authorization=${HEADER_SECRET}`, protocol: 'http/protobuf' },
      SCOPE,
    )
    expect(result).toEqual({
      status: 'healthy',
      message: expect.any(String),
      details: { httpStatus: 200, latencyMs: 14 },
    })
    const call = postOtlpTraces.mock.calls[0][0]
    expect(call.endpoint).toBe(ENDPOINT)
    expect(call.headers).toEqual({ authorization: HEADER_SECRET })
    expect(call.contentType).toBe('application/x-protobuf')
    expect(JSON.stringify(result)).not.toContain(HEADER_SECRET)
  })

  test('reports a collector rejection as unhealthy with the error code only', async () => {
    postOtlpTraces.mockResolvedValue(okResult({ outcome: 'drop', httpStatus: 403, errorCode: 'http_403' }))
    const check = createOtelExportHealthCheck({ resolveDestination: sendingResolver })
    const result = await check.check({ endpoint: ENDPOINT, headers: `authorization=${HEADER_SECRET}` }, SCOPE)
    expect(result).toMatchObject({ status: 'unhealthy', details: { reason: 'http_403', httpStatus: 403 } })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('collector.tenant.example.test')
    expect(serialized).not.toContain(HEADER_SECRET)
  })
})

describe('sendOtelTestSpan', () => {
  const destination = {
    endpoint: ENDPOINT,
    headers: { authorization: `Bearer ${HEADER_SECRET}` },
    protocol: 'http/json' as const,
    serviceName: 'svc-under-test',
  }

  test('posts one synthetic om.export.test span with the scope resource attributes', async () => {
    postOtlpTraces.mockResolvedValue(okResult())
    const result = await sendOtelTestSpan(destination, SCOPE)
    expect(result).toEqual({ ok: true, httpStatus: 200, latencyMs: 9, errorCode: null })
    const call = postOtlpTraces.mock.calls[0][0]
    expect(call.contentType).toBe('application/json')
    const sent = JSON.parse(call.body as string)
    const attributes = sent.resourceSpans[0].resource.attributes as Array<{ key: string; value: { stringValue?: string } }>
    expect(Object.fromEntries(attributes.map((entry) => [entry.key, entry.value.stringValue]))).toMatchObject({
      'service.name': 'svc-under-test',
      'om.tenant.id': TENANT,
      'om.organization.id': ORG,
    })
    const spans = sent.resourceSpans[0].scopeSpans[0].spans
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe(OTEL_EXPORT_TEST_SPAN_NAME)
  })

  test('derives an error code from the http status when the client gives none', async () => {
    postOtlpTraces.mockResolvedValue(okResult({ outcome: 'retry', httpStatus: 503, errorCode: null }))
    expect(await sendOtelTestSpan(destination, SCOPE)).toEqual({
      ok: false,
      httpStatus: 503,
      latencyMs: 9,
      errorCode: 'http_503',
    })
  })

  test('falls back to unknown when neither code nor status is known', async () => {
    postOtlpTraces.mockResolvedValue(okResult({ outcome: 'retry', httpStatus: null, errorCode: null }))
    expect((await sendOtelTestSpan(destination, SCOPE)).errorCode).toBe('unknown')
  })
})
