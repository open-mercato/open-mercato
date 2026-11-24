import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { CacheProviderError } from '@open-mercato/cache/provider'
import { createCachedCredentialsProvider } from '../src/credentials'
import {
  classifyLiveProbeFailure,
  LIVE_EVIDENCE_DIR_ENV,
  LIVE_NAMESPACE_PREFIX_ENV,
  LIVE_PROFILE_ENV,
  liveEvidenceStatus,
  probeEndpointReachabilitySync,
  readLiveCollectionReadiness,
  readLiveReadiness,
  writeLiveEvidence,
} from './live'
import type { LiveEndpoint, LiveProfile, LiveReachability } from './live'

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function wrapped(cause: unknown): CacheProviderError {
  return new CacheProviderError('unavailable', 'Cache provider "open-mercato/x" is unavailable', { providerId: 'open-mercato/x', cause })
}

const SECRET_VALUE = 'live-secret-value-8812'

/**
 * Readiness and evidence checks for a package's protected live profiles:
 * blocked output names variables and profile ids only, never values.
 */
export function defineLiveHarnessReadinessSuite(options: { packageDir: string; profiles: LiveProfile[] }): void {
  const { packageDir, profiles } = options

  describe('protected live harness readiness', () => {
    const profile = profiles[0]

    it('is not requested without an explicit profile', () => {
      expect(readLiveReadiness(profiles, {})).toEqual({ state: 'not-requested' })
    })

    it('names unknown profiles without echoing the requested value', () => {
      const readiness = readLiveReadiness(profiles, { [LIVE_PROFILE_ENV]: SECRET_VALUE })
      expect(readiness.state).toBe('unknown-profile')
      expect(JSON.stringify(readiness)).not.toContain(SECRET_VALUE)
      expect(JSON.stringify(readiness)).toContain(profile.id)
    })

    it('reports missing variable names only, never values', () => {
      const env: Record<string, string> = { [LIVE_PROFILE_ENV]: profile.id, [profile.required[0]]: SECRET_VALUE }
      const readiness = readLiveReadiness(profiles, env)
      expect(readiness.state).toBe('blocked')
      if (readiness.state !== 'blocked') return
      expect(readiness.missing).toEqual([...profile.required.slice(1), LIVE_NAMESPACE_PREFIX_ENV])
      expect(readiness.reason).toBe(`missing:${[...profile.required.slice(1), LIVE_NAMESPACE_PREFIX_ENV].join(',')}`)
      expect(readiness.message).toContain('RUNBOOK.md')
      expect(readiness.message).not.toContain(SECRET_VALUE)
    })

    it('rejects a namespace prefix that is not an isolated test prefix', () => {
      const env: Record<string, string> = { [LIVE_PROFILE_ENV]: profile.id, [LIVE_NAMESPACE_PREFIX_ENV]: 'has spaces!' }
      for (const name of profile.required) env[name] = 'set'
      expect(readLiveReadiness(profiles, env)).toMatchObject({ state: 'blocked', missing: [LIVE_NAMESPACE_PREFIX_ENV] })
      env[LIVE_NAMESPACE_PREFIX_ENV] = 'om-live-ci'
      expect(readLiveReadiness(profiles, env)).toMatchObject({ state: 'ready' })
    })

    it('writes a redacted evidence record with generic fields only', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'om-live-evidence-'))
      try {
        const file = writeLiveEvidence(packageDir, { profile: profile.id, status: 'blocked', reason: 'missing:X', tests: { total: 0, passed: 0, failed: 0, skipped: 0 } }, { [LIVE_EVIDENCE_DIR_ENV]: dir, OM_CACHE_LIVE_RUNNER_REF: 'job-1' })
        const record = JSON.parse(readFileSync(file, 'utf8'))
        expect(Object.keys(record).sort()).toEqual(['date', 'package', 'profile', 'reason', 'runner', 'status', 'tests', 'version'])
        expect(record).toMatchObject({ profile: profile.id, status: 'blocked', runner: 'job-1' })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    describe('collection-time decision (real skips)', () => {
      const readyEnv = (): Record<string, string> => {
        const env: Record<string, string> = { [LIVE_PROFILE_ENV]: profile.id, [LIVE_NAMESPACE_PREFIX_ENV]: 'om-live-ci' }
        for (const name of profile.required) env[name] = 'live-host.example.internal'
        return env
      }

      it('does not probe the network while variables are missing', () => {
        const reachability = jest.fn((): LiveReachability => 'reachable')
        expect(readLiveCollectionReadiness(profiles, { [LIVE_PROFILE_ENV]: profile.id }, reachability).state).toBe('blocked')
        expect(reachability).not.toHaveBeenCalled()
      })

      it.each(['dns', 'unreachable', 'timeout'] as const)('blocks an unreachable endpoint (%s) with a stable reason and no endpoint value', (outcome) => {
        const readiness = readLiveCollectionReadiness(profiles, readyEnv(), () => outcome)
        expect(readiness).toMatchObject({ state: 'blocked', reason: `network:${outcome}`, missing: [] })
        expect(JSON.stringify(readiness)).not.toContain('live-host.example.internal')
      })

      it('runs a fully configured, reachable profile', () => {
        const seen: LiveEndpoint[] = []
        const readiness = readLiveCollectionReadiness(profiles, readyEnv(), (endpoint) => {
          seen.push(endpoint)
          return 'reachable'
        })
        expect(readiness.state).toBe('ready')
        expect(seen).toHaveLength(1)
        expect(typeof seen[0].port).toBe('number')
      })

      it('probes DNS and TCP synchronously in a child process', async () => {
        const server = net.createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as net.AddressInfo).port
        try {
          expect(probeEndpointReachabilitySync({ host: '127.0.0.1', port }, 2_000)).toBe('reachable')
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
        expect(probeEndpointReachabilitySync({ host: '127.0.0.1', port }, 2_000)).toBe('unreachable')
        expect(probeEndpointReachabilitySync({ host: 'om-cache-live.invalid', port: 6379 }, 2_000)).toMatch(/^(dns|timeout)$/)
      }, 30_000)
    })

    describe('readiness probe failure classification', () => {
      it('treats a missing credential from the identity source as blocked', async () => {
        const credentials = createCachedCredentialsProvider(async () => {
          throw new Error('ManagedIdentityCredential: no managed identity endpoint')
        }, { providerId: 'open-mercato/x', sourceLabel: 'identity', refreshSkewMs: 0 })
        const failure = await credentials().catch((error: unknown) => error)
        expect(classifyLiveProbeFailure(failure)).toEqual({ status: 'blocked', reason: 'credentials:unavailable' })
      })

      it.each([
        ['ENOTFOUND', 'network:dns'],
        ['EAI_AGAIN', 'network:dns'],
        ['ECONNREFUSED', 'network:unreachable'],
        ['EHOSTUNREACH', 'network:unreachable'],
        ['ETIMEDOUT', 'network:timeout'],
      ])('treats %s as blocked (%s)', (code, reason) => {
        expect(classifyLiveProbeFailure(wrapped(withCode(`connect ${code} 10.0.0.1:6379`, code)))).toEqual({ status: 'blocked', reason })
      })

      it('treats a connect timeout as blocked', () => {
        expect(classifyLiveProbeFailure(new Error('[internal] RESP connection was not ready within 10000ms'))).toEqual({ status: 'blocked', reason: 'network:timeout' })
      })

      it('fails on settings errors', () => {
        const failure = new CacheProviderError('invalid_settings', 'settings are invalid at: host', { providerId: 'open-mercato/x', fieldPaths: ['host'] })
        expect(classifyLiveProbeFailure(failure)).toEqual({ status: 'failed', reason: 'cache-provider:invalid_settings' })
      })

      it.each(['WRONGPASS invalid username-password pair or user is disabled.', 'NOAUTH Authentication required.', 'NOPERM this user has no permissions'])('fails on an auth rejection from a reachable endpoint (%s)', (message) => {
        const outcome = classifyLiveProbeFailure(wrapped(Object.assign(new Error(message), { name: 'ReplyError' })))
        expect(outcome.status).toBe('failed')
        expect(outcome.reason).toBe(`auth:${message.split(' ')[0]}`)
      })

      it('an auth rejection reported while connecting wins over a later timeout', () => {
        const outcome = classifyLiveProbeFailure(new Error('[internal] RESP connection was not ready within 10000ms'), [new Error('WRONGPASS invalid username-password pair')])
        expect(outcome).toEqual({ status: 'failed', reason: 'auth:WRONGPASS' })
      })

      it('fails on TLS verification errors and anything unrecognized', () => {
        expect(classifyLiveProbeFailure(wrapped(withCode('Hostname/IP does not match certificate', 'ERR_TLS_CERT_ALTNAME_INVALID')))).toEqual({ status: 'failed', reason: 'cache-provider:unavailable' })
        expect(classifyLiveProbeFailure(withCode('self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'))).toEqual({ status: 'failed', reason: 'error:DEPTH_ZERO_SELF_SIGNED_CERT' })
        expect(classifyLiveProbeFailure(new TypeError('boom'))).toEqual({ status: 'failed', reason: 'TypeError' })
      })
    })

    describe('evidence status', () => {
      const totals = (total: number, passed: number, failed: number, skipped: number) => ({ total, passed, failed, skipped })

      it('keeps the probe outcome and never reports passed when nothing ran', () => {
        expect(liveEvidenceStatus({ status: 'blocked', reason: 'network:timeout' }, totals(5, 0, 0, 5))).toBe('blocked')
        expect(liveEvidenceStatus({ status: 'failed', reason: 'auth:WRONGPASS' }, totals(5, 0, 5, 0))).toBe('failed')
        expect(liveEvidenceStatus(null, totals(0, 0, 0, 0))).toBe('failed')
        expect(liveEvidenceStatus(null, totals(5, 4, 0, 0))).toBe('failed')
        expect(liveEvidenceStatus(null, totals(5, 4, 1, 0))).toBe('failed')
        expect(liveEvidenceStatus(null, totals(5, 5, 0, 0))).toBe('passed')
      })
    })
  })
}
