import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { requirePackageBuild } from './package-build-artifacts.js'
import { selectModuleFactSheets } from '../setup/tools/shared.js'

const D5_MODULES = [
  'auth',
  'catalog',
  'currencies',
  'customer_accounts',
  'customers',
  'data_sync',
  'integrations',
  'sales',
  'workflows',
]

const pkgRoot = fileURLToPath(new URL('../../', import.meta.url))
const guidesDir = join(pkgRoot, 'dist', 'agentic', 'guides')
const templateRoot = join(pkgRoot, 'template')
const LEGACY_PACKAGE_GUIDES = ['cache', 'core', 'events', 'queue', 'search', 'shared', 'ui']

requirePackageBuild(pkgRoot)

test('build emits customers facts and the framework extension catalog (T5)', () => {
  assert.ok(fs.existsSync(join(guidesDir, 'modules', 'customers', 'index.md')), 'customers index should exist')
  assert.equal(fs.existsSync(join(guidesDir, 'modules', 'customers.md')), false, 'legacy flat customers sheet must be absent')
  assert.ok(fs.existsSync(join(guidesDir, 'module-facts.json')), 'module-facts.json sidecar should exist')
  assert.ok(fs.existsSync(join(guidesDir, 'module-facts.v2.json')), 'module-facts.v2.json sidecar should exist')
  assert.ok(
    fs.existsSync(join(guidesDir, 'framework-extension-points.md')),
    'framework extension catalog should exist',
  )
  const facts = JSON.parse(fs.readFileSync(join(guidesDir, 'module-facts.json'), 'utf8'))
  const v2Facts = JSON.parse(fs.readFileSync(join(guidesDir, 'module-facts.v2.json'), 'utf8'))
  assert.ok(facts.customers, 'module-facts.json should contain the customers entry')
  assert.ok(v2Facts.customers, 'module-facts.v2.json should contain the customers entry')
  assert.equal(
    facts.customers.sourceRoot,
    'node_modules/@open-mercato/core/src/modules/customers',
  )
  assert.deepEqual(
    facts.customers.cliCommands.map((command: { command: string }) => command.command),
    facts.customers.cli,
  )
  assert.ok(facts.customers.backendPages.length > 0, 'customers facts should expose backend pages')
  assert.ok(Array.isArray(facts.customers.frontendPages), 'customers facts should expose frontend pages')
  assert.ok(facts.customers.aiTools.length > 0, 'customers facts should expose AI/MCP tools')
  assert.ok(facts.customers.aiAgents.length > 0, 'customers facts should expose AI agents')
  const sourceLinkedFacts = [
    ...facts.customers.backendPages,
    ...facts.customers.frontendPages,
    ...facts.customers.cliCommands,
    ...facts.customers.aiTools,
    ...facts.customers.aiAgents,
  ] as Array<{ sourcePath: string }>
  assert.equal(
    sourceLinkedFacts.every((fact) => fact.sourcePath.startsWith(`${facts.customers.sourceRoot}/`)),
    true,
  )

  const customersGuidesDir = join(guidesDir, 'modules', 'customers')
  const markdown = fs.readdirSync(customersGuidesDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => fs.readFileSync(join(customersGuidesDir, file), 'utf8'))
    .join('\n')
  assert.match(markdown, /## Backend pages/)
  assert.match(markdown, /## CLI commands/)
  assert.match(markdown, /## AI tools \/ MCP capabilities/)
  assert.match(markdown, /## AI agents/)
  assert.match(markdown, /\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/@open-mercato\/core\/src\/modules\/customers/)

  const frameworkMarkdown = fs.readFileSync(join(guidesDir, 'framework-extension-points.md'), 'utf8')
  assert.match(frameworkMarkdown, /^# Framework extension points/m)
  assert.match(frameworkMarkdown, /menu/i)

  const legacySecurityOverride = facts.security.extensionSurfaces.contributions.find(
    (contribution: { id: string }) => contribution.id.includes('section:auth.login.form'),
  )
  const v2SecurityOverride = v2Facts.security.extensionSurfaces.contributions.find(
    (contribution: { id: string }) => contribution.id.includes('section:auth.login.form'),
  )
  assert.equal(legacySecurityOverride.details.mode, 'replace')
  assert.equal(v2SecurityOverride.details.mode, 'wrapper')
})

test('fresh scaffolds receive the disabled local-reference projection', () => {
  const parent = fs.mkdtempSync(join(tmpdir(), 'om-reference-projection-'))
  try {
    const target = join(parent, 'reference-projection-app')
    try {
      execFileSync(
        process.execPath,
        [join(pkgRoot, 'dist', 'index.js'), target, '--preset', 'classic', '--agents', 'codex', '--no-init-git'],
        {
          cwd: pkgRoot,
          env: { ...process.env, OM_SKIP_EXTERNAL_SKILLS: '1' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (error) {
      const failed = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
      const stdout = failed.stdout?.toString().trim()
      const stderr = failed.stderr?.toString().trim()
      throw new Error([
        'create-app scaffold failed while verifying the reference projection',
        stdout ? `stdout:\n${stdout}` : null,
        stderr ? `stderr:\n${stderr}` : null,
        !stdout && !stderr ? failed.message : null,
      ].filter(Boolean).join('\n'))
    }

    for (const relativePath of [
      '.ai/guides/module-facts.json',
      '.ai/guides/module-facts.v2.json',
      '.ai/guides/reference-module-facts.json',
      '.ai/guides/reference-modules/example/index.md',
      '.ai/guides/reference-modules/example/entities.md',
    ]) {
      assert.equal(fs.existsSync(join(target, relativePath)), true, `${relativePath} must reach a fresh scaffold`)
    }
    const manifest = JSON.parse(
      fs.readFileSync(join(target, '.ai', 'harness', 'manifest.json'), 'utf8'),
    ) as { files: Array<{ path: string }> }
    const ownedPaths = new Set(manifest.files.map((entry) => entry.path))
    assert.equal(ownedPaths.has('.ai/guides/module-facts.json'), true)
    assert.equal(ownedPaths.has('.ai/guides/module-facts.v2.json'), true)
    assert.equal(ownedPaths.has('.ai/guides/reference-module-facts.json'), true)
    assert.equal(ownedPaths.has('.ai/guides/reference-modules/example/index.md'), true)
    assert.equal(ownedPaths.has('.ai/guides/reference-modules/example/entities.md'), true)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('build emits a fact-sheet for every allowlisted D5 module (T5)', () => {
  for (const moduleId of D5_MODULES) {
    assert.ok(
      fs.existsSync(join(guidesDir, 'modules', moduleId, 'index.md')),
      `${moduleId}/index.md fact-sheet should exist`,
    )
  }
})

test('every default-controller module fact is exercised by the evaluation catalog', () => {
  const moduleGuidesDir = join(guidesDir, 'modules')
  const selectedModuleIds = selectModuleFactSheets(templateRoot, moduleGuidesDir)
  const cases = JSON.parse(fs.readFileSync(
    join(pkgRoot, 'dist', 'agentic', 'shared', 'ai', 'harness', 'cases.json'),
    'utf8',
  )) as Array<{
    owner: { path: string }
    context: { required: string[]; allowedExtra?: string[] }
  }>
  const catalogReferences = new Set(cases.flatMap((caseRecord) => [
    caseRecord.owner.path,
    ...caseRecord.context.required,
    ...(caseRecord.context.allowedExtra ?? []),
  ]))
  const uncovered = selectedModuleIds
    .map((moduleId) => `.ai/guides/modules/${moduleId}/index.md`)
    .filter((guide) => !catalogReferences.has(guide))
    .sort()

  assert.deepEqual(uncovered, [], `module facts without an evaluation case:\n${uncovered.join('\n')}`)
})

test('build no longer emits legacy core.<module>.md redirect stubs (#3754)', () => {
  for (const moduleId of D5_MODULES) {
    assert.ok(
      !fs.existsSync(join(guidesDir, `core.${moduleId}.md`)),
      `core.${moduleId}.md redirect stub should not be emitted`,
    )
  }
})

// dist/ is published (package.json `files`), so a staging tree the build forgot to swap in or clean
// up would ship with the package — and a surviving `agentic.previous` would mean the swap never
// completed (#5059).
test('build leaves no staging artifacts behind in dist', () => {
  for (const leftover of ['agentic.staging', 'agentic.previous']) {
    assert.ok(
      !fs.existsSync(join(pkgRoot, 'dist', leftover)),
      `dist/${leftover} must not survive the build`,
    )
  }
})

test('build does not emit unreachable package-level standalone guides', () => {
  for (const guide of LEGACY_PACKAGE_GUIDES) {
    assert.ok(
      !fs.existsSync(join(guidesDir, `${guide}.md`)),
      `${guide}.md should not compete with routed conceptual guides`,
    )
  }
})

// An `allowedExtra` reference offers a fact-sheet to an agent but never asserts it: the reference
// permits the read and never fails a run that skips it, so an agent that rebuilds the capability
// still passes. This guard therefore demands `context.required`, the reference that actually fails
// a run (#4603, tightened from the weaker "routed by some case" predicate #4565 shipped).
//
// The exemption owns no duplicable surface: `api_docs` ships no entity, no migration, and an empty
// `features` array, so it has no schema an agent could re-create and no access-control posture it
// could get wrong — requiring the read would assert nothing. It stays reachable through
// `allowedExtra` without being asserted.
//
// `design_system` was exempt for the same reason until fresh standalone registries stopped enabling
// it; the scaffold no longer ships its fact-sheet at all, so the exemption has nothing left to
// excuse and the stale-exemption guard below rejects it.
const FACT_SHEETS_EXEMPT_FROM_REQUIRED_CASE = ['api_docs']

test('every module fact-sheet a scaffold ships is required by at least one catalog case', () => {
  const shipped = selectModuleFactSheets(join(pkgRoot, 'template'), join(guidesDir, 'modules'))
  assert.ok(shipped.length > 0, 'the scaffold must ship at least one module fact-sheet')

  const cases = JSON.parse(
    fs.readFileSync(join(pkgRoot, 'agentic', 'shared', 'ai', 'harness', 'cases.json'), 'utf8'),
  ) as Array<{ context: { required: string[]; allowedExtra?: string[] } }>
  const required = new Set(cases.flatMap((entry) => entry.context.required))
  const routed = new Set(cases.flatMap((entry) => [...entry.context.required, ...(entry.context.allowedExtra ?? [])]))
  const guide = (moduleId: string) => `.ai/guides/modules/${moduleId}/index.md`

  const unasserted = shipped
    .filter((moduleId) => !FACT_SHEETS_EXEMPT_FROM_REQUIRED_CASE.includes(moduleId))
    .filter((moduleId) => !required.has(guide(moduleId)))
  assert.deepEqual(
    unasserted,
    [],
    `these shipped module fact-sheets are in no case's context.required: ${unasserted.join(', ')}. `
    + 'Add a case whose prompt forces the read and lists .ai/guides/modules/<id>/index.md in context.required '
    + '(widening another case\'s allowedExtra does not assert it), or stop enabling the module in the template.',
  )

  // An exemption that stops being true is a coverage hole hiding behind a stale list, so the list
  // is held to the same standard as the modules it excuses.
  const staleExemptions = FACT_SHEETS_EXEMPT_FROM_REQUIRED_CASE
    .filter((moduleId) => !shipped.includes(moduleId) || required.has(guide(moduleId)))
  assert.deepEqual(
    staleExemptions,
    [],
    `these exemptions are obsolete: ${staleExemptions.join(', ')}. `
    + 'The module is either no longer shipped or now required by a case — drop it from '
    + 'FACT_SHEETS_EXEMPT_FROM_REQUIRED_CASE.',
  )

  const unroutedExemptions = FACT_SHEETS_EXEMPT_FROM_REQUIRED_CASE.filter((moduleId) => !routed.has(guide(moduleId)))
  assert.deepEqual(
    unroutedExemptions,
    [],
    `these exempt fact-sheets are absent from every case context: ${unroutedExemptions.join(', ')}. `
    + 'An exempt sheet must still be offerable through some case\'s allowedExtra.',
  )
})
