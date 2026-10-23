#!/usr/bin/env node
// Generates a CI pipeline for a standalone Open Mercato app (create-mercato-app).
//
// Usage:
//   node .ai/skills/om-setup-ci/scripts/setup-ci.mjs [options]
//
// The generator inspects the target app (package.json scripts, Node pin,
// Dockerfile, integration-test harness, git branches), renders the provider
// templates shipped next to this script, and writes them into the app. It is
// dependency-free so it runs before `yarn install` and from any checkout.
//
// It never overwrites a file it did not produce identically unless `--force`
// is passed, and it never overwrites the audit allowlist, which holds the
// app's own justified exceptions. Re-running reuses the options recorded in
// .github/om-ci.json, so `--force` alone refreshes a pipeline to the latest
// templates without re-typing flags.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const GENERATOR_ID = 'om-setup-ci'
export const TEMPLATE_VERSION = 2
export const MANIFEST_PATH = '.github/om-ci.json'
export const SUPPORTED_PROVIDERS = ['github']

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATES_ROOT = path.join(SKILL_ROOT, 'templates')

// Every third-party action and tool is pinned to an immutable reference: actions
// to a commit SHA (Dependabot keeps them current through the trailing version
// comment), container images to a digest, the Gitleaks binary to a checksum.
// Each pinned release was at least two weeks old when it was chosen.
export const ACTIONS = {
  CHECKOUT: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  SETUP_NODE: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  CACHE: 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
  UPLOAD_ARTIFACT: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
  GITHUB_SCRIPT: 'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0',
  SETUP_BUILDX: 'docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1',
  BUILD_PUSH: 'docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0',
  ZIZMOR: 'zizmorcore/zizmor-action@cc914d7f3750a2d13d75c7f184a1060aa0e9d482 # v0.6.4',
  CODEQL_INIT: 'github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2',
  CODEQL_ANALYZE: 'github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2',
  UPLOAD_SARIF: 'github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2',
}

export const TOOLS = {
  GITLEAKS_VERSION: '8.30.1',
  GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  SEMGREP_IMAGE: 'semgrep/semgrep:1.180.0@sha256:529ee8a277ec8adc5b534d7c74eea0a47e9de21d62852b6ba7ac6ba9566845c3',
  TRIVY_IMAGE: 'aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa',
  ZAP_IMAGE: 'zaproxy/zap-stable:2.17.0@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6',
  ZIZMOR_VERSION: '1.30.1',
}

export const OPTIONAL_CHECKS = [
  { id: 'secrets', label: 'Secret scan (Gitleaks)' },
  { id: 'sast', label: 'Static analysis (Semgrep)' },
  { id: 'workflowLint', label: 'Workflow security (zizmor)' },
  { id: 'lint', label: 'Lint', script: 'lint' },
  { id: 'typecheck', label: 'Typecheck', script: 'typecheck' },
  { id: 'dsCheck', label: 'Design-system check', script: 'ds:check' },
  { id: 'timeBombs', label: 'Time-bomb test literals' },
  { id: 'test', label: 'Unit tests', script: 'test' },
  { id: 'build', label: 'Production build', script: 'build' },
  { id: 'integration', label: 'Integration tests', script: 'test:integration:ephemeral' },
  { id: 'docker', label: 'Docker image build' },
  { id: 'imageScan', label: 'Image scan (Trivy)' },
  { id: 'codeScanning', label: 'CodeQL + code-scanning uploads', defaultOn: false },
  { id: 'dast', label: 'Nightly dynamic scan (OWASP ZAP)', script: 'test:integration:ephemeral:start', defaultOn: false },
]

export const OPTIONAL_FILES = [
  { id: 'scheduledAudit', label: 'Nightly dependency audit' },
  { id: 'scheduledSecurity', label: 'Nightly security scan' },
  { id: 'dependabot', label: 'Dependabot for GitHub Actions' },
]

const isDefaultOn = (entry) => entry.defaultOn !== false

const flagName = (id) => id.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)

const FLAG_NAMES = Object.fromEntries([...OPTIONAL_CHECKS, ...OPTIONAL_FILES].map((entry) => [flagName(entry.id), entry.id]))

const REMOVABLE_PATHS = new Set([
  '.github/workflows/ci.yml',
  '.github/workflows/audit.yml',
  '.github/workflows/security.yml',
  '.github/workflows/codeql.yml',
  '.github/actions/setup/action.yml',
  '.github/actions/gitleaks/action.yml',
  '.github/actions/playwright/action.yml',
  '.github/dependabot.yml',
  'scripts/ci/audit-ci.mjs',
  'scripts/ci/time-bomb-scanner.mjs',
  'scripts/ci/semgrep/open-mercato.yml',
  'docs/ci/README.md',
])

const SECURITY_CRON = '37 3 * * *'
const CODEQL_CRON = '23 4 * * 1'

const SEVERITIES = ['low', 'moderate', 'high', 'critical']
const SAFE_REF = /^[A-Za-z0-9._/-]+$/
const SAFE_RUNNER = /^[A-Za-z0-9._-]+$/
const SAFE_NODE = /^[A-Za-z0-9.*/-]+$/
const SAFE_CRON = /^[0-9*/,\- ]+$/

export const HELP = `Usage: node .ai/skills/om-setup-ci/scripts/setup-ci.mjs [options]

Generates a CI pipeline for a standalone Open Mercato app.

Options:
  --provider <name>        CI provider (default: github; supported: ${SUPPORTED_PROVIDERS.join(', ')})
  --target <dir>           App root to configure (default: current directory)
  --branches <a,b>         Branches CI protects (default: detected default branch, plus develop when it exists)
  --node <version>         Node.js version when the app has no .nvmrc/.node-version (default: engines.node major, else 24)
  --runner <label>         runs-on label for every job (default: ubuntu-latest)
  --audit-severity <level> Lowest advisory severity that fails the audit (default: high)
  --audit-cron <expr>      Schedule of the nightly audit (default: "17 6 * * *")
  --no-<check>             Disable a check: ${Object.keys(FLAG_NAMES).join(', ')}
  --with-<check>           Enable a check. Off by default: code-scanning (CodeQL and SARIF uploads;
                           needs a public repo or GitHub Code Security), dast (nightly OWASP ZAP scan)
  --dry-run                Print the plan without writing files
  --force                  Overwrite generated files that differ from the templates
  --json                   Print the result as JSON
  -h, --help               Show this help
`

export function parseArgs(argv) {
  const options = { overrides: {}, force: false, dryRun: false, json: false, help: false }
  const takeValue = (index, name) => {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
  }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    const [name, inlineValue] = argument.includes('=') ? argument.split(/=(.*)/s, 2) : [argument, undefined]
    const value = () => {
      if (inlineValue !== undefined) return inlineValue
      const next = takeValue(index, name)
      index++
      return next
    }
    if (name === '-h' || name === '--help') options.help = true
    else if (name === '--force') options.force = true
    else if (name === '--dry-run') options.dryRun = true
    else if (name === '--json') options.json = true
    else if (name === '--provider') options.provider = value()
    else if (name === '--target') options.target = value()
    else if (name === '--branches') options.branches = value().split(',').map((entry) => entry.trim()).filter(Boolean)
    else if (name === '--node') options.node = value()
    else if (name === '--runner') options.runner = value()
    else if (name === '--audit-severity') options.auditSeverity = value()
    else if (name === '--audit-cron') options.auditCron = value()
    else if (name.startsWith('--no-') && FLAG_NAMES[name.slice(5)]) options.overrides[FLAG_NAMES[name.slice(5)]] = false
    else if (name.startsWith('--with-') && FLAG_NAMES[name.slice(7)]) options.overrides[FLAG_NAMES[name.slice(7)]] = true
    else throw new Error(`unknown option "${argument}" (see --help)`)
  }
  return options
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function git(targetDir, args) {
  try {
    return execFileSync('git', ['-C', targetDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export function detectBranches(targetDir) {
  const remoteHead = git(targetDir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const conventionalBranch = ['main', 'master'].find((name) => git(targetDir, ['show-ref', '--verify', `refs/heads/${name}`]))
  const defaultBranch = remoteHead.startsWith('origin/')
    ? remoteHead.slice('origin/'.length)
    : conventionalBranch
      || git(targetDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
      || 'main'
  const branches = [defaultBranch === 'HEAD' ? 'main' : defaultBranch]
  const hasDevelop = git(targetDir, ['show-ref', 'refs/remotes/origin/develop']) || git(targetDir, ['show-ref', 'refs/heads/develop'])
  if (hasDevelop && !branches.includes('develop')) branches.push('develop')
  return branches
}

export function detectNode(targetDir, packageJson) {
  for (const file of ['.nvmrc', '.node-version']) {
    if (existsSync(path.join(targetDir, file))) return { versionFile: file, version: null }
  }
  const major = String(packageJson.engines?.node ?? '').match(/\d+/)?.[0]
  return { versionFile: null, version: major ?? '24' }
}

function hasIntegrationHarness(targetDir, packageJson) {
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
  return Boolean(dependencies['@playwright/test'])
    && existsSync(path.join(targetDir, '.ai', 'qa', 'tests', 'playwright.config.ts'))
}

export function detectApp(targetDir) {
  const packageJsonPath = path.join(targetDir, 'package.json')
  if (!existsSync(packageJsonPath)) throw new Error(`no package.json in ${targetDir} — run from the app root or pass --target`)
  const packageJson = readJson(packageJsonPath)
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
  if (!Object.keys(dependencies).some((name) => name.startsWith('@open-mercato/'))) {
    throw new Error(`${packageJsonPath} has no @open-mercato/* dependency — this generator targets apps created with create-mercato-app`)
  }
  if (!existsSync(path.join(targetDir, 'yarn.lock'))) {
    throw new Error('no yarn.lock found — the generated pipeline installs with `yarn install --immutable`, so commit a Yarn lockfile first')
  }
  const scripts = packageJson.scripts ?? {}
  if (!scripts.generate) throw new Error('package.json has no "generate" script — expected an Open Mercato app (`yarn mercato generate`)')

  const available = {}
  const reasons = {}
  for (const check of OPTIONAL_CHECKS) {
    if (check.script) {
      available[check.id] = Boolean(scripts[check.script])
      if (!available[check.id]) reasons[check.id] = `no "${check.script}" script in package.json`
    }
  }
  for (const id of ['secrets', 'sast', 'workflowLint', 'timeBombs', 'codeScanning', 'scheduledAudit', 'scheduledSecurity', 'dependabot']) {
    available[id] = true
  }
  available.docker = existsSync(path.join(targetDir, 'Dockerfile'))
  if (!available.docker) reasons.docker = 'no Dockerfile at the app root'
  available.imageScan = available.docker
  if (!available.imageScan) reasons.imageScan = 'no Dockerfile at the app root'
  const harness = hasIntegrationHarness(targetDir, packageJson)
  for (const id of ['integration', 'dast']) {
    if (available[id] && !harness) {
      available[id] = false
      reasons[id] = 'missing @playwright/test or .ai/qa/tests/playwright.config.ts'
    }
  }

  return {
    packageJson,
    available,
    reasons,
    node: detectNode(targetDir, packageJson),
    branches: detectBranches(targetDir),
    testCommand: /\bjest\b/.test(scripts.test ?? '') ? 'yarn test --ci' : 'yarn test',
    existingWorkflows: existsSync(path.join(targetDir, '.github', 'workflows'))
      ? readdirSync(path.join(targetDir, '.github', 'workflows')).filter((name) => /\.ya?ml$/.test(name))
      : [],
  }
}

export function resolveConfig(cliOptions, detected, manifest) {
  const recorded = manifest?.options ?? {}
  const provider = cliOptions.provider ?? manifest?.provider ?? 'github'
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`provider "${provider}" is not supported yet (supported: ${SUPPORTED_PROVIDERS.join(', ')})`)
  }
  const config = {
    provider,
    branches: cliOptions.branches ?? recorded.branches ?? detected.branches,
    node: cliOptions.node ?? recorded.node ?? null,
    runner: cliOptions.runner ?? recorded.runner ?? 'ubuntu-latest',
    auditSeverity: cliOptions.auditSeverity ?? recorded.auditSeverity ?? 'high',
    auditCron: cliOptions.auditCron ?? recorded.auditCron ?? '17 6 * * *',
    disabled: [],
  }
  if (config.branches.length === 0) throw new Error('--branches needs at least one branch')
  for (const branch of config.branches) {
    if (!SAFE_REF.test(branch)) throw new Error(`invalid branch name "${branch}"`)
  }
  if (!SAFE_RUNNER.test(config.runner)) throw new Error(`invalid runner label "${config.runner}"`)
  if (config.node !== null && !SAFE_NODE.test(config.node)) throw new Error(`invalid Node version "${config.node}"`)
  if (!SEVERITIES.includes(config.auditSeverity)) {
    throw new Error(`invalid --audit-severity "${config.auditSeverity}" (expected one of ${SEVERITIES.join(', ')})`)
  }
  if (!SAFE_CRON.test(config.auditCron) || config.auditCron.trim().split(/\s+/).length !== 5) {
    throw new Error(`invalid --audit-cron "${config.auditCron}" (expected a 5-field cron expression)`)
  }

  const recordedDisabled = new Set(recorded.disabled ?? [])
  const recordedEnabled = new Set(recorded.enabled ?? [])
  config.enabled = []
  const features = {}
  const notes = {}
  for (const entry of [...OPTIONAL_CHECKS, ...OPTIONAL_FILES]) {
    const recordedChoice = isDefaultOn(entry) ? !recordedDisabled.has(entry.id) : recordedEnabled.has(entry.id)
    const requested = cliOptions.overrides[entry.id] ?? recordedChoice
    if (requested !== isDefaultOn(entry)) (requested ? config.enabled : config.disabled).push(entry.id)
    if (!requested) {
      features[entry.id] = false
      notes[entry.id] = isDefaultOn(entry) ? 'disabled by option' : `off by default, enable with --with-${flagName(entry.id)}`
    } else if (!detected.available[entry.id]) {
      features[entry.id] = false
      notes[entry.id] = detected.reasons[entry.id]
    } else {
      features[entry.id] = true
    }
  }
  if (features.imageScan && !features.docker) {
    features.imageScan = false
    notes.imageScan = 'needs the Docker image build'
  }
  if (features.dast && !features.scheduledSecurity) {
    features.dast = false
    notes.dast = 'needs the nightly security scan'
  }
  const nightlyScans = ['secrets', 'sast', 'imageScan', 'dast'].filter((id) => features[id])
  if (features.scheduledSecurity && nightlyScans.length === 0) {
    features.scheduledSecurity = false
    notes.scheduledSecurity = 'no security scan is enabled'
  }
  return { config, features, notes }
}

export function renderTemplate(text, flags, tokens) {
  const output = []
  const stack = []
  for (const line of text.split('\n')) {
    const condition = line.match(/^\s*#@if\s+(!?)([A-Za-z]+)\s*$/)
    if (condition) {
      if (!(condition[2] in flags)) throw new Error(`template uses unknown flag "${condition[2]}"`)
      stack.push(condition[1] ? !flags[condition[2]] : Boolean(flags[condition[2]]))
      continue
    }
    if (/^\s*#@endif\s*$/.test(line)) {
      if (stack.length === 0) throw new Error('template has an unmatched #@endif')
      stack.pop()
      continue
    }
    if (stack.every(Boolean)) output.push(line)
  }
  if (stack.length > 0) throw new Error('template has an unclosed #@if')
  return output.join('\n').replace(/__OM_([A-Z0-9_]+)__/g, (match, name) => {
    if (!(name in tokens)) throw new Error(`template uses unknown token ${match}`)
    return tokens[name]
  })
}

function checksTable(features, notes) {
  const rows = [...OPTIONAL_CHECKS, ...OPTIONAL_FILES].map((entry) => {
    const status = features[entry.id] ? 'enabled' : `disabled — ${notes[entry.id]}`
    return `| ${entry.label} | ${status} |`
  })
  return ['| Check | Status in this repository |', '| --- | --- |', '| Dependency audit (pull requests) | enabled |', '| Generate + clean-tree check | enabled |', ...rows].join('\n')
}

export function buildPlan(config, features, notes, detected) {
  const node = config.node
    ? { versionFile: null, version: config.node }
    : detected.node
  const flags = { ...features, nodeVersionFile: Boolean(node.versionFile) }
  const needs = [
    'changes',
    'audit',
    features.secrets && 'secrets',
    features.sast && 'sast',
    features.workflowLint && 'workflow-lint',
    features.lint && 'lint',
    'validate',
    features.integration && 'integration',
    features.docker && 'docker',
  ].filter(Boolean)
  const securityNeeds = [
    features.secrets && 'secrets',
    features.sast && 'sast',
    features.imageScan && 'image',
    features.dast && 'dast',
  ].filter(Boolean)
  const tokens = {
    ...Object.fromEntries(Object.entries(ACTIONS).map(([name, reference]) => [`ACTION_${name}`, reference])),
    ...TOOLS,
    DEFAULT_BRANCH: config.branches[0],
    SECURITY_CRON,
    CODEQL_CRON,
    SECURITY_NEEDS: securityNeeds.join(', '),
    BRANCH_LIST: config.branches.map((branch) => `      - ${branch}`).join('\n'),
    BRANCH_MATRIX: config.branches.map((branch) => `'${branch}'`).join(', '),
    BRANCHES_INLINE: config.branches.map((branch) => `\`${branch}\``).join(', '),
    RUNNER: config.runner,
    NODE_VERSION: node.version ?? '',
    NODE_VERSION_FILE: node.versionFile ?? '',
    NODE_SOURCE: node.versionFile ? `\`${node.versionFile}\`` : `\`${node.version}\` (no \`.nvmrc\` found; change with \`--node\`)`,
    AUDIT_SEVERITY: config.auditSeverity,
    AUDIT_CRON: config.auditCron,
    TEST_COMMAND: detected.testCommand,
    DOCKERFILE: 'Dockerfile',
    NEEDS: needs.join(', '),
    INTEGRATION_NEEDS: features.lint ? 'lint, validate' : 'validate',
    CHECKS_TABLE: checksTable(features, notes),
  }
  const render = (relativeTemplate) => renderTemplate(readFileSync(path.join(TEMPLATES_ROOT, relativeTemplate), 'utf8'), flags, tokens)
  const copy = (relativeTemplate) => readFileSync(path.join(TEMPLATES_ROOT, relativeTemplate), 'utf8')

  const files = [
    { path: '.github/workflows/ci.yml', content: render('github/workflows/ci.yml') },
    { path: '.github/actions/setup/action.yml', content: render('github/actions/setup/action.yml') },
    { path: '.github/workflows/codeql.yml', content: render('github/workflows/codeql.yml'), when: features.codeScanning },
    { path: '.github/workflows/security.yml', content: render('github/workflows/security.yml'), when: features.scheduledSecurity },
    { path: '.github/actions/gitleaks/action.yml', content: render('github/actions/gitleaks/action.yml'), when: features.secrets },
    { path: '.github/actions/playwright/action.yml', content: render('github/actions/playwright/action.yml'), when: features.integration },
    { path: 'scripts/ci/semgrep/open-mercato.yml', content: copy('scripts/ci/semgrep/open-mercato.yml'), when: features.sast },
    { path: 'scripts/ci/zap-rules.tsv', content: copy('scripts/ci/zap-rules.tsv'), preserve: true, when: features.dast },
    { path: 'scripts/ci/audit-ci.mjs', content: copy('scripts/ci/audit-ci.mjs') },
    { path: 'scripts/ci/audit-ci-allowlist.json', content: copy('scripts/ci/audit-ci-allowlist.json'), preserve: true },
    { path: 'docs/ci/README.md', content: render('docs/README.md') },
  ]
    .filter((file) => file.when !== false)
    .map((file) => ({ path: file.path, content: file.content, preserve: file.preserve }))
  if (features.scheduledAudit) files.push({ path: '.github/workflows/audit.yml', content: render('github/workflows/audit.yml') })
  if (features.dependabot) files.push({ path: '.github/dependabot.yml', content: render('github/dependabot.yml') })
  if (features.timeBombs) files.push({ path: 'scripts/ci/time-bomb-scanner.mjs', content: copy('scripts/ci/time-bomb-scanner.mjs') })

  const manifest = {
    generator: GENERATOR_ID,
    templateVersion: TEMPLATE_VERSION,
    provider: config.provider,
    options: {
      branches: config.branches,
      node: config.node,
      runner: config.runner,
      auditSeverity: config.auditSeverity,
      auditCron: config.auditCron,
      disabled: config.disabled,
      enabled: config.enabled,
    },
    files: files.map((file) => file.path).sort(),
  }
  files.push({ path: MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` })
  return { files, needs }
}

export function applyPlan(targetDir, files, { force, dryRun }, previousFiles = []) {
  const planned = new Set(files.map((file) => file.path))
  const removals = previousFiles
    .filter((filePath) => REMOVABLE_PATHS.has(filePath) && !planned.has(filePath))
    .filter((filePath) => existsSync(path.join(targetDir, filePath)))
    .map((filePath) => ({ path: filePath, status: 'remove' }))
  const results = files.map((file) => {
    const absolutePath = path.join(targetDir, file.path)
    if (!existsSync(absolutePath)) return { ...file, status: 'create' }
    const current = readFileSync(absolutePath, 'utf8')
    if (current === file.content) return { ...file, status: 'unchanged' }
    if (file.preserve) return { ...file, status: 'kept' }
    return { ...file, status: force ? 'overwrite' : 'conflict' }
  })
  const conflicts = results.filter((result) => result.status === 'conflict')
  if (!dryRun && conflicts.length === 0) {
    for (const result of results) {
      if (result.status !== 'create' && result.status !== 'overwrite') continue
      const absolutePath = path.join(targetDir, result.path)
      mkdirSync(path.dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, result.content)
    }
    for (const removal of removals) rmSync(path.join(targetDir, removal.path))
  }
  return { results: [...results, ...removals], conflicts }
}

function report(outcome) {
  const { targetDir, config, features, notes, results, conflicts, dryRun, detected } = outcome
  const lines = [`om-setup-ci → ${targetDir} (provider: ${config.provider}${dryRun ? ', dry run' : ''})`, '']
  lines.push(`Branches: ${config.branches.join(', ')}   Runner: ${config.runner}   Audit: ${config.auditSeverity}+`)
  lines.push('', 'Checks:')
  for (const entry of [...OPTIONAL_CHECKS, ...OPTIONAL_FILES]) {
    lines.push(`  ${features[entry.id] ? '✓' : '·'} ${entry.label}${features[entry.id] ? '' : ` (${notes[entry.id]})`}`)
  }
  lines.push('', 'Files:')
  for (const result of results) lines.push(`  ${result.status.padEnd(9)} ${result.path}`)
  const others = detected.existingWorkflows.filter((name) => !REMOVABLE_PATHS.has(`.github/workflows/${name}`))
  if (others.length > 0) {
    lines.push('', `Existing workflows left untouched (check them for duplicated jobs): ${others.join(', ')}`)
  }
  if (conflicts.length > 0) {
    lines.push('', `Nothing was written: ${conflicts.length} file(s) already exist with different content.`)
    lines.push('Review them, then re-run with --force to replace them with the generated versions.')
  } else if (!dryRun) {
    lines.push('', 'Next steps:')
    lines.push('  1. Review the diff and commit it on a branch, then open a pull request to see the first run.')
    lines.push('  2. Mark the "CI" check as required for the protected branches (see docs/ci/README.md → Branch protection).')
  }
  return lines.join('\n')
}

export function run(argv, { cwd = process.cwd(), log = console.log } = {}) {
  const cliOptions = parseArgs(argv)
  if (cliOptions.help) {
    log(HELP)
    return 0
  }
  const targetDir = path.resolve(cwd, cliOptions.target ?? '.')
  const detected = detectApp(targetDir)
  const manifestPath = path.join(targetDir, MANIFEST_PATH)
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null
  const { config, features, notes } = resolveConfig(cliOptions, detected, manifest)
  const { files } = buildPlan(config, features, notes, detected)
  const { results, conflicts } = applyPlan(targetDir, files, cliOptions, Array.isArray(manifest?.files) ? manifest.files : [])
  const outcome = { targetDir, config, features, notes, results, conflicts, dryRun: cliOptions.dryRun, detected }
  if (cliOptions.json) {
    log(JSON.stringify({
      targetDir,
      provider: config.provider,
      dryRun: cliOptions.dryRun,
      options: config,
      checks: Object.fromEntries(Object.entries(features).map(([id, enabled]) => [id, enabled ? 'enabled' : notes[id]])),
      files: results.map((result) => ({ path: result.path, status: result.status })),
    }, null, 2))
  } else {
    log(report(outcome))
  }
  return conflicts.length > 0 ? 3 : 0
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (error) {
    console.error(`om-setup-ci: ${error.message}`)
    process.exitCode = 1
  }
}
