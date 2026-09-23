import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression guard for issue #5948.
 *
 * `registerTenantEncryptionSubscriber` used to be called only when
 * `kmsService.isHealthy()` returned true at bootstrap. That check runs once,
 * synchronously, during process startup: a Vault/KMS outage overlapping startup
 * left the subscriber unregistered for the entire process lifetime — every ORM
 * write that relies on it was persisted as plaintext, with no retry and no
 * re-registration once the KMS recovered. Only a restart cleared it.
 *
 * Registration must depend on the static `isTenantDataEncryptionEnabled()`
 * toggle alone. Live KMS health is re-checked by the subscriber on every
 * read/write (`TenantEncryptionSubscriber.encrypt`/`decrypt` both call
 * `service.isEnabled()`), so registering while the KMS is down is a safe no-op
 * that resumes encrypting the moment it recovers.
 *
 * bootstrap() itself needs a live ORM, DI container and the generated module
 * registry, so this asserts on the source: the health probe must not appear in
 * the condition that guards the registration call.
 */

const bootstrapSource = readFileSync(join(__dirname, '..', 'bootstrap.ts'), 'utf8')

function registrationGuard(): string {
  const call = bootstrapSource.indexOf('registerTenantEncryptionSubscriber(em,')
  expect(call).toBeGreaterThan(-1)
  // The `if (...) {` that opens the block containing the registration call.
  const opener = bootstrapSource.lastIndexOf('if (', call)
  expect(opener).toBeGreaterThan(-1)
  return bootstrapSource.slice(opener, call)
}

describe('tenant encryption subscriber registration gate (issue #5948)', () => {
  it('registers on the static encryption toggle', () => {
    expect(registrationGuard()).toContain('isTenantDataEncryptionEnabled()')
  })

  it('never gates registration on live KMS health', () => {
    expect(registrationGuard()).not.toContain('isHealthy')
  })

  it('still warns when the KMS is unhealthy at boot', () => {
    expect(bootstrapSource).toContain('kmsService.isHealthy()')
    expect(bootstrapSource).toMatch(/Vault\/KMS unhealthy/)
  })
})
