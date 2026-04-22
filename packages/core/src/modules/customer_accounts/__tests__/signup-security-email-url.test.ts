/**
 * @jest-environment node
 *
 * Source-level regression guard for the customer signup host-header-injection
 * fix. Signup must build verification and existing-account email URLs from
 * APP_URL via the security-email helper, never from request headers.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MODULE_ROOT = resolve(__dirname, '..')

function readSource(relPath: string): string {
  return readFileSync(resolve(MODULE_ROOT, relPath), 'utf8')
}

describe('customer_accounts signup — security email URL', () => {
  const signupSource = readSource('api/signup.ts')

  test('uses getSecurityEmailBaseUrl for email URL construction', () => {
    expect(signupSource).toMatch(/getSecurityEmailBaseUrl\s*\(\s*req\s*\)/)
  })

  test('wraps security URL resolution with mapSecurityEmailUrlError', () => {
    expect(signupSource).toMatch(/mapSecurityEmailUrlError\s*\(/)
    expect(signupSource).toMatch(/scope:\s*['"]customer_accounts\.signup['"]/)
  })

  test('does not fall back to getAppBaseUrl/resolveRequestOrigin for email URLs', () => {
    expect(signupSource).not.toMatch(/getAppBaseUrl\s*\(/)
    expect(signupSource).not.toMatch(/resolveRequestOrigin\s*\(/)
  })
})
