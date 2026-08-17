import assert from 'node:assert/strict'
import test from 'node:test'

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

test('standalone template keeps integration and attachment security policies', async () => {
  const headers = await resolveHeaders(templateConfig)
  const globalRule = headers.find((rule) => rule.source === '/:path*')
  const attachmentRule = headers.find(
    (rule) => rule.source === '/api/attachments/file/:path*',
  )

  const globalCsp = globalRule?.headers.find(
    (header) => header.key === 'Content-Security-Policy',
  )?.value
  assert.match(globalCsp ?? '', /frame-src[^;]*https:\/\/js\.stripe\.com/)
  assert.match(globalCsp ?? '', /frame-src[^;]*https:\/\/hooks\.stripe\.com/)
  assert.match(globalCsp ?? '', /script-src[^;]*https:\/\/js\.stripe\.com/)

  assert.deepEqual(
    attachmentRule?.headers.find((header) => header.key === 'Content-Security-Policy'),
    { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
  )
})
