import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('Dependabot 220: protobufjs resolutions exclude GHSA-j3f2-48v5-ccww', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const lockfile = await readFile(new URL('../../yarn.lock', import.meta.url), 'utf8')
  const versions = [...lockfile.matchAll(/^  resolution: "protobufjs@npm:([^"\n]+)"$/gm)].map((match) => match[1])

  assert.equal(manifest.resolutions.protobufjs, '7.6.5')
  assert.ok(versions.length > 0, 'protobufjs must remain covered by the lockfile assertion')
  assert.deepEqual([...new Set(versions)], ['7.6.5'])
})
