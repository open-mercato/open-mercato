import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRegistryConfig } from '../index.ts'

test('custom registries exempt exact Open Mercato packages from the release age quarantine', () => {
  const config = buildRegistryConfig('http://localhost:4874')

  assert.match(config, /npmScopes:\n  open-mercato:\n    npmRegistryServer: "http:\/\/localhost:4874"\n    npmMinimalAgeGate: 0/)
  assert.match(config, /unsafeHttpWhitelist:\n  - "localhost"\n  - "host\.docker\.internal"/)
})
