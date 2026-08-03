import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CROSS_PACKAGE_EXCEPTIONS,
  REPO_WIDE_GUARDS,
  buildJestArgs,
  escapesPackageRoot,
  findCrossPackageTestCandidates,
  listGuardPaths,
} from '../repo-wide-guards.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml')
const STEP_NAME = 'Run repo-wide audit guards (always, unfiltered)'
const LUCIDE_STEP_NAME = 'Check Lucide registry parity'

function readWorkflowStep(name) {
  const lines = fs.readFileSync(workflowPath, 'utf8').split('\n')
  const startIndex = lines.findIndex((line) => line.trim() === `- name: ${name}`)
  if (startIndex === -1) return null

  const indent = lines[startIndex].indexOf('-')
  const step = [lines[startIndex]]
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim().startsWith('- ') && line.indexOf('-') === indent) break
    if (line.trim() !== '' && line.search(/\S/) <= indent) break
    step.push(line)
  }

  return step
}

test('every enumerated repo-wide guard file exists', () => {
  for (const guardPath of listGuardPaths()) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, guardPath)),
      `${guardPath} is listed in scripts/repo-wide-guards.mjs but does not exist — a renamed guard would silently match zero tests, which is exactly the failure this runner exists to prevent (#4472).`,
    )
  }
})

test('every guard workspace has the jest config the runner invokes', () => {
  for (const group of REPO_WIDE_GUARDS) {
    const configPath = path.join(repoRoot, group.workspaceDir, group.jestConfig)
    assert.ok(fs.existsSync(configPath), `${group.workspace}: ${group.workspaceDir}/${group.jestConfig} does not exist.`)
  }
})

test('the runner refuses to pass when a guard matches no test', () => {
  for (const group of REPO_WIDE_GUARDS) {
    const args = buildJestArgs(group)
    assert.ok(
      args.includes('--passWithNoTests=false'),
      `${group.workspace}: the jest invocation must override the workspace config's passWithNoTests, or a guard that stops matching testMatch would exit 0 having run nothing.`,
    )
    assert.ok(args.includes('--runTestsByPath'), `${group.workspace}: guard paths must be passed as exact paths, not regexes.`)
    for (const guard of group.tests) {
      assert.ok(args.includes(guard.path), `${group.workspace}: ${guard.path} is missing from the jest invocation.`)
    }
  }
})

test('every documented exception still exists', () => {
  for (const exception of CROSS_PACKAGE_EXCEPTIONS) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, exception.path)),
      `${exception.path} is listed as a repo-wide-guard exception but does not exist — drop the stale entry.`,
    )
    assert.ok(exception.reason.length > 0, `${exception.path} needs a reason for being excluded.`)
  }
})

test('no test that audits other packages is left unclassified', () => {
  const classified = new Set([...listGuardPaths(), ...CROSS_PACKAGE_EXCEPTIONS.map((entry) => entry.path)])
  const unclassified = findCrossPackageTestCandidates(repoRoot).filter((candidate) => !classified.has(candidate))

  assert.deepEqual(
    unclassified,
    [],
    `These tests read files outside their own package, so CI's turbo filter can skip them on a PR that changes those files. Add each to REPO_WIDE_GUARDS in scripts/repo-wide-guards.mjs so it runs unfiltered, or to CROSS_PACKAGE_EXCEPTIONS with a reason:\n${unclassified.join('\n')}`,
  )
})

test('no exception is stale — every excluded test still reaches outside its package', () => {
  const candidates = new Set(findCrossPackageTestCandidates(repoRoot))
  const stale = CROSS_PACKAGE_EXCEPTIONS.map((entry) => entry.path).filter((entry) => !candidates.has(entry))

  assert.deepEqual(stale, [], `These exceptions no longer audit other packages — drop them from CROSS_PACKAGE_EXCEPTIONS:\n${stale.join('\n')}`)
})

test('ci.yml runs the repo-wide guards unconditionally', () => {
  const step = readWorkflowStep(STEP_NAME)
  assert.ok(step, `ci.yml has no "${STEP_NAME}" step — the repo-wide guards would only run after merge.`)

  const body = step.join('\n')
  assert.match(body, /run: yarn test:repo-wide-guards/, 'The step must run `yarn test:repo-wide-guards`.')
  assert.ok(
    !step.some((line) => /^\s+if:/.test(line)),
    'The step must stay unconditional — a conditional step reintroduces the silent skip it exists to prevent.',
  )
})

test('the yarn shortcut used by ci.yml exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts['test:repo-wide-guards'], 'node scripts/repo-wide-guards.mjs')
})

test('ci.yml checks committed Lucide registry parity before a build can repair drift', () => {
  const step = readWorkflowStep(LUCIDE_STEP_NAME)
  assert.ok(step, `ci.yml has no "${LUCIDE_STEP_NAME}" step — stale generated output could merge.`)
  assert.match(step.join('\n'), /run: yarn lucide:check/, 'The parity step must run `yarn lucide:check`.')
  assert.ok(!step.some((line) => /^\s+if:/.test(line)), 'The parity check must stay unconditional.')

  const workflow = fs.readFileSync(workflowPath, 'utf8')
  assert.ok(
    workflow.indexOf(`- name: ${LUCIDE_STEP_NAME}`) < workflow.indexOf('- name: Build packages'),
    'The parity check must run before build:packages regenerates the registry.',
  )
})

test('the Lucide sync and check shortcuts use the same generator entrypoint', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts['lucide:sync'], 'node packages/ui/scripts/lucideRegistry.mjs sync')
  assert.equal(manifest.scripts['lucide:check'], 'node packages/ui/scripts/lucideRegistry.mjs check')
})

test('the detector recognizes a cross-package audit and ignores a package-local test', () => {
  const candidates = findCrossPackageTestCandidates(repoRoot)
  assert.ok(
    candidates.includes('packages/core/src/__tests__/explicit-sort-comparators.test.ts'),
    'The explicit-sort-comparator guard scans every package plus scripts/ and must be detected as cross-package.',
  )
  assert.ok(
    !candidates.includes('packages/core/src/__tests__/module-decoupling.test.ts'),
    'module-decoupling builds an in-memory registry and reads no other package — it must not be flagged.',
  )
})

const INDIRECT_UPWARD_WALK_GUARDS = [
  'packages/cli/src/lib/generators/__tests__/module-facts.customers.fixture.test.ts',
  'packages/cli/src/lib/generators/__tests__/module-facts.auth-source.test.ts',
  'packages/cli/src/lib/generators/__tests__/module-facts.extension-hosts.test.ts',
]

test('the detector catches the indirect upward-walk locator, not just the direct one', () => {
  const candidates = findCrossPackageTestCandidates(repoRoot)
  const missed = INDIRECT_UPWARD_WALK_GUARDS.filter((guardPath) => !candidates.includes(guardPath))

  assert.deepEqual(
    missed,
    [],
    `These tests assign __dirname to a variable and walk upward with path.dirname() until packages/core/src/modules exists, then read live module sources. A detector that only understands direct resolve(__dirname, '..') anchors reports "everything classified" while these audits stay unclassified, which makes this runner's primary acceptance criterion vacuous (#4534):\n${missed.join('\n')}`,
  )
})

test('the indirect upward-walk guards are enumerated, so they actually run unfiltered', () => {
  const guardPaths = new Set(listGuardPaths())
  const unlisted = INDIRECT_UPWARD_WALK_GUARDS.filter((guardPath) => !guardPaths.has(guardPath))

  assert.deepEqual(
    unlisted,
    [],
    `Detecting these audits is only half the fix — they read packages/core sources from packages/cli, so a core-only PR must run them:\n${unlisted.join('\n')}`,
  )
})

test('escapesPackageRoot classifies each locator shape the repository actually uses', () => {
  const testPath = 'packages/cli/src/lib/generators/__tests__/module-facts.customers.fixture.test.ts'

  assert.equal(
    escapesPackageRoot(
      "let dir = __dirname\nfor (let depth = 0; depth < 10; depth += 1) {\n  const candidate = path.join(dir, 'packages', 'core', 'src', 'modules')\n  if (fs.existsSync(candidate)) return candidate\n  dir = path.dirname(dir)\n}",
      testPath,
    ),
    true,
    'A bounded upward walk stops wherever the probed path exists, so its depth is a runtime decision and must be assumed to leave the workspace.',
  )

  assert.equal(
    escapesPackageRoot("const root = path.resolve(__dirname, '../../../../..')\nfs.readFileSync(path.join(root, 'packages'))", testPath),
    true,
    'A single resolve() with the ascent written as one joined literal must count every segment, not one.',
  )

  assert.equal(
    escapesPackageRoot("const fixtures = path.join(__dirname, '..', 'fixtures')", testPath),
    false,
    'An ascent that stays inside the workspace is package-local and must not be flagged.',
  )

  assert.equal(
    escapesPackageRoot(
      "const here = path.dirname(fileURLToPath(import.meta.url))\nconst sibling = path.join(here, 'fixture.json')",
      'packages/create-app/src/lib/example.test.ts',
    ),
    false,
    'dirname(fileURLToPath(import.meta.url)) is the ESM spelling of __dirname — the file\'s own directory, not one level above it.',
  )
})

test('a fixture repository proves the indirect locator shape cannot slip through the detector', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-wide-guards-'))
  const walkerDir = path.join(fixtureRoot, 'packages', 'walker', 'src', '__tests__')
  const localDir = path.join(fixtureRoot, 'packages', 'local', 'src', '__tests__')

  try {
    fs.mkdirSync(walkerDir, { recursive: true })
    fs.mkdirSync(localDir, { recursive: true })
    fs.writeFileSync(
      path.join(walkerDir, 'indirect-walk.test.ts'),
      "let dir = __dirname\nwhile (!fs.existsSync(path.join(dir, 'packages'))) dir = path.dirname(dir)\nfs.readFileSync(path.join(dir, 'packages', 'other', 'src', 'index.ts'))\n",
    )
    fs.writeFileSync(
      path.join(localDir, 'package-local.test.ts'),
      "const fixtures = path.join(__dirname, '..', 'fixtures')\nfs.readFileSync(path.join(fixtures, 'packages.json'))\n",
    )

    assert.deepEqual(
      findCrossPackageTestCandidates(fixtureRoot),
      ['packages/walker/src/__tests__/indirect-walk.test.ts'],
      'The fixture walker must be detected and the package-local sibling must not — this is the regression that made the manifest look complete while three real audits were missing (#4534).',
    )
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('the runner launches jest through cross-spawn so Windows command shims work', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'repo-wide-guards.mjs'), 'utf8')

  assert.match(
    source,
    /import spawn from 'cross-spawn'/,
    'resolveSpawnCommand() returns .cmd/.bat shims unchanged because it assumes a cross-spawn caller; Node\'s native spawnSync cannot execute those shims, so the runner would fail on Windows.',
  )
  assert.doesNotMatch(
    source,
    /from 'node:child_process'/,
    'Importing from node:child_process reintroduces the Windows shim failure this runner was fixed for.',
  )
})
