import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LIVE_EVIDENCE_DIR_ENV, LIVE_NAMESPACE_PREFIX_ENV, LIVE_PROFILE_ENV, readLiveReadiness, writeLiveEvidence } from './live'
import type { LiveProfile } from './live'

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
  })
}
