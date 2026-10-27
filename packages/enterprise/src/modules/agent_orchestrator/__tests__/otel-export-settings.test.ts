import { describe, expect, jest, test } from '@jest/globals'
import { otelExportSettingsSchema, type OtelExportSettings } from '../data/validators'
import {
  DEFAULT_OTEL_EXPORT_SETTINGS,
  OTEL_EXPORT_CONFIG_MODULE,
  OTEL_EXPORT_CONFIG_NAME,
  OTEL_EXPORT_DEFAULT_DELAY_MS,
  isExportEnabledFor,
  parseOtlpHeaders,
  readOtelExportSettings,
  resolveOtelExportDeployment,
  resolveOtelExportEndpoint,
  type OtelExportDeploymentConfig,
} from '../lib/trace/otel/exportSettings'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

function makeContainer(record: unknown, options: { withStore?: boolean; rejects?: boolean } = {}) {
  const getRecord = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  if (options.rejects) getRecord.mockRejectedValue(new Error('store down'))
  else getRecord.mockResolvedValue(record)
  return {
    getRecord,
    container: {
      resolve: (token: string) => {
        if (token === 'moduleConfigService' && options.withStore !== false) return { getRecord }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    },
  }
}

describe('otelExportSettingsSchema', () => {
  test('applies the spec defaults', () => {
    expect(otelExportSettingsSchema.parse({})).toEqual({ enabled: false, content: 'none', exportUserIds: false })
  })

  test('caps the allowlist at 200 entries of at most 100 chars', () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => `agent_${index}`)
    expect(otelExportSettingsSchema.safeParse({ agentAllowlist: tooMany }).success).toBe(false)
    expect(otelExportSettingsSchema.safeParse({ agentAllowlist: ['a'.repeat(101)] }).success).toBe(false)
    expect(otelExportSettingsSchema.safeParse({ agentAllowlist: ['a'.repeat(100)] }).success).toBe(true)
    expect(otelExportSettingsSchema.safeParse({ content: 'partial' }).success).toBe(false)
  })
})

describe('parseOtlpHeaders', () => {
  test('parses pairs and URL-decodes values', () => {
    expect(parseOtlpHeaders('api-key=abc%20def, x-tenant = t1 ,Authorization=Bearer%20xyz')).toEqual({
      'api-key': 'abc def',
      'x-tenant': 't1',
      Authorization: 'Bearer xyz',
    })
  })

  test('keeps "=" inside values and skips malformed pairs', () => {
    expect(parseOtlpHeaders('token=a=b,=novalue,noequals,bad name=1,ok=%E0%A4%A,crlf=a%0D%0Ab,,good=1')).toEqual({
      token: 'a=b',
      good: '1',
    })
  })

  test('returns an empty map for missing input', () => {
    expect(parseOtlpHeaders(undefined)).toEqual({})
    expect(parseOtlpHeaders('')).toEqual({})
  })
})

describe('resolveOtelExportEndpoint', () => {
  test('prefers the agent endpoint, then the platform traces endpoint, then the base + /v1/traces', () => {
    expect(
      resolveOtelExportEndpoint({
        OM_AGENT_OTEL_EXPORT_ENDPOINT: 'http://agents:4318/v1/traces',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://platform:4318/v1/traces',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://base:4318',
      }),
    ).toBe('http://agents:4318/v1/traces')
    expect(
      resolveOtelExportEndpoint({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://platform:4318/v1/traces',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://base:4318',
      }),
    ).toBe('http://platform:4318/v1/traces')
    expect(resolveOtelExportEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://base:4318/' })).toBe(
      'http://base:4318/v1/traces',
    )
  })

  test('returns null when unset or not an http(s) URL', () => {
    expect(resolveOtelExportEndpoint({})).toBeNull()
    expect(resolveOtelExportEndpoint({ OM_AGENT_OTEL_EXPORT_ENDPOINT: 'not a url' })).toBeNull()
    expect(resolveOtelExportEndpoint({ OM_AGENT_OTEL_EXPORT_ENDPOINT: 'ftp://host/v1/traces' })).toBeNull()
  })
})

describe('resolveOtelExportDeployment', () => {
  test('is off by default with spec defaults', () => {
    expect(resolveOtelExportDeployment({})).toEqual({
      enabled: false,
      switchOn: false,
      protocol: 'http/json',
      protocolSupported: true,
      endpoint: null,
      headers: {},
      contentAllowed: false,
      delayMs: OTEL_EXPORT_DEFAULT_DELAY_MS,
      serviceName: 'open-mercato-agents',
      sources: ['runtime', 'eval'],
      traceUrlTemplate: null,
    })
  })

  test('is enabled with the switch on and an endpoint', () => {
    const config = resolveOtelExportDeployment({
      OM_AGENT_OTEL_EXPORT: 'on',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'platform=1',
      OM_AGENT_OTEL_EXPORT_DELAY_MS: '500',
      OM_AGENT_OTEL_SERVICE_NAME: 'agents-prod',
      OM_AGENT_OTEL_EXPORT_SOURCES: ' Runtime ,runtime,',
      OM_AGENT_OTEL_EXPORT_CONTENT: 'allow',
      OM_AGENT_OTEL_TRACE_URL_TEMPLATE: 'https://tracing/trace/{traceId}',
    })
    expect(config).toMatchObject({
      enabled: true,
      endpoint: 'http://collector:4318/v1/traces',
      headers: { platform: '1' },
      delayMs: 500,
      serviceName: 'agents-prod',
      sources: ['runtime'],
      contentAllowed: true,
      traceUrlTemplate: 'https://tracing/trace/{traceId}',
    })
  })

  test('agent headers take precedence over the platform headers', () => {
    const config = resolveOtelExportDeployment({
      OM_AGENT_OTEL_EXPORT_HEADERS: 'agent=1',
      OTEL_EXPORTER_OTLP_HEADERS: 'platform=1',
    })
    expect(config.headers).toEqual({ agent: '1' })
  })

  test('an unsupported protocol disables export', () => {
    const config = resolveOtelExportDeployment({
      OM_AGENT_OTEL_EXPORT: 'on',
      OM_AGENT_OTEL_EXPORT_ENDPOINT: 'http://collector:4318/v1/traces',
      OM_AGENT_OTEL_EXPORT_PROTOCOL: 'grpc',
    })
    expect(config).toMatchObject({ enabled: false, switchOn: true, protocol: 'grpc', protocolSupported: false })
  })

  test('the switch on without an endpoint stays disabled', () => {
    expect(resolveOtelExportDeployment({ OM_AGENT_OTEL_EXPORT: 'on' }).enabled).toBe(false)
  })

  test('malformed values fall back safely', () => {
    const config = resolveOtelExportDeployment({
      OM_AGENT_OTEL_EXPORT: 'maybe',
      OM_AGENT_OTEL_EXPORT_ENDPOINT: 'http://collector:4318/v1/traces',
      OM_AGENT_OTEL_EXPORT_DELAY_MS: '-5',
      OM_AGENT_OTEL_EXPORT_CONTENT: 'sometimes',
      OM_AGENT_OTEL_EXPORT_SOURCES: ' , ',
    })
    expect(config).toMatchObject({
      enabled: false,
      switchOn: false,
      delayMs: OTEL_EXPORT_DEFAULT_DELAY_MS,
      contentAllowed: false,
      sources: ['runtime', 'eval'],
    })
  })
})

describe('readOtelExportSettings', () => {
  test('reads a stored tenant record with its version', async () => {
    const { container, getRecord } = makeContainer({
      value: { enabled: true, agentAllowlist: ['agent_a'] },
      source: 'tenant',
      updatedAt: '2026-10-27T10:00:00.000Z',
    })
    const result = await readOtelExportSettings(container as never, TENANT_ID)
    expect(getRecord).toHaveBeenCalledWith(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_CONFIG_NAME, { tenantId: TENANT_ID })
    expect(result).toEqual({
      settings: { enabled: true, content: 'none', exportUserIds: false, agentAllowlist: ['agent_a'] },
      source: 'tenant',
      updatedAt: '2026-10-27T10:00:00.000Z',
    })
  })

  test('fails closed on every failure arm', async () => {
    const disabled = { settings: DEFAULT_OTEL_EXPORT_SETTINGS, source: 'default', updatedAt: null }
    expect(await readOtelExportSettings(makeContainer(null).container as never, TENANT_ID)).toEqual(disabled)
    expect(
      await readOtelExportSettings(makeContainer(null, { withStore: false }).container as never, TENANT_ID),
    ).toEqual(disabled)
    expect(
      await readOtelExportSettings(makeContainer(null, { rejects: true }).container as never, TENANT_ID),
    ).toEqual(disabled)
    expect(
      await readOtelExportSettings(
        makeContainer({ value: { enabled: 'yes' }, source: 'tenant', updatedAt: '2026-10-27T10:00:00.000Z' })
          .container as never,
        TENANT_ID,
      ),
    ).toEqual({ ...disabled, updatedAt: '2026-10-27T10:00:00.000Z' })
    expect(
      await readOtelExportSettings(
        makeContainer({ value: { enabled: true }, source: 'instance', updatedAt: 'x' }).container as never,
        TENANT_ID,
      ),
    ).toMatchObject({ source: 'tenant', updatedAt: null })
  })
})

describe('isExportEnabledFor', () => {
  const deploymentOn: OtelExportDeploymentConfig = resolveOtelExportDeployment({
    OM_AGENT_OTEL_EXPORT: 'on',
    OM_AGENT_OTEL_EXPORT_ENDPOINT: 'http://collector:4318/v1/traces',
  })
  const deploymentOff = resolveOtelExportDeployment({})
  const tenantOn: OtelExportSettings = otelExportSettingsSchema.parse({ enabled: true })
  const tenantOff: OtelExportSettings = otelExportSettingsSchema.parse({ enabled: false })
  const tenantAllowlist: OtelExportSettings = otelExportSettingsSchema.parse({
    enabled: true,
    agentAllowlist: ['agent_a'],
  })

  test.each([
    ['all on', deploymentOn, tenantOn, 'agent_b', 'runtime', true],
    ['eval source', deploymentOn, tenantOn, 'agent_b', 'eval', true],
    ['deployment off', deploymentOff, tenantOn, 'agent_b', 'runtime', false],
    ['tenant off', deploymentOn, tenantOff, 'agent_b', 'runtime', false],
    ['allowlisted agent', deploymentOn, tenantAllowlist, 'agent_a', 'runtime', true],
    ['agent outside allowlist', deploymentOn, tenantAllowlist, 'agent_b', 'runtime', false],
    ['unknown source', deploymentOn, tenantOn, 'agent_b', 'manual', false],
    ['missing source', deploymentOn, tenantOn, 'agent_b', null, false],
  ] as const)('%s', (_label, deployment, tenant, agentId, runSource, expected) => {
    expect(isExportEnabledFor({ deployment, tenant, agentId, runSource })).toBe(expected)
  })

  test('honors a narrowed source list', () => {
    const runtimeOnly = resolveOtelExportDeployment({
      OM_AGENT_OTEL_EXPORT: 'on',
      OM_AGENT_OTEL_EXPORT_ENDPOINT: 'http://collector:4318/v1/traces',
      OM_AGENT_OTEL_EXPORT_SOURCES: 'runtime',
    })
    expect(isExportEnabledFor({ deployment: runtimeOnly, tenant: tenantOn, agentId: 'a', runSource: 'eval' })).toBe(
      false,
    )
  })
})
