import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRegistryConfig } from '../index'

test('scoped registry config disables the Yarn minimal-age quarantine', () => {
  const config = buildRegistryConfig('http://localhost:4873')

  assert.match(config, /^ {4}npmMinimalAgeGate: 0$/m)

  const scopeIndex = config.indexOf('  open-mercato:')
  const gateIndex = config.indexOf('    npmMinimalAgeGate: 0')

  assert.ok(scopeIndex !== -1, 'expected the open-mercato scope block')
  assert.ok(
    gateIndex > scopeIndex,
    'npmMinimalAgeGate must sit inside the open-mercato scope — a top-level value loses to the scope default',
  )
})

test('scoped registry config disables the quarantine for private https registries too', () => {
  const config = buildRegistryConfig('https://npm.internal.example.com')

  assert.match(config, /^ {4}npmMinimalAgeGate: 0$/m)
  assert.match(config, /npmRegistryServer: "https:\/\/npm\.internal\.example\.com"/)
  assert.doesNotMatch(config, /unsafeHttpWhitelist/)
})

test('local http registries stay whitelisted alongside the quarantine opt-out', () => {
  const config = buildRegistryConfig('http://localhost:4873')

  assert.match(config, /unsafeHttpWhitelist:/)
  assert.match(config, /- "localhost"/)
  assert.match(config, /- "host\.docker\.internal"/)
})

test('registry config is empty-safe for invalid urls', () => {
  assert.throws(() => buildRegistryConfig('not a url'), /Invalid registry URL/)
})
