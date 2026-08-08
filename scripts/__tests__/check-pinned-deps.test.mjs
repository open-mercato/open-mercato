import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const WORKSPACE_PATTERNS_GLOBS = ['package.json', 'packages/*/package.json', 'apps/*/package.json']

// peerDependencies are excluded — they express compatibility ranges for consumers
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies']

// ── Live repo assertions ────────────────────────────────────────────────────

describe('check-pinned-deps — live repo', () => {
  test('no workspace package.json contains ^ or ~ version prefixes', () => {
    const violations = []

    for (const pattern of WORKSPACE_PATTERNS_GLOBS) {
      // Use a simple manual glob via fs since we want zero extra deps
      const files = resolveGlob(pattern)
      for (const file of files) {
        const raw = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
        for (const section of DEP_SECTIONS) {
          const deps = raw[section]
          if (!deps) continue
          for (const [pkg, version] of Object.entries(deps)) {
            if (typeof version === 'string' && /^[\^~]/.test(version)) {
              violations.push(`${file} → ${section}.${pkg}: "${version}"`)
            }
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found ${violations.length} dependency version(s) with range prefixes (^ or ~):\n  ${violations.join('\n  ')}`
    )
  })

  test('yarn check:pinned-deps script exits successfully', () => {
    const result = execFileSync('yarn', ['check:pinned-deps'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.match(result, /All dependency versions are pinned/)
  })

  test('.yarnrc.yml sets defaultSemverRangePrefix to empty string', () => {
    const yarnrc = fs.readFileSync(path.join(ROOT, '.yarnrc.yml'), 'utf8')
    assert.match(
      yarnrc,
      /defaultSemverRangePrefix:\s*""/,
      '.yarnrc.yml must set defaultSemverRangePrefix: "" to prevent yarn add from inserting ^ or ~'
    )
  })

  test('check:pinned-deps script is registered in root package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.ok(
      pkg.scripts?.['check:pinned-deps'],
      'Root package.json must have a "check:pinned-deps" script entry'
    )
    assert.match(pkg.scripts['check:pinned-deps'], /check-pinned-deps/)
  })
})

// ── Detection assertions (fixture-based) ────────────────────────────────────

describe('check-pinned-deps — detection', () => {
  const fixtureDir = path.join(ROOT, 'scripts/__tests__/__fixtures__/pinned-deps')

  function writeFixture(name, content) {
    fs.mkdirSync(fixtureDir, { recursive: true })
    const filePath = path.join(fixtureDir, name)
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2))
    return filePath
  }

  function cleanFixtures() {
    if (fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true })
    }
  }

  test('detects caret prefix in dependencies', () => {
    try {
      writeFixture('package.json', {
        name: 'test-caret',
        dependencies: { chalk: '^5.4.1' },
      })

      const result = execFileSync(
        'node',
        [
          '-e',
          `
          const fs = require('fs');
          const pkg = JSON.parse(fs.readFileSync('${path.join(fixtureDir, 'package.json')}', 'utf8'));
          const violations = [];
          for (const [k, v] of Object.entries(pkg.dependencies || {})) {
            if (/^[\\^~]/.test(v)) violations.push(k + ': ' + v);
          }
          if (violations.length) { console.error(violations.join('\\n')); process.exit(1); }
          `,
        ],
        { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }
      )
      assert.fail('Expected script to exit with code 1 for caret dependency')
    } catch (err) {
      assert.equal(err.status, 1, 'Script should exit 1 when caret prefix is found')
      assert.match(err.stderr, /chalk/)
    } finally {
      cleanFixtures()
    }
  })

  test('detects tilde prefix in devDependencies', () => {
    try {
      writeFixture('package.json', {
        name: 'test-tilde',
        devDependencies: { prettier: '~3.5.0' },
      })

      const result = execFileSync(
        'node',
        [
          '-e',
          `
          const fs = require('fs');
          const pkg = JSON.parse(fs.readFileSync('${path.join(fixtureDir, 'package.json')}', 'utf8'));
          const violations = [];
          for (const [k, v] of Object.entries(pkg.devDependencies || {})) {
            if (/^[\\^~]/.test(v)) violations.push(k + ': ' + v);
          }
          if (violations.length) { console.error(violations.join('\\n')); process.exit(1); }
          `,
        ],
        { cwd: ROOT, encoding: 'utf8', timeout: 10_000 }
      )
      assert.fail('Expected script to exit with code 1 for tilde dependency')
    } catch (err) {
      assert.equal(err.status, 1, 'Script should exit 1 when tilde prefix is found')
      assert.match(err.stderr, /prettier/)
    } finally {
      cleanFixtures()
    }
  })

  test('allows exact versions and workspace: protocol', () => {
    try {
      writeFixture('package.json', {
        name: 'test-exact',
        dependencies: {
          chalk: '5.4.1',
          '@open-mercato/shared': 'workspace:*',
        },
        devDependencies: { typescript: '7.0.2' },
      })

      const pkg = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8'))
      const violations = []
      for (const section of DEP_SECTIONS) {
        for (const [k, v] of Object.entries(pkg[section] || {})) {
          if (typeof v === 'string' && !v.startsWith('workspace:') && /^[\^~]/.test(v)) {
            violations.push(`${k}: ${v}`)
          }
        }
      }
      assert.deepEqual(violations, [], 'Exact versions and workspace: should not be flagged')
    } finally {
      cleanFixtures()
    }
  })
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal glob resolver for patterns like "packages/* /package.json" — avoids
 * importing the glob package at test-module scope (top-level await limitation).
 */
function resolveGlob(pattern) {
  const parts = pattern.split('/')
  const starIndex = parts.indexOf('*')

  if (starIndex === -1) {
    // No wildcard — just check if the file exists
    const fullPath = path.join(ROOT, pattern)
    return fs.existsSync(fullPath) ? [pattern] : []
  }

  // Expand the single wildcard segment
  const prefix = parts.slice(0, starIndex).join('/')
  const suffix = parts.slice(starIndex + 1).join('/')
  const dir = path.join(ROOT, prefix)

  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((entry) => {
      const full = path.join(dir, entry, suffix)
      return fs.existsSync(full) && fs.statSync(full).isFile()
    })
    .map((entry) => [prefix, entry, suffix].filter(Boolean).join('/'))
}
