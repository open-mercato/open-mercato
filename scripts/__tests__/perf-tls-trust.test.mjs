import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPemCertificate, usesInternalCa } from '../../perf/scripts/lib/tls-trust.mjs'

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBozCCAUmgAwIBAgIQ\n-----END CERTIFICATE-----'

test('extractPemCertificate keeps only the certificate block', () => {
  assert.equal(extractPemCertificate(`noise before\n${PEM}\ntrailing`), `${PEM}\n`)
  assert.equal(extractPemCertificate('cat: no such file'), null)
  assert.equal(extractPemCertificate(undefined), null)
})

test('usesInternalCa follows PERF_TLS_CADDYFILE', () => {
  const env = (value) => ({ get: (key) => (key === 'PERF_TLS_CADDYFILE' ? value : undefined) })
  assert.equal(usesInternalCa(env(undefined)), true)
  assert.equal(usesInternalCa(env('Caddyfile.internal')), true)
  assert.equal(usesInternalCa(env('Caddyfile.domain')), false)
  assert.equal(usesInternalCa(null), true)
})
