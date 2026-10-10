import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main, resolveCiProvider } from '../index.ts'

const BASE_ARGS = ['app', '--preset', 'classic', '--agents', 'none', '--no-init-git']
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

type ScaffoldRun = { workDir: string; appDir: string; output: string[] }

async function scaffoldInTempDir(argv: string[]): Promise<ScaffoldRun> {
  const workDir = mkdtempSync(join(tmpdir(), 'create-app-ci-flag-'))
  const output: string[] = []
  const originalLog = console.log
  const originalCwd = process.cwd()

  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(' ').replace(ANSI_PATTERN, ''))
  }

  try {
    process.chdir(workDir)
    await main(argv)
    return { workDir, appDir: join(workDir, 'app'), output }
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true })
    throw error
  } finally {
    process.chdir(originalCwd)
    console.log = originalLog
  }
}

function publishBlock(output: string[]): string[] {
  const start = output.findIndex((line) => line.includes('Optional GitHub publish:'))
  assert.ok(start >= 0, 'publish block is printed')
  return output.slice(start)
}

function lineIndex(lines: string[], text: string): number {
  return lines.findIndex((line) => line.trim().endsWith(text))
}

test('resolveCiProvider defaults template apps to github', () => {
  assert.equal(resolveCiProvider(undefined, false), 'github')
})

test('resolveCiProvider accepts explicit github and none', () => {
  assert.equal(resolveCiProvider('github', false), 'github')
  assert.equal(resolveCiProvider('none', false), 'none')
})

test('template keeps workflows outside .github because yarn pack drops that directory', () => {
  const templateDir = new URL('../../template/', import.meta.url)
  assert.ok(!existsSync(new URL('.github', templateDir)), 'template/.github would be missing from the published package')
  assert.ok(existsSync(new URL('github/workflows/ci.yml.template', templateDir)))
  assert.ok(existsSync(new URL('github/workflows/integration.yml.template', templateDir)))
})

test('resolveCiProvider rejects unknown values with the valid list', () => {
  assert.throws(
    () => resolveCiProvider('gitlab', false),
    { message: 'Unknown --ci value "gitlab". Valid values: github, none.' },
  )
})

test('resolveCiProvider rejects any explicit --ci for imported ready apps', () => {
  for (const value of ['github', 'none', 'bogus']) {
    assert.throws(() => resolveCiProvider(value, true), /--ci is not supported with --app\/--app-url/)
  }
  assert.equal(resolveCiProvider(undefined, true), 'none')
})

test('default scaffold ships the rendered ci workflow and prints lockfile-first publish steps', async () => {
  const { workDir, appDir, output } = await scaffoldInTempDir(BASE_ARGS)

  try {
    const workflowPath = join(appDir, '.github', 'workflows', 'ci.yml')
    assert.ok(existsSync(workflowPath))
    assert.ok(!readFileSync(workflowPath, 'utf-8').includes('{{PACKAGE_VERSION}}'))
    assert.ok(existsSync(join(appDir, '.github', 'workflows', 'integration.yml')))
    assert.ok(!existsSync(join(appDir, 'github')), 'the template github/ directory is restored as .github/')
    assert.ok(existsSync(join(appDir, 'scripts', 'ci.mjs')))

    const joined = output.join('\n')
    assert.ok(joined.includes('.github/workflows/ci.yml'))
    assert.ok(joined.includes('OM_CI_RUNS_ON'))

    const publish = publishBlock(output)
    const installIndex = lineIndex(publish, 'yarn install')
    const addIndex = lineIndex(publish, 'git add -A')
    assert.ok(installIndex >= 0, 'publish block lists yarn install')
    assert.ok(addIndex > installIndex, 'yarn install comes before git add -A')
    assert.ok(publish.slice(0, installIndex).some((line) => line.includes('yarn.lock')))
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('--ci none removes the workflows but keeps the provider-neutral gate', async () => {
  const { workDir, appDir, output } = await scaffoldInTempDir([...BASE_ARGS, '--ci', 'none'])

  try {
    assert.ok(!existsSync(join(appDir, '.github')))
    assert.ok(existsSync(join(appDir, 'scripts', 'ci.mjs')))
    const packageJson = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8'))
    assert.equal(typeof packageJson.scripts.ci, 'string')

    const joined = output.join('\n')
    assert.ok(!joined.includes('Continuous integration:'))
    assert.ok(!joined.includes('ci.yml'))
    assert.ok(lineIndex(publishBlock(output), 'yarn install') >= 0)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('--ci with an unknown value fails before creating the target directory', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'create-app-ci-flag-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(workDir)
    await assert.rejects(main([...BASE_ARGS, '--ci', 'bogus']), /Unknown --ci value "bogus"/)
    assert.ok(!existsSync(join(workDir, 'app')))
  } finally {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  }
})
