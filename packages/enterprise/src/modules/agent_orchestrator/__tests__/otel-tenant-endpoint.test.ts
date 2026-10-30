import { afterEach, describe, expect, jest, test } from '@jest/globals'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { resolveOtelExportDeployment } from '../lib/trace/otel/exportSettings'
import { OTEL_EXPORT_MARKER_HEADER, postOtlpTraces } from '../lib/trace/otel/otlpHttpClient'
import {
  OTEL_TENANT_ENDPOINT_BLOCKED,
  readOtelExportPrivateHosts,
  vetTenantOtlpEndpoint,
} from '../lib/trace/otel/tenantEndpoint'

jest.mock('node:http', () => {
  const actual = jest.requireActual<typeof import('node:http')>('node:http')
  return { ...actual, request: jest.fn(actual.request) }
})

const requestMock = http.request as jest.MockedFunction<typeof http.request>

type LookupRecord = { address: string; family: number }

function resolvesTo(...addresses: string[]) {
  return jest.fn(async (_hostname: string): Promise<LookupRecord[]> =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  )
}

const blocked = { ok: false, errorCode: OTEL_TENANT_ENDPOINT_BLOCKED }

describe('tenant endpoint deployment flags', () => {
  test('tenant endpoints are denied by default and for unknown values', () => {
    expect(resolveOtelExportDeployment({}).tenantEndpointsAllowed).toBe(false)
    expect(resolveOtelExportDeployment({ OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS: 'deny' }).tenantEndpointsAllowed).toBe(false)
    expect(resolveOtelExportDeployment({ OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS: 'yes' }).tenantEndpointsAllowed).toBe(false)
  })

  test('tenant endpoints are allowed only with allow', () => {
    expect(resolveOtelExportDeployment({ OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS: ' Allow ' }).tenantEndpointsAllowed).toBe(true)
  })

  test('the private host allowlist is a trimmed, lower-cased, de-duplicated comma list', () => {
    expect(readOtelExportPrivateHosts({})).toEqual([])
    expect(
      readOtelExportPrivateHosts({ OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS: ' Collector.internal ,collector.internal,,10.0.0.5' }),
    ).toEqual(['collector.internal', '10.0.0.5'])
  })
})

describe('vetTenantOtlpEndpoint', () => {
  test('accepts a public https endpoint and returns its resolved addresses', async () => {
    const lookup = resolvesTo('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946')
    await expect(vetTenantOtlpEndpoint('https://otlp.example.com/v1/traces', {}, { lookup })).resolves.toEqual({
      ok: true,
      url: 'https://otlp.example.com/v1/traces',
      addresses: ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
    })
    expect(lookup).toHaveBeenCalledWith('otlp.example.com')
  })

  test('accepts a public IP literal without a DNS lookup', async () => {
    const lookup = resolvesTo('10.0.0.1')
    await expect(vetTenantOtlpEndpoint('http://93.184.216.34:4318/v1/traces', {}, { lookup })).resolves.toEqual({
      ok: true,
      url: 'http://93.184.216.34:4318/v1/traces',
      addresses: ['93.184.216.34'],
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  test.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data'],
    ['IPv4 loopback', 'http://127.0.0.1:4318/v1/traces'],
    ['localhost', 'http://localhost:4318/v1/traces'],
    ['localhost subdomain', 'http://collector.localhost/v1/traces'],
    ['IPv6 loopback', 'http://[::1]:4318/v1/traces'],
    ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/v1/traces'],
    ['IPv4-mapped IPv6 metadata', 'http://[::ffff:169.254.169.254]/v1/traces'],
    ['IPv6 link-local', 'http://[fe80::1]/v1/traces'],
    ['IPv6 unique local', 'http://[fd00::1]/v1/traces'],
    ['10/8', 'http://10.1.2.3/v1/traces'],
    ['172.16/12', 'http://172.20.0.5/v1/traces'],
    ['192.168/16', 'http://192.168.1.10/v1/traces'],
    ['CGNAT', 'http://100.64.0.1/v1/traces'],
    ['unspecified', 'http://0.0.0.0/v1/traces'],
    ['credentials in URL', 'https://user:secret@otlp.example.com/v1/traces'],
    ['username only in URL', 'https://user@otlp.example.com/v1/traces'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://otlp.example.com/v1/traces'],
    ['gopher scheme', 'gopher://otlp.example.com/'],
    ['not a URL', 'not a url'],
  ])('blocks %s', async (_label, url) => {
    await expect(vetTenantOtlpEndpoint(url, {}, { lookup: resolvesTo('93.184.216.34') })).resolves.toEqual(blocked)
  })

  test.each([
    ['a private IPv4', ['10.0.0.7']],
    ['the metadata IP', ['169.254.169.254']],
    ['loopback', ['127.0.0.1']],
    ['IPv6 loopback', ['::1']],
    ['an IPv4-mapped private IPv6', ['::ffff:192.168.0.1']],
    ['one private among public answers', ['93.184.216.34', '10.0.0.7']],
  ])('blocks a DNS name resolving to %s', async (_label, addresses) => {
    await expect(
      vetTenantOtlpEndpoint('https://otlp.example.com/v1/traces', {}, { lookup: resolvesTo(...addresses) }),
    ).resolves.toEqual(blocked)
  })

  test('fails closed when the host does not resolve', async () => {
    const failing = jest.fn(async (_hostname: string): Promise<LookupRecord[]> => {
      throw new Error('ENOTFOUND')
    })
    await expect(vetTenantOtlpEndpoint('https://otlp.example.com/v1/traces', {}, { lookup: failing })).resolves.toEqual(blocked)
    await expect(vetTenantOtlpEndpoint('https://otlp.example.com/v1/traces', {}, { lookup: resolvesTo() })).resolves.toEqual(blocked)
  })

  test('an allow-listed host may resolve to a private address', async () => {
    const env = { OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS: 'collector.internal' }
    await expect(
      vetTenantOtlpEndpoint('http://otlp.collector.internal:4318/v1/traces', env, { lookup: resolvesTo('10.0.0.7') }),
    ).resolves.toEqual({ ok: true, url: 'http://otlp.collector.internal:4318/v1/traces', addresses: ['10.0.0.7'] })
  })

  test('the allowlist matches on a dot boundary only and never lifts the scheme or credential checks', async () => {
    const env = { OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS: 'collector.internal' }
    const lookup = resolvesTo('10.0.0.7')
    await expect(vetTenantOtlpEndpoint('http://evilcollector.internal/v1/traces', env, { lookup })).resolves.toEqual(blocked)
    await expect(vetTenantOtlpEndpoint('http://user:pw@collector.internal/v1/traces', env, { lookup })).resolves.toEqual(blocked)
    await expect(vetTenantOtlpEndpoint('ftp://collector.internal/v1/traces', env, { lookup })).resolves.toEqual(blocked)
  })

  test('the blocked result never carries the endpoint', async () => {
    const result = await vetTenantOtlpEndpoint('https://secret-token@169.254.169.254/x', {}, { lookup: resolvesTo() })
    expect(JSON.stringify(result)).not.toContain('secret-token')
    expect(JSON.stringify(result)).not.toContain('169.254')
  })
})

type Received = { url: string; host: string | undefined; headers: http.IncomingHttpHeaders; body: Buffer }

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const received: Received[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({ url: req.url ?? '', host: req.headers.host, headers: req.headers, body: Buffer.concat(chunks) })
      handler(req, res)
    })
  })
  return new Promise<{ server: http.Server; port: number; received: Received[] }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received }))
  })
}

const servers: http.Server[] = []

afterEach(async () => {
  requestMock.mockClear()
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

describe('postOtlpTraces with pinned addresses', () => {
  const BODY = JSON.stringify({ resourceSpans: [] })

  test('connects to the pinned IP without DNS and keeps the hostname in the Host header', async () => {
    const { server, port, received } = await startServer((_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    servers.push(server)
    const fetchImpl = jest.fn(async () => new Response(null, { status: 500 }))
    const result = await postOtlpTraces({
      endpoint: `http://otlp.unresolvable.invalid:${port}/v1/traces?x=1`,
      headers: { authorization: 'Bearer t' },
      body: BODY,
      pinnedAddresses: ['127.0.0.1'],
      fetchImpl,
    })
    expect(result).toMatchObject({ outcome: 'ok', httpStatus: 200, errorCode: null })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(received).toHaveLength(1)
    expect(received[0].url).toBe('/v1/traces?x=1')
    expect(received[0].host).toBe(`otlp.unresolvable.invalid:${port}`)
    expect(received[0].headers['content-type']).toBe('application/json')
    expect(received[0].headers['content-encoding']).toBe('gzip')
    expect(received[0].headers[OTEL_EXPORT_MARKER_HEADER]).toBe('1')
    expect(received[0].headers.authorization).toBe('Bearer t')
    expect(gunzipSync(received[0].body).toString('utf8')).toBe(BODY)
  })

  test('does not follow a redirect', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })
    servers.push(target.server)
    const redirecting = await startServer((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${target.port}/v1/traces` })
      res.end()
    })
    servers.push(redirecting.server)
    const result = await postOtlpTraces({
      endpoint: `http://otlp.example.com:${redirecting.port}/v1/traces`,
      body: BODY,
      pinnedAddresses: ['127.0.0.1'],
    })
    expect(result).toMatchObject({ outcome: 'drop', httpStatus: 307, errorCode: 'http_307' })
    expect(redirecting.received).toHaveLength(1)
    expect(target.received).toHaveLength(0)
  })

  test('honors Retry-After on a retryable status', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(503, { 'retry-after': '4' })
      res.end()
    })
    servers.push(server)
    const result = await postOtlpTraces({
      endpoint: `http://otlp.example.com:${port}/v1/traces`,
      body: BODY,
      pinnedAddresses: ['127.0.0.1'],
    })
    expect(result).toMatchObject({ outcome: 'retry', httpStatus: 503, retryAfterMs: 4000, errorCode: 'http_503' })
  })

  test('times out a stalled endpoint as a retry', async () => {
    const { server, port } = await startServer(() => undefined)
    servers.push(server)
    const result = await postOtlpTraces({
      endpoint: `http://otlp.example.com:${port}/v1/traces`,
      body: BODY,
      pinnedAddresses: ['127.0.0.1'],
      timeoutMs: 50,
    })
    expect(result).toMatchObject({ outcome: 'retry', httpStatus: null, errorCode: 'timeout' })
    server.closeAllConnections()
  })

  test('a connection failure is a network retry', async () => {
    const { server, port } = await startServer(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const result = await postOtlpTraces({
      endpoint: `http://otlp.example.com:${port}/v1/traces`,
      body: BODY,
      pinnedAddresses: ['127.0.0.1'],
    })
    expect(result).toMatchObject({ outcome: 'retry', errorCode: 'network_error' })
  })

  test.each([
    ['an empty pin list', []],
    ['a hostname instead of an IP', ['otlp.example.com']],
  ])('drops with %s without sending', async (_label, pinnedAddresses) => {
    const fetchImpl = jest.fn(async () => new Response(null, { status: 200 }))
    const result = await postOtlpTraces({
      endpoint: 'http://otlp.example.com/v1/traces',
      body: BODY,
      pinnedAddresses,
      fetchImpl,
    })
    expect(result).toMatchObject({ outcome: 'drop', errorCode: 'invalid_endpoint' })
    expect(requestMock).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('the pinned lookup resolves the hostname to the vetted address only', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(204)
      res.end()
    })
    servers.push(server)
    await postOtlpTraces({
      endpoint: `http://otlp.example.com:${port}/v1/traces`,
      body: BODY,
      pinnedAddresses: ['127.0.0.1'],
    })
    expect(requestMock).toHaveBeenCalledTimes(1)
    const options = requestMock.mock.calls[0][0] as http.RequestOptions
    expect(options.hostname).toBe('otlp.example.com')
    expect(typeof options.lookup).toBe('function')
    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options.lookup?.('otlp.example.com', {}, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address: address as string, family: family as number })
      })
    })
    expect(resolved).toEqual({ address: '127.0.0.1', family: 4 })
  })

  test('deployment endpoints without pins keep the fetch path', async () => {
    const fetchImpl = jest.fn(async () => new Response(null, { status: 200 }))
    const result = await postOtlpTraces({ endpoint: 'http://collector:4318/v1/traces', body: BODY, fetchImpl })
    expect(result.outcome).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(requestMock).not.toHaveBeenCalled()
  })
})
