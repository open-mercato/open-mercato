#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SPEC_PATH = '.ai/specs/2026-08-02-inventory-reservations.md'
const CASES = new Set(['OMH-209', 'OMH-210'])

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') continue
    if (!['--root', '--case', '--phase'].includes(value) || !argv[index + 1]) throw new Error(`invalid argument ${value}`)
    result[value.slice(2)] = argv[index + 1]
    index += 1
  }
  if (!path.isAbsolute(result.root ?? '')) throw new Error('root must be absolute')
  if (!CASES.has(result.case)) throw new Error(`unsupported writable case: ${String(result.case)}`)
  if (!['before', 'after'].includes(result.phase)) throw new Error('phase must be before or after')
  return result
}

function check(id, passed, requirement) {
  return { id, passed, requirement }
}

function evaluate({ root, case: caseId }) {
  const realRoot = fs.realpathSync(root)
  const absolute = path.resolve(realRoot, SPEC_PATH)
  const relative = path.relative(realRoot, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('spec path escapes target root')
  if (!fs.existsSync(absolute)) return { passed: false, failures: [`spec.exists: ${SPEC_PATH} exists`], checks: [] }
  const entry = fs.lstatSync(absolute)
  if (!entry.isFile() || entry.isSymbolicLink() || !fs.realpathSync(absolute).startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('spec must be a contained regular file')
  }
  const source = fs.readFileSync(absolute, 'utf8')
  const checks = [
    check('spec.name', /^\.ai\/specs\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(SPEC_PATH), 'a correctly named specification'),
    check('spec.substantive', Buffer.byteLength(source) >= 600 && !/(?:\{[^}\n]+\}|\bTODO\b|placeholder-only)/i.test(source), 'a substantive specification without template placeholders'),
    check('spec.problem', /^## Problem Statement\s*$/im.test(source), 'a Problem Statement section'),
    check('spec.contracts', /^## (?:Data|Domain) Contract\s*$/im.test(source) && /^## API Contract\s*$/im.test(source), 'data/domain and API contract sections'),
    check('spec.tests', /^## (?:Integration Coverage|Testing and Validation)\s*$/im.test(source), 'self-contained integration coverage'),
    check('spec.phases', /^## Implementation Plan\s*$/im.test(source) && /^### Phase 1\b/im.test(source), 'a dependency-ordered phased implementation plan'),
    check('spec.ordering', /spec(?:ification)?(?:\s+write|\s+approval|\s+completion)?.{0,80}before.{0,40}(?:code|implementation)/is.test(source), 'an explicit spec-before-code ordering statement'),
  ]
  if (caseId === 'OMH-210') {
    checks.push(
      check('spec.bulk-release-contract', /bulk[- ]release/i.test(source) && /(?:POST|DELETE|PATCH)\s+\/api\//i.test(source), 'the requested bulk-release API contract'),
      check('spec.bulk-release-test', /bulk[- ]release.{0,160}(?:integration|test|coverage)/is.test(source), 'bulk-release integration coverage'),
      check('spec.bulk-release-phase', /^### Phase [2-9]\b[^\n]*bulk[- ]release/im.test(source), 'a dependency-ordered bulk-release implementation phase'),
    )
  }
  const failures = checks.filter((entry) => !entry.passed).map((entry) => `${entry.id}: ${entry.requirement}`)
  return { passed: failures.length === 0, failures, checks }
}

function main() {
  try {
    const result = evaluate(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result.passed ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ passed: false, failures: [message], checks: [] })}\n`)
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
