import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The suite's runtime policy is part of its correctness, not a preference: a test file that spawns
// the package build deletes dist/agentic while sibling files read it (#5059), and a run that is cut
// short from outside has to say so instead of listing 26 "failing" files with `fail 0` (#5052).
// Both regressions are invisible when the suite is green locally, so they are pinned here.
const pkgRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageJson = JSON.parse(fs.readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const testScript = packageJson.scripts.test
const selfPath = fileURLToPath(import.meta.url)

function collectTestFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) return collectTestFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [entryPath] : []
  })
}

test('the test script builds and prepares Git history before the runner starts', () => {
  assert.match(
    testScript,
    /^node build\.mjs && node scripts\/prepare-test-git-history\.mjs && node /,
    'the package build and shallow-history fetch must finish before parallel tests start (#5059, #5236)',
  )
  assert.equal(fs.existsSync(join(pkgRoot, 'scripts', 'prepare-test-git-history.mjs')), true)
})

test('turbo knows the test task now needs the sibling builds', () => {
  const turbo = JSON.parse(fs.readFileSync(join(pkgRoot, '..', '..', 'turbo.json'), 'utf8')) as {
    tasks: Record<string, { dependsOn?: string[] }>
  }

  assert.deepEqual(
    turbo.tasks['create-mercato-app#test']?.dependsOn,
    ['^build'],
    'building before the runner means the suite cannot start on a tree where the packages this '
    + 'build imports are not compiled yet; the generic `test` task declares no dependencies',
  )
})

test('the test script keeps the per-test timeout pinned', () => {
  assert.match(testScript, /--test-timeout=120000/)
})

test('the test script installs the truncation reporter alongside the default one', () => {
  assert.match(
    testScript,
    /--test-reporter=spec --test-reporter-destination=stdout/,
    'the spec reporter must stay explicit once a second reporter is registered',
  )
  assert.match(
    testScript,
    /--test-reporter=\.\/scripts\/report-truncation\.mjs --test-reporter-destination=stdout/,
    'a run cut short from outside must explain itself instead of reading as 26 failing tests (#5052)',
  )
  assert.ok(
    fs.existsSync(join(pkgRoot, 'scripts', 'report-truncation.mjs')),
    'the reporter the test script registers must exist',
  )
})

test('no test file spawns the package build', () => {
  const offenders = collectTestFiles(join(pkgRoot, 'src'))
    .filter((file) => file !== selfPath)
    .filter((file) => /['"`]build\.mjs['"`]/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => relative(pkgRoot, file))
    .sort()

  assert.deepEqual(
    offenders,
    [],
    `these test files reference the package build as a command: ${offenders.join(', ')}. `
    + 'Import requirePackageBuild from src/lib/package-build-artifacts.ts instead — a build started '
    + 'from a test file wipes dist/agentic while parallel files read it (#5059).',
  )
})
