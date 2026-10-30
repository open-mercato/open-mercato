/** @jest-environment node */
import { describe, expect, jest, test } from '@jest/globals'
import {
  OTEL_EXPORT_DESTINATION_ERRORS,
  createOtelExportHealthDestinationResolver,
  isOtelExportDestinationError,
  resolveOtelExportDestination,
} from '../lib/trace/otel/exportDestination'
import { createOtelExportHealthCheck, parseOtelExportIntegrationCredentials } from '../lib/trace/otel/exportIntegration'
import { parseOtlpHeadersStrict, resolveOtelExportDeployment } from '../lib/trace/otel/exportSettings'
import { OTEL_EXPORT_INTEGRATION_ID } from '../lib/trace/otel/exportIntegrationIds'

jest.mock('../lib/trace/otel/otlpHttpClient', () => {
  const actual = jest.requireActual('../lib/trace/otel/otlpHttpClient') as Record<string, unknown>
  return { ...actual, postOtlpTraces: jest.fn() }
})

const { postOtlpTraces } = jest.requireMock('../lib/trace/otel/otlpHttpClient') as {
  postOtlpTraces: jest.Mock<(...args: unknown[]) => Promise<unknown>>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const DEPLOYMENT_ENDPOINT = 'https://collector.deployment.test/v1/traces'
const TENANT_ENDPOINT = 'http://127.0.0.1:4319/v1/traces'
const TENANT_SECRET = 'tenant-header-secret'

const BASE_ENV = {
  OM_AGENT_OTEL_EXPORT: 'on',
  OM_AGENT_OTEL_EXPORT_ENDPOINT: DEPLOYMENT_ENDPOINT,
  OM_AGENT_OTEL_EXPORT_HEADERS: 'authorization=Bearer%20deployment-secret',
}

const TENANT_ENV = {
  ...BASE_ENV,
  OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS: 'allow',
  OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS: '127.0.0.1',
}

type IntegrationFixture = {
  credentials?: Record<string, unknown> | null
  enabled?: boolean
  services?: boolean
}

function makeContainer(fixture: IntegrationFixture = {}) {
  const credentials =
    fixture.credentials === undefined
      ? { endpoint: TENANT_ENDPOINT, headers: `authorization=Bearer%20${TENANT_SECRET},x-tenant=acme`, protocol: 'http/protobuf' }
      : fixture.credentials
  const resolveCredentials = jest.fn(async (_id: string, _scope: unknown) => credentials)
  const isEnabled = jest.fn(async (_id: string, _scope: unknown) => fixture.enabled ?? true)
  const container = {
    resolve: (token: string) => {
      if (fixture.services === false) throw new Error(`[internal] missing ${token}`)
      if (token === 'integrationCredentialsService') return { resolve: resolveCredentials }
      if (token === 'integrationStateService') return { isEnabled }
      throw new Error(`[internal] unexpected DI token in test: ${token}`)
    },
  }
  return { container, resolveCredentials, isEnabled }
}

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

describe('resolveOtelExportDestination — deployment', () => {
  test('uses the deployment endpoint, headers and protocol without pinning', async () => {
    const { container, resolveCredentials } = makeContainer()
    const deployment = resolveOtelExportDeployment({ ...BASE_ENV, OM_AGENT_OTEL_EXPORT_PROTOCOL: 'http/protobuf' })
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'deployment' }, SCOPE)
    expect(result).toEqual({
      endpoint: DEPLOYMENT_ENDPOINT,
      headers: { authorization: 'Bearer deployment-secret' },
      protocol: 'http/protobuf',
      source: 'deployment',
    })
    expect(resolveCredentials).not.toHaveBeenCalled()
  })

  test('fails closed when the deployment has no usable endpoint', async () => {
    const { container } = makeContainer()
    const deployment = resolveOtelExportDeployment({
      OM_AGENT_OTEL_EXPORT: 'on',
      OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS: 'allow',
    })
    expect(deployment.enabled).toBe(true)
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'deployment' }, SCOPE)
    expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.deploymentUnconfigured })
  })
})

describe('resolveOtelExportDestination — integration', () => {
  test('resolves the organization credentials, vets the endpoint and pins its addresses', async () => {
    const { container, resolveCredentials, isEnabled } = makeContainer()
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
      env: TENANT_ENV,
    })
    expect(result).toEqual({
      endpoint: TENANT_ENDPOINT,
      headers: { authorization: `Bearer ${TENANT_SECRET}`, 'x-tenant': 'acme' },
      protocol: 'http/protobuf',
      pinnedAddresses: ['127.0.0.1'],
      source: 'integration',
    })
    expect(resolveCredentials).toHaveBeenCalledWith(OTEL_EXPORT_INTEGRATION_ID, SCOPE)
    expect(isEnabled).toHaveBeenCalledWith(OTEL_EXPORT_INTEGRATION_ID, SCOPE)
  })

  test('vets a DNS host through the lookup and pins every vetted answer', async () => {
    const { container } = makeContainer({ credentials: { endpoint: 'https://otel.acme.example/v1/traces' } })
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    const lookup = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
      env: TENANT_ENV,
      lookup: lookup as never,
    })
    expect(result).toMatchObject({
      endpoint: 'https://otel.acme.example/v1/traces',
      headers: {},
      protocol: 'http/json',
      pinnedAddresses: ['93.184.216.34', '93.184.216.35'],
      source: 'integration',
    })
  })

  test('tenant_endpoints_denied while the deployment denies tenant endpoints, without reading credentials', async () => {
    const { container, resolveCredentials } = makeContainer()
    const deployment = resolveOtelExportDeployment(BASE_ENV)
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
      env: BASE_ENV,
    })
    expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.tenantEndpointsDenied })
    expect(resolveCredentials).not.toHaveBeenCalled()
  })

  test('integration_unconfigured without credentials, an organization, the service or with invalid credentials', async () => {
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    const cases: Array<[IntegrationFixture, typeof SCOPE | { tenantId: string; organizationId: null }]> = [
      [{ credentials: null }, SCOPE],
      [{}, { tenantId: TENANT_ID, organizationId: null }],
      [{ services: false }, SCOPE],
      [{ credentials: { endpoint: 'ftp://collector.example/v1/traces' } }, SCOPE],
      [{ credentials: { endpoint: 'https://user:pass@collector.example/v1/traces' } }, SCOPE],
    ]
    for (const [fixture, scope] of cases) {
      const { container } = makeContainer(fixture)
      const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, scope, {
        env: TENANT_ENV,
      })
      expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.integrationUnconfigured })
    }
  })

  test('integration_unconfigured when the header list is malformed', async () => {
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    for (const headers of ['authorization=ok,broken', 'bad name=value', 'x-a=line%0D%0Ainjected', 'x-a=%E0%A4%A']) {
      const { container } = makeContainer({ credentials: { endpoint: TENANT_ENDPOINT, headers } })
      const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
        env: TENANT_ENV,
      })
      expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.integrationUnconfigured })
    }
  })

  test('integration_disabled when the integration is not enabled for the organization', async () => {
    const { container } = makeContainer({ enabled: false })
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
      env: TENANT_ENV,
    })
    expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.integrationDisabled })
  })

  test('endpoint_blocked for metadata, private and non-allow-listed loopback endpoints', async () => {
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    for (const endpoint of [
      'http://169.254.169.254/v1/traces',
      'http://10.0.0.5/v1/traces',
      'http://[::ffff:127.0.0.2]/v1/traces',
      'http://127.0.0.2:4319/v1/traces',
    ]) {
      const { container } = makeContainer({ credentials: { endpoint } })
      const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
        env: TENANT_ENV,
      })
      expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.endpointBlocked })
    }
  })

  test('endpoint_blocked when a DNS answer is private (rebinding target)', async () => {
    const { container } = makeContainer({ credentials: { endpoint: 'https://otel.acme.example/v1/traces' } })
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    const lookup = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ])
    const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
      env: TENANT_ENV,
      lookup: lookup as never,
    })
    expect(result).toEqual({ error: OTEL_EXPORT_DESTINATION_ERRORS.endpointBlocked })
  })

  test('never falls back to the deployment endpoint on any integration error', async () => {
    const deployment = resolveOtelExportDeployment(TENANT_ENV)
    const fixtures: IntegrationFixture[] = [
      { credentials: null },
      { enabled: false },
      { credentials: { endpoint: 'http://169.254.169.254/v1/traces' } },
    ]
    for (const fixture of fixtures) {
      const { container } = makeContainer(fixture)
      const result = await resolveOtelExportDestination(container, deployment, { destination: 'integration' }, SCOPE, {
        env: TENANT_ENV,
      })
      expect(isOtelExportDestinationError(result)).toBe(true)
      expect(JSON.stringify(result)).not.toContain('collector.deployment.test')
    }
  })
})

describe('parseOtlpHeadersStrict', () => {
  test('parses URL-encoded pairs and ignores empty segments', () => {
    expect(parseOtlpHeadersStrict('authorization=Bearer%20abc,, x-a = 1 ')).toEqual({
      authorization: 'Bearer abc',
      'x-a': '1',
    })
    expect(parseOtlpHeadersStrict(null)).toEqual({})
  })

  test('rejects the whole list on any malformed pair', () => {
    expect(parseOtlpHeadersStrict('a=1,novalue')).toBeNull()
    expect(parseOtlpHeadersStrict('=value')).toBeNull()
    expect(parseOtlpHeadersStrict('bad:name=value')).toBeNull()
    expect(parseOtlpHeadersStrict('x-a=one%0Atwo')).toBeNull()
    expect(parseOtlpHeadersStrict('x-a=one%0Dtwo')).toBeNull()
    expect(parseOtlpHeadersStrict('x-a=%zz')).toBeNull()
  })

  test('rejects values the HTTP client would refuse to send, keeping TAB and Latin-1', () => {
    expect(parseOtlpHeadersStrict('x-a=one%01two')).toBeNull()
    expect(parseOtlpHeadersStrict('x-a=one%7Ftwo')).toBeNull()
    expect(parseOtlpHeadersStrict('x-a=%E2%82%AC')).toBeNull()
    expect(parseOtlpHeadersStrict('x-a=one%09two,x-b=%C3%A9')).toEqual({ 'x-a': 'one\ttwo', 'x-b': '\u00e9' })
  })

  test('marks credentials with such a header value invalid instead of sending them', () => {
    expect(parseOtelExportIntegrationCredentials({ endpoint: TENANT_ENDPOINT, headers: 'authorization=%E2%82%AC' })).toEqual({
      ok: false,
      field: 'headers',
    })
  })
})

describe('integration health check with the real destination resolver', () => {
  const credentials = { endpoint: TENANT_ENDPOINT, headers: `authorization=Bearer%20${TENANT_SECRET}`, protocol: 'http/json' }

  test('sends the test span to the vetted, pinned tenant endpoint', async () => {
    postOtlpTraces.mockReset()
    postOtlpTraces.mockResolvedValue({ outcome: 'ok', httpStatus: 200, retryAfterMs: null, errorCode: null, latencyMs: 4 })
    const check = createOtelExportHealthCheck({ resolveDestination: createOtelExportHealthDestinationResolver({ env: TENANT_ENV }) })
    const result = await check.check(credentials, SCOPE)
    expect(result).toEqual({
      status: 'healthy',
      message: 'OTLP collector accepted the test span',
      details: { httpStatus: 200, latencyMs: 4 },
    })
    const input = postOtlpTraces.mock.calls[0][0] as Record<string, unknown>
    expect(input.endpoint).toBe(TENANT_ENDPOINT)
    expect(input.pinnedAddresses).toEqual(['127.0.0.1'])
    expect(input.headers).toEqual({ authorization: `Bearer ${TENANT_SECRET}` })
  })

  test('is degraded with tenant_endpoints_denied while the deployment denies tenant endpoints', async () => {
    postOtlpTraces.mockReset()
    const check = createOtelExportHealthCheck({ resolveDestination: createOtelExportHealthDestinationResolver({ env: BASE_ENV }) })
    const result = await check.check(credentials, SCOPE)
    expect(result).toMatchObject({ status: 'degraded', details: { reason: 'tenant_endpoints_denied' } })
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('is degraded with endpoint_blocked for a metadata endpoint and never echoes it', async () => {
    postOtlpTraces.mockReset()
    const check = createOtelExportHealthCheck({ resolveDestination: createOtelExportHealthDestinationResolver({ env: TENANT_ENV }) })
    const result = await check.check({ ...credentials, endpoint: 'http://169.254.169.254/v1/traces' }, SCOPE)
    expect(result).toMatchObject({ status: 'degraded', details: { reason: 'endpoint_blocked' } })
    expect(JSON.stringify(result)).not.toContain('169.254')
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })

  test('reports malformed headers as invalid credentials naming only the field', async () => {
    postOtlpTraces.mockReset()
    const check = createOtelExportHealthCheck({ resolveDestination: createOtelExportHealthDestinationResolver({ env: TENANT_ENV }) })
    const result = await check.check({ ...credentials, headers: `authorization=${TENANT_SECRET}%0Ax` }, SCOPE)
    expect(result).toMatchObject({ status: 'unhealthy', details: { reason: 'invalid_credentials', field: 'headers' } })
    expect(JSON.stringify(result)).not.toContain(TENANT_SECRET)
    expect(postOtlpTraces).not.toHaveBeenCalled()
  })
})
