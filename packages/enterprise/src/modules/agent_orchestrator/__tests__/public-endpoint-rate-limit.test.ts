/** @jest-environment node */
// The four unauthenticated / credential-verifying agent_orchestrator endpoints had
// no ceiling: every /identity/token request costs a bcrypt compare per candidate
// secret, /identity/agent/auth verifies a signature and WRITES, and /trace/ingest
// verifies an HMAC and WRITES. These assert the ceiling exists, that it is charged
// BEFORE the credential work (so the CPU-amplification vector is actually closed),
// and that a lost limiter fails closed while an unconfigured one fails open.
import type { AwilixContainer } from 'awilix'
import { NextResponse } from 'next/server'
import {
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_FALLBACK_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig, RateLimitResult } from '@open-mercato/shared/lib/ratelimit/types'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

const issueAgentToken = jest.fn()
jest.mock('../lib/identity/agentTokenService', () => {
  const actual = jest.requireActual('../lib/identity/agentTokenService')
  return {
    ...actual,
    issueAgentToken: (...args: unknown[]) => issueAgentToken(...args),
  }
})

const verifyIdJagAssertion = jest.fn()
const registerAgentViaIdJag = jest.fn()
const getAgentAuthDiscovery = jest.fn()
jest.mock('../lib/identity/agentAuthMdService', () => {
  const actual = jest.requireActual('../lib/identity/agentAuthMdService')
  return {
    ...actual,
    verifyIdJagAssertion: (...args: unknown[]) => verifyIdJagAssertion(...args),
    registerAgentViaIdJag: (...args: unknown[]) => registerAgentViaIdJag(...args),
    getAgentAuthDiscovery: (...args: unknown[]) => getAgentAuthDiscovery(...args),
  }
})

const verifyTraceIngestRequest = jest.fn()
jest.mock('../lib/trace/ingestAuth', () => {
  const actual = jest.requireActual('../lib/trace/ingestAuth')
  return {
    ...actual,
    verifyTraceIngestRequest: (...args: unknown[]) => verifyTraceIngestRequest(...args),
  }
})

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { POST as agentAuthPOST } from '../api/identity/agent/auth/route'
import { POST as tokenPOST } from '../api/identity/token/route'
import { GET as wellKnownGET } from '../api/identity/well-known/route'
import { POST as traceIngestPOST } from '../api/trace/ingest/route'
import { enforcePublicEndpointRateLimit } from '../lib/guardrails/publicEndpointRateLimit'

const ID_JAG_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

type LimiterState = RateLimiterService | 'absent' | 'broken'

function containerFor(state: LimiterState): AwilixContainer {
  return {
    hasRegistration: (key: string) => key === 'rateLimiterService' && state !== 'absent',
    resolve: (key: string) => {
      if (key !== 'rateLimiterService') throw new Error(`[test] unexpected resolve(${key})`)
      if (state === 'broken') throw new Error('[test] limiter is registered but misconfigured')
      if (state === 'absent') throw new Error('[test] rateLimiterService is not registered')
      return state
    },
  } as unknown as AwilixContainer
}

function useLimiter(state: LimiterState): void {
  ;(createRequestContainer as jest.Mock).mockResolvedValue(containerFor(state))
}

// A real in-memory limiter, so the 429 (and its headers) come from the shipped
// limiter rather than a stub that merely says "denied".
function memoryLimiter(): RateLimiterService {
  return new RateLimiterService({
    enabled: true,
    strategy: 'memory',
    keyPrefix: 'rl-test',
    trustProxyDepth: 1,
  })
}

function jsonRequest(path: string, ip: string, body: unknown): Request {
  return new Request(`http://test/api/agent_orchestrator${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

type PublicRoute = {
  label: string
  points: number
  allowedStatus: number
  credentialWork: jest.Mock
  invoke: (ip: string) => Promise<Response>
}

const routes: PublicRoute[] = [
  {
    label: 'POST /identity/token',
    points: 10,
    allowedStatus: 401,
    credentialWork: issueAgentToken,
    invoke: (ip) =>
      tokenPOST(
        jsonRequest('/identity/token', ip, {
          grant_type: 'client_credentials',
          client_id: 'client-1',
          client_secret: 'secret-1',
        }),
      ),
  },
  {
    label: 'POST /identity/agent/auth',
    points: 10,
    allowedStatus: 401,
    credentialWork: verifyIdJagAssertion,
    invoke: (ip) =>
      agentAuthPOST(
        jsonRequest('/identity/agent/auth', ip, {
          grant_type: ID_JAG_GRANT_TYPE,
          assertion: 'header.payload.signature',
        }),
      ),
  },
  {
    label: 'GET /identity/well-known',
    points: 60,
    allowedStatus: 200,
    credentialWork: getAgentAuthDiscovery,
    invoke: (ip) =>
      wellKnownGET(
        new Request('http://test/api/agent_orchestrator/identity/well-known', {
          headers: { 'x-forwarded-for': ip },
        }),
      ),
  },
  {
    label: 'POST /trace/ingest',
    points: 120,
    allowedStatus: 401,
    credentialWork: verifyTraceIngestRequest,
    invoke: (ip) => traceIngestPOST(jsonRequest('/trace/ingest', ip, { runtime: 'in-process' })),
  },
]

beforeEach(() => {
  issueAgentToken.mockReset()
  verifyIdJagAssertion.mockReset()
  registerAgentViaIdJag.mockReset()
  getAgentAuthDiscovery.mockReset()
  verifyTraceIngestRequest.mockReset()

  // Every credential collaborator rejects, so an allowed request answers with the
  // route's ordinary failure status and only the ceiling can change the outcome.
  issueAgentToken.mockResolvedValue(null)
  verifyIdJagAssertion.mockReturnValue(null)
  verifyTraceIngestRequest.mockReturnValue(null)
  getAgentAuthDiscovery.mockReturnValue({ issuer: 'open-mercato' })
})

describe.each(routes)('$label rate limiting', (route) => {
  it('429s once the configured points are spent for a client IP, before any credential work', async () => {
    useLimiter(memoryLimiter())
    const ip = '203.0.113.7'

    for (let i = 0; i < route.points; i += 1) {
      const allowed = await route.invoke(ip)
      expect(allowed.status).toBe(route.allowedStatus)
    }
    expect(route.credentialWork).toHaveBeenCalledTimes(route.points)

    const limited = await route.invoke(ip)
    expect(limited.status).toBe(429)
    expect((await limited.json()).error).toBe(RATE_LIMIT_ERROR_FALLBACK)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(limited.headers.get('X-RateLimit-Limit')).toBe(String(route.points))
    expect(limited.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(Number(limited.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(0)

    // The point of checking first: the refused request must not have paid for the
    // bcrypt / signature / HMAC verification it was rate limited out of.
    expect(route.credentialWork).toHaveBeenCalledTimes(route.points)
  })

  it('counts a different client IP on its own budget', async () => {
    useLimiter(memoryLimiter())
    for (let i = 0; i < route.points; i += 1) {
      await route.invoke('203.0.113.8')
    }
    expect((await route.invoke('203.0.113.8')).status).toBe(429)
    expect((await route.invoke('198.51.100.4')).status).toBe(route.allowedStatus)
  })

  it('fails CLOSED with 503 when the limiter is registered but unusable', async () => {
    useLimiter('broken')
    const res = await route.invoke('203.0.113.9')
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe(RATE_LIMIT_UNAVAILABLE_FALLBACK)
    expect(route.credentialWork).not.toHaveBeenCalled()
  })

  it('fails OPEN when no limiter is registered at all', async () => {
    useLimiter('absent')
    const res = await route.invoke('203.0.113.10')
    expect(res.status).toBe(route.allowedStatus)
    expect(route.credentialWork).toHaveBeenCalledTimes(1)
  })
})

describe('enforcePublicEndpointRateLimit', () => {
  const config: RateLimitConfig = { points: 5, duration: 60, keyPrefix: 'test:endpoint' }

  function limiterStub(result: RateLimitResult) {
    const consume = jest.fn(async () => result)
    const service = { trustProxyDepth: 1, consume } as unknown as RateLimiterService
    return { service, consume }
  }

  function request(ip: string): Request {
    return new Request('http://test/api/agent_orchestrator/identity/well-known', {
      headers: { 'x-forwarded-for': ip },
    })
  }

  it('keys on the client IP and prefixes it with the discriminator when one is passed', async () => {
    const { service, consume } = limiterStub({
      allowed: true,
      remainingPoints: 4,
      msBeforeNext: 0,
      consumedPoints: 1,
    })
    const outcome = await enforcePublicEndpointRateLimit(
      containerFor(service),
      request('203.0.113.11'),
      config,
      'discriminator',
    )
    expect(outcome).toBeNull()
    expect(consume).toHaveBeenCalledWith('discriminator:203.0.113.11', config)
  })

  it('falls back to a shared key when the client IP cannot be trusted', async () => {
    const { service, consume } = limiterStub({
      allowed: true,
      remainingPoints: 4,
      msBeforeNext: 0,
      consumedPoints: 1,
    })
    const untrusted = new Request('http://test/api/agent_orchestrator/identity/well-known')
    await enforcePublicEndpointRateLimit(containerFor(service), untrusted, config)
    expect(consume).toHaveBeenCalledWith(RATE_LIMIT_FALLBACK_KEY, config)
  })

  it('fails CLOSED with 503 when the limiter could not produce a real decision', async () => {
    const { service } = limiterStub({
      allowed: true,
      remainingPoints: 5,
      msBeforeNext: 0,
      consumedPoints: 0,
      degraded: true,
    })
    const outcome = await enforcePublicEndpointRateLimit(containerFor(service), request('203.0.113.12'), config)
    expect(outcome).toBeInstanceOf(NextResponse)
    expect(outcome!.status).toBe(503)
    expect((await outcome!.json()).error).toBe(RATE_LIMIT_UNAVAILABLE_FALLBACK)
  })
})
