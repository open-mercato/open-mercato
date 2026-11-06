import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import Module, { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const moment = require('moment')
const postcss = require('postcss')

test('Moment rejects non-string locale names before resolving traversal paths', () => {
  const originalLoad = Module._load
  const requestedPaths = []
  Module._load = function (request, parent, isMain) {
    if (request === './locale/../security-locale-probe') {
      requestedPaths.push(request)
      return {}
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    moment.locale({
      match: () => true,
      toString: () => '../security-locale-probe',
      toLowerCase: () => 'en',
    })
    assert.deepEqual(requestedPaths, [])
  } finally {
    Module._load = originalLoad
    moment.locale('en')
  }
})

test('Moment preserves ordinary calendar and timezone consumers', () => {
  assert.equal(moment('2026-11-07').add(1, 'day').format('YYYY-MM-DD'), '2026-11-08')
  const momentTimezone = require('moment-timezone')
  assert.equal(momentTimezone.tz('2026-11-07 12:00', 'Europe/Warsaw').format('Z'), '+01:00')
})

test('PostCSS does not disclose an absolute source map without a source filename', async () => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'postcss-security-'))
  const secretPath = join(fixtureDirectory, 'secret.map')
  const secret = 'private-source-map-regression-marker'
  try {
    await writeFile(secretPath, JSON.stringify({
      version: 3,
      sources: ['/private/original.css'],
      sourcesContent: [secret],
      mappings: 'AAAA',
      names: [],
    }))
    const result = await postcss([]).process(`a{color:red}\n/*# sourceMappingURL=${secretPath} */`, { map: true })
    assert.equal(JSON.stringify(result.map?.toJSON()).includes(secret), false)
    assert.equal(JSON.stringify(result.map?.toJSON()).includes('/private/original.css'), false)
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true })
  }
})

test('PostCSS preserves ordinary CSS transformations and generated maps', async () => {
  const plugin = {
    postcssPlugin: 'security-smoke',
    Declaration(declaration) {
      if (declaration.prop === 'color') declaration.value = 'blue'
    },
  }
  const result = await postcss([plugin]).process('a{color:red}', { from: 'input.css', to: 'output.css', map: { inline: false } })
  assert.match(result.css, /color:blue/)
  assert.deepEqual(result.map.toJSON().sources, ['input.css'])
})
