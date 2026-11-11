import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const consumerRequire = createRequire(require.resolve('@google-cloud/storage'))
const { XMLParser } = consumerRequire('fast-xml-parser')

test('Google Cloud Storage XML listing and stop-node content remain readable', () => {
  const listing = new XMLParser().parse('<ListBucketResult><Contents><Key>invoice.xml</Key><Size>42</Size></Contents></ListBucketResult>')
  assert.deepEqual(listing.ListBucketResult.Contents, { Key: 'invoice.xml', Size: 42 })
  const parser = new XMLParser({ stopNodes: ['stop'] })
  assert.deepEqual(parser.parse('<stop><raw>unparsed</raw></stop>'), { stop: '<raw>unparsed</raw>' })
})

test('GHSA-474x-hrwr-fgx4: unterminated stop-node tags fail within a bounded worker', () => {
  const worker = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
    const assert = require('node:assert/strict')
    const { XMLParser } = require(${JSON.stringify(consumerRequire.resolve('fast-xml-parser'))})
    const parser = new XMLParser({ stopNodes: ['stop'] })
    assert.throws(() => parser.parse('<stop>' + '<a '.repeat(100000)), /Unexpected end|closing tag|unclosed/i)
  `], { timeout: 3000, encoding: 'utf8' })
  assert.ifError(worker.error)
  assert.equal(worker.status, 0, worker.stderr)
})
