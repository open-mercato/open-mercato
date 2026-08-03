import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const templateLoginRouteUrl = new URL(
  '../../template/src/app/login/page.tsx',
  import.meta.url,
)
const monorepoLoginRouteUrl = new URL(
  '../../../../apps/mercato/src/app/login/page.tsx',
  import.meta.url,
)

function readSource(url: URL): string {
  return fs.readFileSync(url, 'utf8')
}

test('template login route stays byte-identical to the monorepo route', () => {
  assert.equal(
    readSource(templateLoginRouteUrl),
    readSource(monorepoLoginRouteUrl),
    'template and monorepo login routes must stay in sync',
  )
})
