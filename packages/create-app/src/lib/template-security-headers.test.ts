import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCustomRoute } from 'next/dist/lib/build-custom-route'

import mainAppConfig from '../../../../apps/mercato/next.config'
import templateConfig from '../../template/next.config'

async function resolveHeaders(config: typeof mainAppConfig) {
  assert.equal(typeof config.headers, 'function', 'expected next.config.ts to declare headers()')
  return config.headers()
}

test('standalone template mirrors the main app response security headers', async () => {
  const mainAppHeaders = await resolveHeaders(mainAppConfig)
  const templateHeaders = await resolveHeaders(templateConfig)

  assert.deepEqual(
    templateHeaders,
    mainAppHeaders,
    'standalone template response security headers drifted from the main app baseline',
  )
})

function ruleMatches(rule: Awaited<ReturnType<typeof resolveHeaders>>[number], pathname: string): boolean {
  return new RegExp(buildCustomRoute('header', rule, '', false).regex).test(pathname)
}

function configCspFor(headers: Awaited<ReturnType<typeof resolveHeaders>>, pathname: string): string | undefined {
  let csp: string | undefined
  for (const rule of headers) {
    if (!ruleMatches(rule, pathname)) continue
    const header = rule.headers.find((entry) => entry.key === 'Content-Security-Policy')
    if (header) csp = header.value
  }
  return csp
}

test('standalone template keeps integration and attachment security policies', async () => {
  const headers = await resolveHeaders(templateConfig)

  for (const pathname of ['/', '/backend/checkout', '/api/attachments/image/abc']) {
    const appCsp = configCspFor(headers, pathname)
    assert.match(appCsp ?? '', /frame-src[^;]*https:\/\/js\.stripe\.com/, pathname)
    assert.match(appCsp ?? '', /frame-src[^;]*https:\/\/hooks\.stripe\.com/, pathname)
    assert.match(appCsp ?? '', /script-src[^;]*https:\/\/js\.stripe\.com/, pathname)
  }

  const vectorCsp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
  for (const pathname of ['/api/attachments/file/abc', '/api/attachments/file/abc/def', '/api/attachments/file/']) {
    assert.equal(
      configCspFor(headers, pathname),
      vectorCsp,
      `${pathname}: every response under the canonical file path, including the dispatcher's, gets one sandboxing CSP from config`,
    )
  }

  for (const pathname of ['/api/attachments/%66ile/abc', '/api/%61ttachments/file/abc']) {
    assert.notEqual(
      configCspFor(headers, pathname),
      vectorCsp,
      `${pathname}: header sources match the undecoded path, so the file route must not rely on this rule for encoded spellings`,
    )
  }

  for (const pathname of ['/', '/api/attachments/file/abc']) {
    const sameOriginRule = headers.find((rule) =>
      ruleMatches(rule, pathname)
      && rule.headers.some((entry) => entry.key === 'X-Content-Type-Options' && entry.value === 'nosniff'),
    )
    assert.ok(sameOriginRule, `${pathname} keeps X-Content-Type-Options: nosniff from config`)
  }
})
