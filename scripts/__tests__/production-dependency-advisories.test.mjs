import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { parse } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

const vulnerableRanges = {
  '@opentelemetry/core': ['<2.8.0'],
  'brace-expansion': ['>=5.0.0 <5.0.6'],
  dompurify: ['<=3.4.10'],
  'ip-address': ['<=10.1.0'],
  'js-yaml': ['<3.15.0', '>=4.0.0 <=4.1.1'],
  mermaid: ['>=11.0.0-alpha.1 <=11.14.0'],
  postcss: ['<8.5.10'],
  qs: ['>=6.11.1 <=6.15.1'],
  uuid: ['<11.1.1'],
}

test('production dependency lockfile excludes versions covered by issue #4046 advisories', async () => {
  const lockfile = parse(await readFile(path.join(rootDir, 'yarn.lock'), 'utf8'))
  const failures = []

  for (const [packageName, ranges] of Object.entries(vulnerableRanges)) {
    const versions = Object.entries(lockfile)
      .filter(([descriptor]) => descriptor.startsWith(`${packageName}@`))
      .map(([, resolution]) => resolution.version)

    for (const version of new Set(versions)) {
      const vulnerableRange = ranges.find((range) => semver.satisfies(version, range, { includePrerelease: true }))
      if (vulnerableRange) failures.push(`${packageName}@${version} matches ${vulnerableRange}`)
    }
  }

  assert.deepEqual(failures, [])
})
