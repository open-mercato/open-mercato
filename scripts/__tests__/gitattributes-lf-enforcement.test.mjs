import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const COMPOSE_FILES = ['docker-compose.fullapp.dev.yml', 'docker-compose.fullapp.yml']

const REPRESENTATIVE_TEXT_FILES = [
  'docker-compose.fullapp.dev.yml',
  'docker-compose.fullapp.yml',
  'package.json',
  '.gitattributes',
]

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function resolveEol(relPath) {
  const output = git(['check-attr', 'eol', '--', relPath]).trim()
  const match = output.match(/eol:\s*(\S+)\s*$/)
  return match ? match[1] : null
}

function hasGlobalLfRule(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^\*\s+/.test(line) && /\btext=auto\b/.test(line) && /\beol=lf\b/.test(line))
}

test('root .gitattributes enforces LF globally via "* text=auto eol=lf"', () => {
  const content = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')
  assert.ok(
    hasGlobalLfRule(content),
    'Root .gitattributes must contain a global "* text=auto eol=lf" rule so Windows clones cannot inject CRLF'
  )
})

test('git resolves eol=lf for docker-compose and representative text files', () => {
  for (const file of REPRESENTATIVE_TEXT_FILES) {
    assert.equal(
      resolveEol(file),
      'lf',
      `Expected git to check out ${file} with LF endings — a CRLF here corrupts NODE_ENV and breaks Next.js`
    )
  }
})

test('docker-compose files are checked in with LF (no CR bytes)', () => {
  for (const file of COMPOSE_FILES) {
    const buffer = fs.readFileSync(path.join(ROOT, file))
    assert.ok(!buffer.includes(0x0d), `${file} contains a CR byte; it must be committed with LF endings`)
  }
})

test('text=auto leaves binary assets untouched (git detects them as -text)', () => {
  const binaries = git(['ls-files', '*.png', '*.jpg', '*.ico', '*.woff2'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  assert.ok(binaries.length > 0, 'expected at least one tracked binary asset to validate against the global LF rule')
  const sample = binaries[0]
  const output = git(['ls-files', '--eol', '--', sample]).trim()
  assert.match(
    output,
    /[iw]\/-text/,
    `Expected git to detect ${sample} as binary (-text) so the global "eol=lf" rule cannot corrupt it`
  )
})
