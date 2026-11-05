/** @jest-environment node */
import { EventEmitter } from 'node:events'
import { lookup } from 'node:dns/promises'
import type { LookupAddress, LookupAllOptions } from 'node:dns'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { request, type RequestOptions } from 'node:https'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DomainMappingService, __testing__ } from '../domainMappingService'

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
jest.mock('node:https', () => ({ request: jest.fn() }))
jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

const lookupMock = jest.mocked(lookup as (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>)
const requestMock = jest.mocked(request as (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest)
const failed = { ok: false, originHeaderPresent: false, reason: 'TLS health check failed' }

function createRequest() {
  return Object.assign(new EventEmitter(), { end: jest.fn(), destroy: jest.fn() })
}

function respond(statusCode = 200) {
  const response = { statusCode, headers: { 'x-open-mercato-origin': '1' }, resume: jest.fn() }
  const callback = requestMock.mock.calls[0][1]
  if (typeof callback !== 'function') throw new Error('[internal] Missing response callback')
  callback(response as unknown as IncomingMessage)
  return response
}

async function startProbe() {
  const result = __testing__.defaultHealthCheck('shop.example.com', 100)
  await Promise.resolve()
  await Promise.resolve()
  return { result }
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.resetAllMocks()
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  requestMock.mockReturnValue(createRequest() as unknown as ReturnType<typeof request>)
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('default domain health check DNS safety', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '192.0.2.1', '224.0.0.1', '::', '::1', 'fc00::1',
    'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1',
  ])('opens no request for non-public DNS answer %s', async (address) => {
    lookupMock.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
    await expect(__testing__.defaultHealthCheck('shop.example.com', 100)).resolves.toEqual(failed)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('rejects a mixed public/private answer before opening a request', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }, { address: '::ffff:10.0.0.1', family: 6 },
    ])
    await expect(__testing__.defaultHealthCheck('shop.example.com', 100)).resolves.toEqual(failed)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it.each(['93.184.216.34', '2606:4700:4700::1111'])(
    'pins %s while preserving original TLS identity and routing', async (address) => {
      lookupMock.mockResolvedValueOnce([{ address, family: address.includes(':') ? 6 : 4 }])
        .mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
      const { result } = await startProbe()
      expect(lookupMock).toHaveBeenCalledTimes(1)
      expect(lookupMock).toHaveBeenCalledWith('shop.example.com', { all: true, verbatim: true })
      expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
        host: address, servername: 'shop.example.com', rejectUnauthorized: true, agent: false,
        port: 443, method: 'GET', path: '/api/customer_accounts/domain-check',
        headers: expect.objectContaining({ Host: 'shop.example.com' }),
      }), expect.any(Function))
      const response = respond()
      await expect(result).resolves.toMatchObject({ ok: true, originHeaderPresent: true })
      expect(response.resume).toHaveBeenCalled()
      expect(lookupMock).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    },
  )

  it.each(['ENOTFOUND private.resolver', 'CERT_HAS_EXPIRED secret.internal'])('hides network error %s', async (message) => {
    const { result } = await startProbe()
    const req = requestMock.mock.results[0].value as ReturnType<typeof createRequest>
    req.emit('error', new Error(message))
    await expect(result).resolves.toEqual(failed)
  })

  it('handles DNS failure without opening a request or exposing raw details', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND sensitive.internal'))
    await expect(__testing__.defaultHealthCheck('shop.example.com', 100)).resolves.toEqual(failed)
    expect(requestMock).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[internal] Domain TLS health check failed' }),
      { module: 'customer_accounts', code: 'customer_accounts.domain_health_check_failed' },
    )
  })

  it('rejects empty DNS answers', async () => {
    lookupMock.mockResolvedValue([])
    await expect(__testing__.defaultHealthCheck('shop.example.com', 100)).resolves.toEqual(failed)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('bounds DNS time and never opens a socket for a late DNS answer', async () => {
    let finishLookup: (records: Array<{ address: string; family: number }>) => void = () => undefined
    lookupMock.mockImplementation(() => new Promise<LookupAddress[]>((resolve) => { finishLookup = resolve }))
    const { result } = await startProbe()
    await jest.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toEqual(failed)
    finishLookup([{ address: '93.184.216.34', family: 4 }])
    await Promise.resolve()
    await Promise.resolve()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('destroys a stalled HTTPS request at the total deadline', async () => {
    const { result } = await startProbe()
    const req = requestMock.mock.results[0].value as ReturnType<typeof createRequest>
    await jest.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toEqual(failed)
    expect(req.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys a request on the socket timeout event', async () => {
    const { result } = await startProbe()
    const req = requestMock.mock.results[0].value as ReturnType<typeof createRequest>
    req.emit('timeout')
    await expect(result).resolves.toEqual(failed)
    expect(req.destroy).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('handles synchronous request setup failure', async () => {
    requestMock.mockImplementation(() => { throw new Error('[internal] Request setup failure') })
    await expect(__testing__.defaultHealthCheck('shop.example.com', 100)).resolves.toEqual(failed)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('revalidates changed DNS answers on every retry', async () => {
    const req = createRequest()
    req.end.mockImplementation(() => { req.emit('error', new Error('certificate mismatch')) })
    requestMock.mockReturnValue(req as unknown as ReturnType<typeof request>)
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const entity = { id: 'domain-id', hostname: 'shop.example.com', status: 'tls_failed', tlsRetryCount: 1 }
    const em = { findOne: jest.fn(async () => entity), persist: jest.fn(() => ({ flush: async () => undefined })) }
    const service = new DomainMappingService(em as unknown as EntityManager)
    await expect(service.healthCheck(entity.id)).resolves.toMatchObject({ status: 'tls_failed', tlsRetryCount: 2 })
    expect(lookupMock).toHaveBeenCalledTimes(3)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('does not resolve or probe an already active mapping', async () => {
    const entity = { id: 'domain-id', hostname: 'shop.example.com', status: 'active' }
    const em = { findOne: jest.fn(async () => entity) }
    const service = new DomainMappingService(em as unknown as EntityManager)
    await expect(service.healthCheck(entity.id)).resolves.toBe(entity)
    expect(lookupMock).not.toHaveBeenCalled()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('keeps HTTP failure diagnostics bounded', async () => {
    const { result } = await startProbe()
    respond(503)
    await expect(result).resolves.toEqual({ ...failed, originHeaderPresent: true, reason: 'HTTP 503' })
  })

  it('moves a verified mapping with blocked DNS to tls_failed after retries', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const entity = { id: 'domain-id', hostname: 'shop.example.com', status: 'verified', tlsRetryCount: 0 }
    const em = { findOne: jest.fn(async () => entity), persist: jest.fn(() => ({ flush: async () => undefined })) }
    const service = new DomainMappingService(em as unknown as EntityManager)
    const result = await service.healthCheck(entity.id)
    expect(result).toMatchObject({ status: 'tls_failed', tlsRetryCount: 1, tlsFailureReason: failed.reason })
    expect(lookupMock).toHaveBeenCalledTimes(3)
    expect(requestMock).not.toHaveBeenCalled()
  })
})
