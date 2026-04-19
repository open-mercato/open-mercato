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
  const signupSource = readSource('api/signup.ts')
  const helperSource = readSource('lib/organizationLookup.ts')

  test('signup delegates the lookup to the shared helper (no raw SQL in the route)', () => {
    expect(signupSource).toMatch(/findOrganizationInTenant\s*\(\s*em\s*,\s*organizationId\s*,\s*tenantId\s*\)/)
    expect(signupSource).not.toMatch(/FROM\s+organizations\s+WHERE/i)
  })

  test('helper lookup SQL filters by tenant_id as well as id', () => {
    const lookupSqlPattern = /FROM\s+organizations\s+WHERE\s+id\s*=\s*\?\s+AND\s+tenant_id\s*=\s*\?/i
    expect(helperSource).toMatch(lookupSqlPattern)
  })

  test('helper passes both organizationId and tenantId as parameters in order', () => {
    const paramsPattern = /\[\s*organizationId\s*,\s*tenantId\s*\]/
    expect(helperSource).toMatch(paramsPattern)
  })

  test('mismatched pair no longer slips through — legacy id-only lookup removed', () => {
    const legacyPattern = /FROM\s+organizations\s+WHERE\s+id\s*=\s*\?\s+AND\s+deleted_at\s+IS\s+NULL\s+LIMIT\s+1/i
    expect(signupSource).not.toMatch(legacyPattern)
    expect(helperSource).not.toMatch(legacyPattern)
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

  test('unverified-email response body reuses generic invalid-credentials copy (no enumeration oracle)', () => {
    const gateBlockPattern = /if\s*\(\s*!\s*user\.emailVerifiedAt\s*\)\s*\{[\s\S]*?NextResponse\.json\(\s*\{\s*ok:\s*false,\s*error:\s*['"]Invalid email or password['"]\s*\}/
    expect(source).toMatch(gateBlockPattern)
    expect(source).not.toMatch(/Please verify your email/i)
  })
})

describe('customer_accounts admin create — admin-vouched users are marked verified', () => {
  const source = readSource('api/admin/users.ts')

  test('admin createUser path stamps emailVerifiedAt so the login gate does not block admin-created accounts', () => {
    const stampPattern = /customerUserService\.createUser\([\s\S]*?\)\s*(?:\r?\n)\s*user\.emailVerifiedAt\s*=\s*new Date\(\)/
    expect(source).toMatch(stampPattern)
  })
})
