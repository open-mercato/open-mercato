import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Checked migration disposition for the example read policy's Phase 1 step 2.
 *
 * Every shipped case used to carry `context.warn: ["node_modules/@open-mercato/*<glob>"]`
 * as boilerplate. `context.warn` is folded into the read allowlist by both
 * `caseReadAllowlist` and `permittedContextPath`, so that boilerplate was an
 * accidental universal read permission over every installed package's sources.
 *
 * The migration removed it from every case. Installed sources are now reachable only
 * through one of three declared, bounded channels, and this file is the gate that keeps
 * it that way — a case template or a copy-paste that reintroduces the glob fails here.
 */

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const casesPath = path.join(sharedRoot, 'ai', 'harness', 'cases.json')
const caseTemplatePath = path.join(
  sharedRoot,
  'ai',
  'skills',
  'om-evolve-harness',
  'references',
  'case-template.md',
)

type HarnessCase = {
  id: string
  context: {
    required?: string[]
    allowedExtra?: string[]
    warn?: string[]
    forbidden?: string[]
    exampleRoots?: unknown[]
    installedVersionFallback?: unknown
  }
  frameworkContext?: unknown[]
}

function loadCases(): HarnessCase[] {
  return JSON.parse(fs.readFileSync(casesPath, 'utf8')) as HarnessCase[]
}

const INSTALLED_PREFIX = 'node_modules/'

function contextPatterns(entry: HarnessCase): string[] {
  return [
    ...(entry.context.required ?? []),
    ...(entry.context.allowedExtra ?? []),
    ...(entry.context.warn ?? []),
  ]
}

test('no shipped case grants a glob-shaped installed-source read', () => {
  const offenders = loadCases().flatMap((entry) => {
    const bad = contextPatterns(entry)
      .filter((pattern) => pattern.startsWith(INSTALLED_PREFIX))
      .filter((pattern) => pattern.includes('*') || pattern.includes('?'))
    return bad.length ? [`${entry.id}: ${bad.join(', ')}`] : []
  })

  assert.deepEqual(
    offenders,
    [],
    'installed sources must be reached through exampleRoots, installedVersionFallback, or a bounded frameworkContext query — never a context glob',
  )
})

test('any remaining installed-source context entry is an exact package source file', () => {
  const offenders = loadCases().flatMap((entry) => {
    const bad = contextPatterns(entry)
      .filter((pattern) => pattern.startsWith(INSTALLED_PREFIX))
      .filter((pattern) => !/^node_modules\/@open-mercato\/[^/*?]+\/src\/[^*?]+\.[a-z]+$/.test(pattern))
    return bad.length ? [`${entry.id}: ${bad.join(', ')}`] : []
  })

  assert.deepEqual(offenders, [], 'declared installed reads must name an exact @open-mercato/<pkg>/src file')
})

test('every case still declares a forbidden context contract', () => {
  const offenders = loadCases()
    .filter((entry) => !Array.isArray(entry.context.forbidden) || entry.context.forbidden.length === 0)
    .map((entry) => entry.id)

  assert.deepEqual(offenders, [], 'removing the warn entry must not have emptied the context contract')
})

test('the case template does not reintroduce the glob for newly authored cases', () => {
  const template = fs.readFileSync(caseTemplatePath, 'utf8')

  assert.equal(
    /"warn"\s*:\s*\[\s*"node_modules\//.test(template),
    false,
    'the emitted case template must not seed a new case with an installed-source warn glob',
  )
})
