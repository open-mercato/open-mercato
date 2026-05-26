import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatBaseUrl,
  isStandardPort,
  parseConfiguredBaseUrl,
  parsePortNumber,
  resolveDevBaseUrl,
  resolveSplashUrl,
} from '../dev-splash-url.mjs'

test('parsePortNumber accepts strings and numbers in the valid range', () => {
  assert.equal(parsePortNumber('3000'), 3000)
  assert.equal(parsePortNumber(8080), 8080)
  assert.equal(parsePortNumber(' 4321 '), 4321)
  assert.equal(parsePortNumber('0'), null)
  assert.equal(parsePortNumber('70000'), null)
  assert.equal(parsePortNumber('not-a-port'), null)
  assert.equal(parsePortNumber(null), null)
  assert.equal(parsePortNumber(undefined), null)
})

test('isStandardPort matches scheme-default ports', () => {
  assert.equal(isStandardPort('http:', 80), true)
  assert.equal(isStandardPort('http', 80), true)
  assert.equal(isStandardPort('https:', 443), true)
  assert.equal(isStandardPort('http:', 443), false)
  assert.equal(isStandardPort('https:', 80), false)
  assert.equal(isStandardPort('http:', null), false)
  assert.equal(isStandardPort('ftp:', 21), false)
})

test('parseConfiguredBaseUrl returns scheme/host/port for valid http(s) URLs', () => {
  assert.deepEqual(parseConfiguredBaseUrl('https://devsandbox.openmercato.com'), {
    protocol: 'https:',
    hostname: 'devsandbox.openmercato.com',
    port: null,
  })
  assert.deepEqual(parseConfiguredBaseUrl('http://example.test:8080/path'), {
    protocol: 'http:',
    hostname: 'example.test',
    port: 8080,
  })
  assert.equal(parseConfiguredBaseUrl(''), null)
  assert.equal(parseConfiguredBaseUrl('not a url'), null)
  assert.equal(parseConfiguredBaseUrl('ftp://example.com'), null)
  assert.equal(parseConfiguredBaseUrl(undefined), null)
})

test('formatBaseUrl drops standard ports and keeps non-standard ports', () => {
  assert.equal(
    formatBaseUrl({ protocol: 'https:', hostname: 'devsandbox.openmercato.com', port: 443 }),
    'https://devsandbox.openmercato.com',
  )
  assert.equal(
    formatBaseUrl({ protocol: 'http:', hostname: 'example.test', port: 80 }),
    'http://example.test',
  )
  assert.equal(
    formatBaseUrl({ protocol: 'http:', hostname: 'localhost', port: 3000 }),
    'http://localhost:3000',
  )
  assert.equal(
    formatBaseUrl({ protocol: 'https:', hostname: 'example.test', port: null }),
    'https://example.test',
  )
})

test('formatBaseUrl can keep standard ports when explicitly requested', () => {
  assert.equal(
    formatBaseUrl(
      { protocol: 'https:', hostname: 'example.test', port: 443 },
      { includeStandardPort: true },
    ),
    'https://example.test:443',
  )
})

test('formatBaseUrl wraps bare IPv6 hostnames in brackets', () => {
  assert.equal(
    formatBaseUrl({ protocol: 'http:', hostname: '::1', port: 4000 }),
    'http://[::1]:4000',
  )
})

test('resolveDevBaseUrl falls back to localhost:3000 when nothing is configured', () => {
  const result = resolveDevBaseUrl({})
  assert.equal(result.url, 'http://localhost:3000')
  assert.equal(result.hasConfiguredBaseUrl, false)
  assert.equal(result.portWasRandomized, false)
  assert.equal(result.port, 3000)
  assert.equal(result.protocol, 'http:')
  assert.equal(result.hostname, 'localhost')
})

test('resolveDevBaseUrl honors PORT env when no APP_URL is set', () => {
  const result = resolveDevBaseUrl({ PORT: '4321' })
  assert.equal(result.url, 'http://localhost:4321')
  assert.equal(result.port, 4321)
})

test('resolveDevBaseUrl uses APP_URL with no explicit port (proxy-fronted)', () => {
  const result = resolveDevBaseUrl({ APP_URL: 'https://devsandbox.openmercato.com' })
  assert.equal(result.url, 'https://devsandbox.openmercato.com')
  assert.equal(result.hasConfiguredBaseUrl, true)
  assert.equal(result.port, null)
  assert.equal(result.portWasRandomized, false)
})

test('resolveDevBaseUrl drops port 80 / 443 even when configured explicitly', () => {
  const http80 = resolveDevBaseUrl({ APP_URL: 'http://example.test:80' })
  assert.equal(http80.url, 'http://example.test')
  assert.equal(http80.port, null)

  const https443 = resolveDevBaseUrl({ APP_URL: 'https://example.test:443' })
  assert.equal(https443.url, 'https://example.test')
  assert.equal(https443.port, null)
})

test('resolveDevBaseUrl keeps non-standard configured ports', () => {
  const result = resolveDevBaseUrl({ APP_URL: 'http://example.test:8080' })
  assert.equal(result.url, 'http://example.test:8080')
  assert.equal(result.port, 8080)
})

test('resolveDevBaseUrl uses configured loopback port when actualPort matches', () => {
  const result = resolveDevBaseUrl(
    { APP_URL: 'http://localhost:8080' },
    { actualPort: 8080 },
  )
  assert.equal(result.url, 'http://localhost:8080')
  assert.equal(result.portWasRandomized, false)
})

test('resolveDevBaseUrl reports randomization for loopback hosts when actualPort differs', () => {
  const result = resolveDevBaseUrl(
    { APP_URL: 'http://localhost:8080' },
    { actualPort: 8123 },
  )
  assert.equal(result.url, 'http://localhost:8123')
  assert.equal(result.portWasRandomized, true)
  assert.equal(result.port, 8123)
})

test('resolveDevBaseUrl keeps proxy-fronted port even when the internal bound port differs', () => {
  // APP_URL declares the public port (e.g. a non-standard reverse proxy port).
  // The dev server may bind to a different internal port; that internal port
  // is NOT reachable from the developer's browser and must not be substituted
  // into the printed URL.
  const result = resolveDevBaseUrl(
    { APP_URL: 'https://devsandbox.openmercato.com:9000' },
    { actualPort: 3000 },
  )
  assert.equal(result.url, 'https://devsandbox.openmercato.com:9000')
  assert.equal(result.port, 9000)
  assert.equal(result.portWasRandomized, false)
})

test('resolveDevBaseUrl keeps proxy host port-less even when an internal port is bound', () => {
  // APP_URL is https with no port — proxy fronts the standard 443. The local
  // dev server bound to 3000, but that port is internal and must not leak
  // into the printed URL.
  const result = resolveDevBaseUrl(
    { APP_URL: 'https://devsandbox.openmercato.com' },
    { actualPort: 3000 },
  )
  assert.equal(result.url, 'https://devsandbox.openmercato.com')
  assert.equal(result.port, null)
  assert.equal(result.portWasRandomized, false)
})

test('resolveDevBaseUrl falls back to NEXT_PUBLIC_APP_URL when APP_URL is missing', () => {
  const result = resolveDevBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://devsandbox.openmercato.com' })
  assert.equal(result.url, 'https://devsandbox.openmercato.com')
  assert.equal(result.hasConfiguredBaseUrl, true)
})

test('resolveDevBaseUrl falls back to localhost when APP_URL is invalid', () => {
  const result = resolveDevBaseUrl({ APP_URL: 'not-a-url', PORT: '5000' })
  assert.equal(result.url, 'http://localhost:5000')
  assert.equal(result.hasConfiguredBaseUrl, false)
})

test('resolveDevBaseUrl honors actualPort when no port is configured anywhere', () => {
  const result = resolveDevBaseUrl({}, { actualPort: 4567 })
  assert.equal(result.url, 'http://localhost:4567')
  assert.equal(result.port, 4567)
})

test('resolveDevBaseUrl honors a custom defaultHostname (e.g. 127.0.0.1 for ephemeral)', () => {
  const result = resolveDevBaseUrl({}, { defaultHostname: '127.0.0.1', actualPort: 5050 })
  assert.equal(result.url, 'http://127.0.0.1:5050')
})

test('resolveSplashUrl uses configured host with the actual splash port', () => {
  const url = resolveSplashUrl({ APP_URL: 'https://devsandbox.openmercato.com' }, 4123)
  assert.equal(url, 'https://devsandbox.openmercato.com:4123')
})

test('resolveSplashUrl drops standard ports for the configured scheme', () => {
  const url = resolveSplashUrl({ APP_URL: 'https://devsandbox.openmercato.com' }, 443)
  assert.equal(url, 'https://devsandbox.openmercato.com')
})

test('resolveSplashUrl falls back to localhost when APP_URL is missing', () => {
  const url = resolveSplashUrl({}, 4123)
  assert.equal(url, 'http://localhost:4123')
})

test('resolveSplashUrl supports a custom defaultHostname', () => {
  const url = resolveSplashUrl({}, 4123, { defaultHostname: '127.0.0.1' })
  assert.equal(url, 'http://127.0.0.1:4123')
})
