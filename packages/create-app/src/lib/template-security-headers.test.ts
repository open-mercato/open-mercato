import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants'

import resolveMainAppConfig from '../../../../apps/mercato/next.config'
import resolveTemplateConfig from '../../template/next.config'

async function resolveHeaders(resolveConfig: typeof resolveMainAppConfig, phase: string) {
  const config = resolveConfig(phase)
  assert.equal(typeof config.headers, 'function', 'expected next.config.ts to declare headers()')
  return config.headers!()
}

for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
  test(`standalone template mirrors the main app response security headers in ${phase}`, async () => {
    const mainAppHeaders = await resolveHeaders(resolveMainAppConfig, phase)
    const templateHeaders = await resolveHeaders(resolveTemplateConfig, phase)

    assert.deepEqual(
      templateHeaders,
      mainAppHeaders,
      `standalone template response security headers drifted from the main app baseline in ${phase}`,
    )
  })
}

test('standalone template keeps integration and attachment security policies', async () => {
  const headers = await resolveHeaders(resolveTemplateConfig, PHASE_PRODUCTION_SERVER)
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
