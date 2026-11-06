import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const libDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(libDir, '..', '..', '..', '..')
const skillRoot = path.resolve(libDir, '..', '..', 'agentic', 'shared', 'ai', 'skills', 'om-setup-ci')
const generatorPath = path.join(skillRoot, 'scripts', 'setup-ci.mjs')

type GeneratorModule = {
  run: (argv: string[], options: { cwd: string; log: (message: string) => void }) => number
  renderTemplate: (text: string, flags: Record<string, boolean>, tokens: Record<string, string>) => string
  parseArgs: (argv: string[]) => { overrides: Record<string, boolean>; branches?: string[] }
}

async function loadGenerator(): Promise<GeneratorModule> {
  return (await import(generatorPath)) as GeneratorModule
}

function makeApp(options: { scripts?: Record<string, string>; dockerfile?: boolean; playwright?: boolean } = {}): string {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-setup-ci-'))
  const scripts = options.scripts ?? {
    generate: 'yarn mercato generate',
    lint: 'eslint .',
    typecheck: 'tsc --noEmit',
    'ds:check': 'node scripts/ds-check.mjs',
    test: 'jest --config jest.config.cjs',
    build: 'next build',
    'test:integration:ephemeral': 'yarn mercato test:integration',
    'test:integration:ephemeral:start': 'yarn mercato test:ephemeral',
  }
  const packageJson = {
    name: 'client-app',
    private: true,
    engines: { node: '>=24.0.0' },
    scripts,
    dependencies: { '@open-mercato/core': '0.0.0' },
    devDependencies: options.playwright === false ? {} : { '@playwright/test': '^1.58.2' },
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(packageJson, null, 2))
  fs.writeFileSync(path.join(appDir, 'yarn.lock'), '')
  if (options.dockerfile !== false) fs.writeFileSync(path.join(appDir, 'Dockerfile'), 'FROM node:24-alpine\n')
  if (options.playwright !== false) {
    fs.mkdirSync(path.join(appDir, '.ai', 'qa', 'tests'), { recursive: true })
    fs.writeFileSync(path.join(appDir, '.ai', 'qa', 'tests', 'playwright.config.ts'), 'export default {}\n')
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: appDir })
  return appDir
}

function read(appDir: string, relativePath: string): string {
  return fs.readFileSync(path.join(appDir, relativePath), 'utf8')
}

test('vendored CI scripts stay byte-identical to the monorepo originals', () => {
  for (const script of ['audit-ci.mjs', 'time-bomb-scanner.mjs']) {
    assert.equal(
      fs.readFileSync(path.join(skillRoot, 'templates', 'scripts', 'ci', script), 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'scripts', script), 'utf8'),
      `templates/scripts/ci/${script} drifted from scripts/${script} — copy the monorepo version into the skill`,
    )
  }
})

test('om-setup-ci is registered in a local skill tier', () => {
  const tiers = JSON.parse(fs.readFileSync(path.join(skillRoot, '..', 'tiers.json'), 'utf8')) as {
    tiers: Record<string, { skills: string[] }>
  }
  assert.ok(Object.values(tiers.tiers).some((tier) => tier.skills.includes('om-setup-ci')))
})

test('renderTemplate keeps enabled blocks, drops disabled ones, and rejects unknown tokens', async () => {
  const { renderTemplate } = await loadGenerator()
  const template = ['a', '#@if on', 'b __OM_NAME__', '#@endif', '#@if !on', 'c', '#@endif'].join('\n')
  assert.equal(renderTemplate(template, { on: true }, { NAME: 'x' }), 'a\nb x')
  assert.equal(renderTemplate(template, { on: false }, { NAME: 'x' }), 'a\nc')
  assert.throws(() => renderTemplate('__OM_MISSING__', {}, {}), /unknown token/)
  assert.throws(() => renderTemplate('#@if nope\n#@endif', {}, {}), /unknown flag/)
  assert.throws(() => renderTemplate('#@if on', { on: true }, {}), /unclosed/)
  assert.equal(renderTemplate('__OM_SHA256__', {}, { SHA256: 'abc' }), 'abc')
  assert.throws(() => renderTemplate('__OM_MISSING_SHA256__', {}, {}), /unknown token/)
})

test('generates every file with all checks enabled and no leftover template markers', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp()
  assert.equal(run([], { cwd: appDir, log: () => {} }), 0)
  for (const file of [
    '.github/workflows/ci.yml',
    '.github/workflows/audit.yml',
    '.github/workflows/security.yml',
    '.github/actions/setup/action.yml',
    '.github/actions/gitleaks/action.yml',
    '.github/actions/playwright/action.yml',
    '.github/dependabot.yml',
    '.github/om-ci.json',
    'scripts/ci/semgrep/open-mercato.yml',
    'scripts/ci/audit-ci.mjs',
    'scripts/ci/audit-ci-allowlist.json',
    'scripts/ci/time-bomb-scanner.mjs',
    'docs/ci/README.md',
  ]) {
    const content = read(appDir, file)
    assert.doesNotMatch(content, /__OM_[A-Z_]+__|#@if|#@endif/, `${file} still contains template markers`)
  }
  const workflow = read(appDir, '.github/workflows/ci.yml')
  for (const step of ['yarn lint', 'yarn generate', 'yarn typecheck', 'yarn ds:check', 'yarn test --ci', 'yarn build', 'yarn test:integration:ephemeral', 'docker/build-push-action', 'audit-ci.mjs --severity', 'gitleaks', 'semgrep scan', 'zizmor-action', 'aquasec/trivy']) {
    assert.ok(workflow.includes(step), `ci.yml is missing "${step}"`)
  }
  assert.match(workflow, /needs: \[changes, audit, secrets, sast, workflow-lint, lint, validate, integration, docker\]/)
  assert.equal(fs.existsSync(path.join(appDir, '.github/workflows/codeql.yml')), false)
  assert.equal(fs.existsSync(path.join(appDir, 'scripts/ci/zap-rules.tsv')), false)
  assert.doesNotMatch(read(appDir, '.github/workflows/security.yml'), /zap-baseline/)
  assert.match(read(appDir, '.github/actions/setup/action.yml'), /node-version: '24'/)
})

test('omits checks whose scripts or files are missing and records why in the docs', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp({ scripts: { generate: 'yarn mercato generate', build: 'next build' }, dockerfile: false, playwright: false })
  assert.equal(run([], { cwd: appDir, log: () => {} }), 0)
  const workflow = read(appDir, '.github/workflows/ci.yml')
  assert.doesNotMatch(workflow, /yarn lint|yarn typecheck|test:integration|build-push-action|aquasec\/trivy/)
  assert.match(workflow, /needs: \[changes, audit, secrets, sast, workflow-lint, validate\]/)
  const docs = read(appDir, 'docs/ci/README.md')
  assert.match(docs, /\| Lint \| disabled — no "lint" script in package\.json \|/)
  assert.match(docs, /\| Docker image build \| disabled — no Dockerfile at the app root \|/)
  assert.match(docs, /\| Nightly dynamic scan \(OWASP ZAP\) \| disabled — off by default, enable with --with-dast \|/)
})

test('pins every third-party action to a commit SHA and keeps event data out of scripts', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp()
  assert.equal(run(['--with-code-scanning', '--with-dast'], { cwd: appDir, log: () => {} }), 0)
  const files = [
    '.github/workflows/ci.yml',
    '.github/workflows/audit.yml',
    '.github/workflows/security.yml',
    '.github/workflows/codeql.yml',
    '.github/actions/setup/action.yml',
    '.github/actions/gitleaks/action.yml',
    '.github/actions/playwright/action.yml',
  ]
  for (const file of files) {
    const lines = read(appDir, file).split('\n')
    for (const line of lines) {
      const uses = line.match(/^\s*(?:- )?uses: (\S+)/)
      if (uses && !uses[1].startsWith('./')) {
        assert.match(uses[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: "${uses[1]}" is not pinned to a commit SHA`)
        assert.match(line, /# v\d+\.\d+\.\d+$/, `${file}: "${uses[1]}" lacks its version comment`)
      }
      if (line.includes('${{ github.event.')) {
        assert.match(line, /^\s*[A-Z_]+: \$\{\{|^\s*(group|cancel-in-progress):/, `${file}: event data outside env: "${line.trim()}"`)
      }
    }
    assert.ok(!/actions\/checkout@/.test(read(appDir, file)) || /persist-credentials: false/.test(read(appDir, file)), `${file} keeps checkout credentials`)
  }
  for (const image of ['semgrep/semgrep', 'aquasec/trivy', 'zaproxy/zap-stable']) {
    const all = files.map((file) => read(appDir, file)).join('\n')
    assert.match(all, new RegExp(`${image.replace('/', '\\/')}:[\\w.-]+@sha256:[0-9a-f]{64}`), `${image} is not pinned to a digest`)
  }
  const ciWorkflow = read(appDir, '.github/workflows/ci.yml')
  assert.match(ciWorkflow, /security-events: write/)
  assert.match(ciWorkflow, /advanced-security: true/)
  assert.match(ciWorkflow, /advanced-security: false/, 'code scanning must not turn the blocking zizmor run into SARIF-only')
  assert.match(read(appDir, '.github/workflows/security.yml'), /zap-baseline/)
  assert.match(read(appDir, '.github/dependabot.yml'), /default-days: 14/)
  const manifest = JSON.parse(read(appDir, '.github/om-ci.json')) as { options: { enabled: string[] } }
  assert.deepEqual(manifest.options.enabled.sort(), ['codeScanning', 'dast'])
  assert.equal(run(['--force'], { cwd: appDir, log: () => {} }), 0)
  assert.ok(fs.existsSync(path.join(appDir, '.github/workflows/codeql.yml')), 'opt-in choices must survive a --force refresh')
})

test('every Semgrep fixture annotation names a rule that exists', () => {
  const rules = fs.readFileSync(path.join(skillRoot, 'templates', 'scripts', 'ci', 'semgrep', 'open-mercato.yml'), 'utf8')
  const fixture = fs.readFileSync(path.join(skillRoot, 'templates', 'scripts', 'ci', 'semgrep', 'open-mercato.fixture.txt'), 'utf8')
  const ruleIds = new Set([...rules.matchAll(/^\s+- id: (om-[a-z-]+)$/gm)].map((match) => match[1]))
  const annotated = new Set([...fixture.matchAll(/\b(?:ruleid|ok): (om-[a-z-]+)/g)].map((match) => match[1]))
  assert.ok(ruleIds.size >= 6)
  assert.deepEqual([...ruleIds].filter((id) => !annotated.has(id)), [], 'every rule needs fixture coverage')
  assert.deepEqual([...annotated].filter((id) => !ruleIds.has(id)), [], 'fixture references an unknown rule')
})

test('refuses to overwrite a locally edited file without --force, then keeps recorded options', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp()
  assert.equal(run(['--branches', 'main,develop', '--no-docker'], { cwd: appDir, log: () => {} }), 0)
  fs.appendFileSync(path.join(appDir, '.github/workflows/ci.yml'), '# local edit\n')
  fs.writeFileSync(path.join(appDir, 'scripts/ci/audit-ci-allowlist.json'), '{"version":1,"advisories":{"GHSA-aaaa-bbbb-cccc":{"reason":"kept"}}}\n')

  assert.equal(run([], { cwd: appDir, log: () => {} }), 3)
  assert.match(read(appDir, '.github/workflows/ci.yml'), /# local edit/)

  assert.equal(run(['--force'], { cwd: appDir, log: () => {} }), 0)
  const workflow = read(appDir, '.github/workflows/ci.yml')
  assert.doesNotMatch(workflow, /# local edit/)
  assert.match(workflow, /- develop/)
  assert.doesNotMatch(workflow, /build-push-action/)
  assert.match(read(appDir, 'scripts/ci/audit-ci-allowlist.json'), /GHSA-aaaa-bbbb-cccc/)
})

test('removes files it generated earlier once their feature is disabled', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp()
  assert.equal(run([], { cwd: appDir, log: () => {} }), 0)
  assert.equal(run(['--no-scheduled-audit', '--no-dependabot', '--force'], { cwd: appDir, log: () => {} }), 0)
  assert.equal(fs.existsSync(path.join(appDir, '.github/workflows/audit.yml')), false)
  assert.equal(fs.existsSync(path.join(appDir, '.github/dependabot.yml')), false)
  assert.equal(fs.existsSync(path.join(appDir, 'scripts/ci/audit-ci-allowlist.json')), true)
})

test('rejects unsafe option values and non-Open Mercato projects', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp()
  assert.throws(() => run(['--branches', 'main;rm -rf /'], { cwd: appDir, log: () => {} }), /invalid branch name/)
  assert.throws(() => run(['--provider', 'gitlab'], { cwd: appDir, log: () => {} }), /not supported yet/)
  assert.throws(() => run(['--audit-cron', '* *'], { cwd: appDir, log: () => {} }), /invalid --audit-cron/)
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-setup-ci-plain-'))
  fs.writeFileSync(path.join(plainDir, 'package.json'), JSON.stringify({ name: 'plain' }))
  assert.throws(() => run([], { cwd: plainDir, log: () => {} }), /no @open-mercato\/\* dependency/)
})

test('drops the DAST scan when the nightly security workflow that hosts it is disabled', async () => {
  const { run } = await loadGenerator()
  const appDir = makeApp()
  assert.equal(run(['--with-dast', '--no-scheduled-security'], { cwd: appDir, log: () => {} }), 0)
  assert.equal(fs.existsSync(path.join(appDir, '.github/workflows/security.yml')), false)
  assert.equal(fs.existsSync(path.join(appDir, 'scripts/ci/zap-rules.tsv')), false)
  assert.match(read(appDir, 'docs/ci/README.md'), /\| Nightly dynamic scan \(OWASP ZAP\) \| disabled — needs the nightly security scan \|/)
})

test('protects the conventional default branch rather than the checked-out feature branch', async () => {
  const { detectBranches } = (await import(generatorPath)) as { detectBranches: (targetDir: string) => string[] }
  const appDir = makeApp()
  const gitArgs = ['-c', 'user.name=ci', '-c', 'user.email=ci@example.com']
  execFileSync('git', [...gitArgs, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: appDir })
  execFileSync('git', ['checkout', '-q', '-b', 'feat/ci'], { cwd: appDir })
  assert.deepEqual(detectBranches(appDir), ['main'])
})
