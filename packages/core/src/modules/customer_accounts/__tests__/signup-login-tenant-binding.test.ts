/**
 * @jest-environment node
 *
 * Source-level regression guards for the cross-tenant signup+login chain.
 * Fails the moment someone drops the tenant-bound organization lookup in signup
 * or removes the emailVerifiedAt gate from login.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MODULE_ROOT = resolve(__dirname, '..')

function readSource(relPath: string): string {
  return readFileSync(resolve(MODULE_ROOT, relPath), 'utf8')
}

describe('customer_accounts signup — organization lookup must bind tenantId', () => {
  const source = readSource('api/signup.ts')

  test('organization lookup SQL filters by tenant_id as well as id', () => {
    const lookupSqlPattern = /FROM\s+organizations\s+WHERE\s+id\s*=\s*\?\s+AND\s+tenant_id\s*=\s*\?/i
    expect(source).toMatch(lookupSqlPattern)
  })

  test('organization lookup passes both organizationId and tenantId as parameters', () => {
    const paramsPattern = /\[\s*organizationId\s*,\s*tenantId\s*\]/
    expect(source).toMatch(paramsPattern)
  })

  test('mismatched pair no longer slips through — legacy id-only lookup removed', () => {
    const legacyPattern = /FROM\s+organizations\s+WHERE\s+id\s*=\s*\?\s+AND\s+deleted_at\s+IS\s+NULL\s+LIMIT\s+1/i
    expect(source).not.toMatch(legacyPattern)
  })
})

describe('customer_accounts login — emailVerifiedAt gate blocks unverified accounts', () => {
  const source = readSource('api/login.ts')

  test('login rejects users whose emailVerifiedAt is falsy', () => {
    const gatePattern = /if\s*\(\s*!\s*user\.emailVerifiedAt\s*\)/
    expect(source).toMatch(gatePattern)
  })

  test('login emits login.failed with email_not_verified reason for telemetry', () => {
    const emitPattern = /reason:\s*['"]email_not_verified['"]/
    expect(source).toMatch(emitPattern)
  })

  test('login verification gate runs after verifyPassword so we do not disclose existence', () => {
    const passwordIdx = source.indexOf('passwordValid')
    const gateIdx = source.search(/if\s*\(\s*!\s*user\.emailVerifiedAt\s*\)/)
    const sessionIdx = source.indexOf('createSession')
    expect(passwordIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(-1)
    expect(sessionIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(passwordIdx)
    expect(gateIdx).toBeLessThan(sessionIdx)
  })
})
