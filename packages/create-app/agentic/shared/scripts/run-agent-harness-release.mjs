#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { assertSandboxRuntimeAvailable, sandboxedInvocation, verifyLinuxSandboxIsolation } from './execution-sandbox.mjs'

const WRITABLE_KINDS = new Set(['implementation', 'regression'])
const RELEASE_SUPPORTED_RUNNERS = ['codex', 'claude']
const RELEASE_VALIDATION_COMMANDS = ['yarn generate', 'yarn typecheck', 'yarn lint', 'yarn build']
const RELEASE_VALIDATION_OUTPUT_ROOTS = new Map([
  ['yarn generate', ['.mercato/generated']],
  ['yarn typecheck', ['tsconfig.tsbuildinfo']],
  ['yarn lint', []],
  ['yarn build', ['.mercato/generated', '.mercato/next', 'next-env.d.ts', 'tsconfig.tsbuildinfo']],
])
const RUNNERS = new Set(RELEASE_SUPPORTED_RUNNERS)
const ALLOWED_VALIDATION_COMMANDS = new Set(RELEASE_VALIDATION_COMMANDS)
const GENERATED_TEST_RUNNERS = new Set(['jest', 'playwright-api', 'playwright-browser'])
const RESULT_LIMIT = 262_144
const ERROR_LIMIT = 2_000
const VIOLATION_LIMIT = 300
// The routing step hands this to the evaluator as --timeout and derives its own process budget from
// the same value, so the two cannot be stated separately; the help text reads it rather than
// repeating it (#5078).
export const DEFAULT_CASE_TIMEOUT_MS = 600_000
export const ROUTING_STEP_SLACK_MS = 60_000
const COPY_EXCLUDED_PREFIXES = [
  '.git', '.next', '.turbo', '.cache', 'build', 'coverage', 'dist', 'node_modules', 'out',
  '.ai/framework-context', '.ai/harness/results', '.ai/reports',
  '.mercato/generated', '.mercato/next', 'next-env.d.ts', 'tsconfig.tsbuildinfo',
]
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SENSITIVE_AUTH_FILES = new Set(['.git-credentials', '.netrc', '.npmrc', '.pypirc', '.yarnrc', '.yarnrc.yml', '.yarnrc.yaml'])
const SENSITIVE_AUTH_DATA_FILE = /^(?:auth|credentials?|secrets?|tokens?)(?:\.(?:conf(?:ig)?|ini|json|toml|txt|ya?ml))?$/
const SENSITIVE_ENV_KEY = /(?:^|_)(?:api_?key|auth|credential|credentials|password|passwd|private_?key|secret|token)(?:_|$)/i
const GENERATED_YARN_CONFIG_PATH = '.yarnrc.yml'
const GENERATED_YARN_CONFIG_LIMIT = 16_384
// The deterministic step invokes no model, so its ceiling must not ride --case-timeout. Timed on
// Linux x86_64, the complete catalog finished in 768-998 ms, and narrowing the selection
// down to a single case measured 842-890 ms, inside the same spread, so the run is dominated by
// fixed process and catalog load rather than by case count. A flat allowance is therefore the
// honest shape, and 120000 ms is both about 120x the slowest observed run and the value this gate
// already gives its other model-free step, fixture preparation. It bounds a hang; a healthy run
// never approaches it.
export const DETERMINISTIC_STEP_TIMEOUT_MS = 120_000

function usage() {
  return `Run the complete standalone agent-harness release gate.

Usage:
  yarn harness:release --runner <codex|claude> --prepare-targets /absolute/empty-directory --acknowledge-writes
  yarn harness:release --runner <codex|claude> --writable-targets /absolute/release-targets.json --acknowledge-writes

Options:
  --root <absolute-app>          Controller/generated app root (default: current directory)
  --runner <codex|claude>        Required primary runner for every blocking live lane
  --portability-runner <runner> Optional different runner for the 49-case read-only portability lane
  --prepare-targets <absolute>   Clone this fresh scaffold once per writable case under an empty/new directory
  --writable-targets <absolute> JSON map of every writable case to a fresh disposable app
  --case-timeout <ms>           Per-model invocation timeout floor for the routing, writable, and review lanes (default: ${DEFAULT_CASE_TIMEOUT_MS})
                                The model-free deterministic and fixture-preparation steps carry their own flat ceilings and do not read it.
  --validation-timeout <ms>     Timeout for each yarn validation (default: 1800000)
  --acknowledge-writes          Required: fixture preparation and validation commands write files
  --help                        Show this help

Exactly one target option is required. Automatic targets require a fresh controller
without local environment, credential, or private-key files; safe .env.example/sample/template
files are retained. Targets exclude dependencies, build outputs, harness results, and
generated framework context, then safely reference the controller's protected dependency
tree. Externally supplied targets must use the same
node_modules link to that protected tree; nested dependency copies are rejected.
The complete release requires trusted Bubblewrap plus working user/network namespaces on Linux;
native macOS, Windows, untrusted runtimes, and unavailable isolation fail closed. The command preflights complete matrix,
fixture, judge, and target coverage before
running deterministic validation, selected primary routing, optional portability routing, writable trusted-oracle
gates, explicit om-judge-agent-session with om-code-review, and the release-matrix validation commands. It stores
only a sanitized aggregate report under .ai/harness/results/.`
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    runner: undefined,
    portabilityRunner: undefined,
    prepareTargets: undefined,
    writableTargets: undefined,
    caseTimeout: DEFAULT_CASE_TIMEOUT_MS,
    validationTimeout: 1_800_000,
    acknowledgeWrites: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      index += 1
      if (index >= argv.length) throw new Error(`${arg} requires a value`)
      return argv[index]
    }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--root') options.root = value()
    else if (arg === '--runner') options.runner = value()
    else if (arg === '--portability-runner') options.portabilityRunner = value()
    else if (arg === '--prepare-targets') options.prepareTargets = value()
    else if (arg === '--writable-targets') options.writableTargets = value()
    else if (arg === '--case-timeout') options.caseTimeout = Number(value())
    else if (arg === '--validation-timeout') options.validationTimeout = Number(value())
    else if (arg === '--acknowledge-writes') options.acknowledgeWrites = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.help) return options
  if (!path.isAbsolute(options.root)) throw new Error('--root must be an absolute path')
  if (!RUNNERS.has(options.runner)) throw new Error('--runner must be codex or claude')
  if (options.portabilityRunner !== undefined && !RUNNERS.has(options.portabilityRunner)) throw new Error('--portability-runner must be codex or claude')
  if (options.portabilityRunner === options.runner) throw new Error('--portability-runner must differ from --runner')
  if (Boolean(options.prepareTargets) === Boolean(options.writableTargets)) throw new Error('pass exactly one of --prepare-targets or --writable-targets')
  if (options.prepareTargets && !path.isAbsolute(options.prepareTargets)) throw new Error('--prepare-targets must be an absolute path')
  if (options.writableTargets && !path.isAbsolute(options.writableTargets)) throw new Error('--writable-targets must be an absolute path')
  if (!options.acknowledgeWrites) throw new Error('the full release gate requires --acknowledge-writes')
  if (!Number.isInteger(options.caseTimeout) || options.caseTimeout < 1_000 || options.caseTimeout > 3_600_000) throw new Error('--case-timeout must be from 1000 to 3600000 milliseconds')
  if (!Number.isInteger(options.validationTimeout) || options.validationTimeout < 1_000 || options.validationTimeout > 7_200_000) throw new Error('--validation-timeout must be from 1000 to 7200000 milliseconds')
  return options
}

export function effectiveCaseTimeout(cases, caseId, fallback) {
  const declared = cases.find((item) => item.id === caseId)?.timeoutMs
  return Math.max(fallback, Number.isInteger(declared) ? declared : 0)
}

export function deterministicInvocation({ evaluator, root }) {
  return { args: [evaluator, '--root', root, '--all'], timeout: DETERMINISTIC_STEP_TIMEOUT_MS }
}

export function routingInvocation({ evaluator, root, step, cases, caseTimeout }) {
  const args = [evaluator, '--root', root, '--runner', step.runner]
  if (step.lane === 'primary') args.push('--all')
  args.push('--model', step.modelSelector, '--timeout', String(caseTimeout))
  const timeout = step.expectedCaseIds.reduce(
    (total, caseId) => total + effectiveCaseTimeout(cases, caseId, caseTimeout),
    ROUTING_STEP_SLACK_MS,
  )
  return { args, timeout }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function validModelSelector(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(value)
}

function normalizedRelative(root, absolute) {
  return path.relative(root, absolute).replaceAll(path.sep, '/')
}

function copyPathExcluded(relative) {
  return COPY_EXCLUDED_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))
}

function sensitiveScaffoldPath(relative, stat) {
  const basename = path.posix.basename(relative).toLowerCase()
  const lowerRelative = relative.toLowerCase()
  if ((basename === '.env' || basename.startsWith('.env.')) && !SAFE_ENV_TEMPLATES.has(basename)) return true
  // A fresh create-mercato-app scaffold always contains this generated root file.
  // Its contents are checked separately against the exact credential-free shape.
  if (lowerRelative === GENERATED_YARN_CONFIG_PATH) return relative !== GENERATED_YARN_CONFIG_PATH
  if (SENSITIVE_AUTH_FILES.has(basename)) return true
  if (/^(?:\.aws|\.azure|\.config\/gcloud|\.config\/gh|\.docker|\.gnupg|\.kube|\.oci|\.pulumi|\.ssh|\.terraform\.d)(?:\/|$)/.test(lowerRelative)) return true
  if (stat?.isDirectory()) return false
  if (SENSITIVE_AUTH_DATA_FILE.test(basename)) return true
  if (/\.(?:key|pem|p12|pfx|jks|keystore)$/.test(basename)) return true
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(basename)) return true
  return /(?:^|[._-])(?:credential|credentials|private[._-]?key|service[._-]?account)(?:[._-]|$)/.test(basename)
}

function parseGeneratedQuotedValue(line, prefix) {
  if (!line.startsWith(prefix)) return undefined
  try {
    const serialized = line.slice(prefix.length)
    const value = JSON.parse(serialized)
    return typeof value === 'string' && value.length > 0 && JSON.stringify(value) === serialized ? value : undefined
  } catch {
    return undefined
  }
}

function validGeneratedYarnConfig(contents) {
  if (Buffer.byteLength(contents, 'utf8') > GENERATED_YARN_CONFIG_LIMIT || contents.includes('\0')) return false
  const lines = contents.replaceAll('\r\n', '\n').split('\n').filter((line) => line !== '')
  const migrated = lines[0] === 'approvedGitRepositories:'
  if (migrated) {
    if (
      lines.shift() !== 'approvedGitRepositories:'
      || lines.shift() !== '  - "**"'
      || lines.shift() !== 'enableScripts: true'
    ) return false
  }
  if (lines.shift() !== 'nodeLinker: node-modules') return false
  if (migrated && lines.shift() !== 'npmMinimalAgeGate: 0') return false
  if (!lines.length) return true

  const unsafeHttpHosts = []
  const readUnsafeHttpHosts = () => {
    if (lines[0] !== 'unsafeHttpWhitelist:') return true
    lines.shift()
    while (lines[0]?.startsWith('  - ')) {
      const host = parseGeneratedQuotedValue(lines.shift(), '  - ')
      if (!host) return false
      unsafeHttpHosts.push(host)
    }
    return unsafeHttpHosts.length > 0
  }
  if (!migrated && !readUnsafeHttpHosts()) return false

  if (lines.shift() !== 'npmScopes:' || lines.shift() !== '  open-mercato:') return false
  if (migrated && lines.shift() !== '    npmMinimalAgeGate: 0') return false
  const registryUrl = parseGeneratedQuotedValue(lines.shift() ?? '', '    npmRegistryServer: ')
  if (!registryUrl || (!migrated && lines.shift() !== '    npmMinimalAgeGate: 0')) return false
  if (migrated && !readUnsafeHttpHosts()) return false
  if (lines.length) return false

  let parsedRegistryUrl
  try {
    parsedRegistryUrl = new URL(registryUrl)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsedRegistryUrl.protocol)) return false
  if (parsedRegistryUrl.username || parsedRegistryUrl.password || parsedRegistryUrl.search || parsedRegistryUrl.hash) return false

  const expectedUnsafeHosts = parsedRegistryUrl.protocol === 'http:' ? [parsedRegistryUrl.hostname] : []
  if (parsedRegistryUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedRegistryUrl.hostname)) {
    expectedUnsafeHosts.push('host.docker.internal')
  }
  return JSON.stringify(unsafeHttpHosts) === JSON.stringify(expectedUnsafeHosts)
}

function validateGeneratedYarnConfig(source, relative, stat) {
  if (relative !== GENERATED_YARN_CONFIG_PATH) return
  if (!stat.isFile() || stat.isSymbolicLink() || !validGeneratedYarnConfig(fs.readFileSync(source, 'utf8'))) {
    throw new Error('fresh controller contains an unsafe Yarn registry configuration; use a credential-free fresh scaffold')
  }
}

function validateScaffoldCopySource(root) {
  const realRoot = fs.realpathSync(root)
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const source = path.join(directory, name)
      const relative = normalizedRelative(realRoot, source)
      if (copyPathExcluded(relative)) continue
      const stat = fs.lstatSync(source)
      if (sensitiveScaffoldPath(relative, stat)) {
        throw new Error('fresh controller contains a local environment, credential, or private-key file; use a sanitized fresh scaffold')
      }
      validateGeneratedYarnConfig(source, relative, stat)
      if (stat.isSymbolicLink()) {
        const resolved = fs.realpathSync(source)
        const resolvedRelative = normalizedRelative(realRoot, resolved)
        if (!isPathInside(realRoot, resolved) || copyPathExcluded(resolvedRelative)) {
          throw new Error(`fresh scaffold contains an unsafe copied symlink: ${relative}`)
        }
      } else if (stat.isDirectory()) visit(source)
      else if (!stat.isFile()) throw new Error(`fresh scaffold contains an unsupported entry: ${relative}`)
    }
  }
  visit(realRoot)
}

function copyFreshScaffold(sourceRoot, targetRoot) {
  const realSourceRoot = fs.realpathSync(sourceRoot)
  const visit = (sourceDirectory, targetDirectory) => {
    fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o755 })
    for (const name of fs.readdirSync(sourceDirectory).sort()) {
      const source = path.join(sourceDirectory, name)
      const relative = normalizedRelative(realSourceRoot, source)
      if (copyPathExcluded(relative)) continue
      const stat = fs.lstatSync(source)
      // Fail closed if a sensitive file appears between validation and copy.
      if (sensitiveScaffoldPath(relative, stat)) {
        throw new Error('fresh controller contains a local environment, credential, or private-key file; use a sanitized fresh scaffold')
      }
      const destination = path.join(targetDirectory, name)
      validateGeneratedYarnConfig(source, relative, stat)
      if (stat.isDirectory()) visit(source, destination)
      else if (stat.isFile()) {
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE)
        fs.chmodSync(destination, stat.mode & 0o777)
      } else if (stat.isSymbolicLink()) {
        const resolved = fs.realpathSync(source)
        const resolvedRelative = normalizedRelative(realSourceRoot, resolved)
        const target = path.join(targetRoot, resolvedRelative)
        const type = fs.statSync(resolved).isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'
        fs.symlinkSync(path.relative(path.dirname(destination), target), destination, type)
      }
    }
  }
  visit(realSourceRoot, targetRoot)
}

export function resolvePreparationRoot(requested, controllerRoot) {
  if (!path.isAbsolute(requested)) throw new Error('--prepare-targets must be an absolute path')
  const resolved = path.resolve(requested)
  if (resolved === path.parse(resolved).root) throw new Error('--prepare-targets cannot be a filesystem root')
  let actual
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('--prepare-targets must be a regular directory')
    if (fs.readdirSync(resolved).length) throw new Error('--prepare-targets must be empty')
    actual = fs.realpathSync(resolved)
  } else {
    const parent = path.dirname(resolved)
    if (!fs.existsSync(parent)) throw new Error('--prepare-targets parent directory must already exist')
    const stat = fs.lstatSync(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('--prepare-targets parent must be a regular directory')
    actual = path.join(fs.realpathSync(parent), path.basename(resolved))
  }
  const controller = fs.realpathSync(controllerRoot)
  if (isPathInside(controller, actual) || isPathInside(actual, controller)) {
    throw new Error('--prepare-targets must be separate from the controller app')
  }
  return actual
}

export function prepareWritableTargets({ root, prepareRoot, caseIds }) {
  const controller = fs.realpathSync(root)
  if (fs.existsSync(path.join(controller, '.ai', 'harness', 'DISPOSABLE'))) {
    throw new Error('automatic target preparation requires an unmodified fresh controller scaffold')
  }
  const targetRoot = resolvePreparationRoot(prepareRoot, controller)
  if (!Array.isArray(caseIds) || new Set(caseIds).size !== caseIds.length || caseIds.some((id) => !/^OMH-[0-9]{3}$/.test(id))) {
    throw new Error('automatic writable target case IDs are invalid or duplicated')
  }
  const dependencyRoot = path.join(controller, 'node_modules')
  let dependencyStat
  try { dependencyStat = fs.lstatSync(dependencyRoot) } catch { throw new Error('controller node_modules is unavailable; run yarn install') }
  if (!dependencyStat.isDirectory() || dependencyStat.isSymbolicLink()) throw new Error('controller node_modules must be a regular installed dependency directory')
  validateScaffoldCopySource(controller)
  if (!fs.existsSync(targetRoot)) fs.mkdirSync(targetRoot, { mode: 0o700 })
  const targetRootStat = fs.lstatSync(targetRoot)
  if (!targetRootStat.isDirectory() || targetRootStat.isSymbolicLink() || fs.readdirSync(targetRoot).length) {
    throw new Error('automatic writable target root stopped being an empty regular directory')
  }
  const targets = {}
  for (const caseId of caseIds) {
    const target = path.join(targetRoot, caseId)
    fs.mkdirSync(target, { mode: 0o700 })
    copyFreshScaffold(controller, target)
    fs.symlinkSync(dependencyRoot, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    targets[caseId] = fs.realpathSync(target)
  }
  const manifest = { schemaVersion: 1, targets }
  fs.writeFileSync(path.join(targetRoot, 'release-targets.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return manifest
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function difference(left, right) {
  const rightSet = new Set(right)
  return sortedUnique(left.filter((value) => !rightSet.has(value)))
}

function duplicates(values) {
  const seen = new Set()
  const repeated = new Set()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated].sort()
}

function resolveCaseSelector(selector, allCaseIds) {
  if (selector === 'all') return [...allCaseIds]
  return Array.isArray(selector) ? [...selector] : []
}

function addCoverageViolation(violations, label, ids) {
  if (ids.length) violations.push(`${label}: ${ids.join(', ')}`)
}

function validTargetsManifest(targetsManifest) {
  return targetsManifest?.schemaVersion === 1 && targetsManifest?.targets && typeof targetsManifest.targets === 'object' && !Array.isArray(targetsManifest.targets)
}

export function generatedTestExecutionContract(entry) {
  const cliPackage = entry.runner === 'jest' ? 'jest' : '@playwright/test'
  const argv = entry.runner === 'jest'
    ? ['<resolved-cli>', '--config', 'jest.config.cjs', '--runInBand', '--runTestsByPath', entry.artifact, '--cacheDirectory', '<isolated-temp>/jest-cache', '--json', '--outputFile', '<isolated-temp>/jest-results.json']
    : ['<resolved-cli>', 'test', '--config', '.ai/qa/tests/playwright.config.ts', entry.artifact, '--retries=0', '--workers=1', '--forbid-only', '--reporter=json', '--output', '<isolated-temp>/playwright-output', '--update-snapshots=none']
  return { executor: 'node', cliPackage, argv, command: ['node', ...argv].join(' ') }
}

function readGeneratedTestReport(file, tempRoot, label) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 8 * 1024 * 1024
    || !isPathInside(fs.realpathSync(tempRoot), fs.realpathSync(file))) {
    throw new Error(`${label} report must be a bounded regular file in the isolated output root`)
  }
  return readJson(file)
}

function collectPlaywrightTests(suites, output = []) {
  for (const suite of Array.isArray(suites) ? suites : []) {
    for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
      for (const test of Array.isArray(spec?.tests) ? spec.tests : []) output.push(test)
    }
    collectPlaywrightTests(suite?.suites, output)
  }
  return output
}

function generatedTestCounts(testRunner, tempRoot) {
  if (testRunner === 'jest') {
    const report = readGeneratedTestReport(path.join(tempRoot, 'jest-results.json'), tempRoot, 'Jest')
    const counts = {
      passedTests: Number(report.numPassedTests ?? 0),
      skippedTests: Number(report.numPendingTests ?? 0),
      todoTests: Number(report.numTodoTests ?? 0),
      expectedFailureTests: 0,
    }
    const assertions = (Array.isArray(report.testResults) ? report.testResults : [])
      .flatMap((suite) => Array.isArray(suite?.assertionResults) ? suite.assertionResults : [])
    if (report.success !== true || Number(report.numFailedTests ?? 0) !== 0 || counts.passedTests < 1
      || counts.skippedTests !== 0 || counts.todoTests !== 0
      || assertions.some((assertion) => assertion?.status !== 'passed')) {
      throw new Error('generated Jest report must contain at least one passing test and zero failed, skipped, todo, or expected-failure tests')
    }
    return counts
  }
  const report = readGeneratedTestReport(path.join(tempRoot, 'playwright-results.json'), tempRoot, 'Playwright')
  const tests = collectPlaywrightTests(report.suites)
  const skippedTests = tests.filter((test) => test?.expectedStatus === 'skipped' || test?.status === 'skipped').length
  const expectedFailureTests = tests.filter((test) => !['passed', 'skipped'].includes(test?.expectedStatus)).length
  const passedTests = tests.filter((test) => test?.expectedStatus === 'passed' && test?.status === 'expected'
    && Array.isArray(test.results) && test.results.length > 0 && test.results.every((result) => result?.status === 'passed')).length
  const counts = { passedTests, skippedTests, todoTests: 0, expectedFailureTests }
  if (tests.length < 1 || passedTests !== tests.length || skippedTests !== 0 || expectedFailureTests !== 0
    || Number(report?.stats?.skipped ?? 0) !== 0 || Number(report?.stats?.unexpected ?? 0) !== 0
    || Number(report?.stats?.flaky ?? 0) !== 0 || (Array.isArray(report?.errors) && report.errors.length > 0)) {
    throw new Error('generated Playwright report must contain at least one passing test and zero skipped, focused, flaky, unexpected, or expected-failure tests')
  }
  return counts
}

function resolveTargetTestCli(target, runner) {
  const dependencyRoot = fs.realpathSync(path.join(target, 'node_modules'))
  const requireFromTarget = createRequire(path.join(target, 'package.json'))
  const cli = runner === 'jest'
    ? path.join(path.dirname(requireFromTarget.resolve('jest/package.json')), 'bin', 'jest.js')
    : requireFromTarget.resolve('@playwright/test/cli')
  const realCli = fs.realpathSync(cli)
  const stat = fs.lstatSync(cli)
  if (!isPathInside(dependencyRoot, realCli) || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${runner} CLI must be a regular file in the protected target dependency tree`)
  }
  return realCli
}

function resolveBrowserRuntime(target, isolatedCache) {
  const dependencyRoot = fs.realpathSync(path.join(target, 'node_modules'))
  const requireFromTarget = createRequire(path.join(target, 'package.json'))
  const playwrightCoreEntry = fs.realpathSync(requireFromTarget.resolve('playwright-core'))
  if (!isPathInside(dependencyRoot, playwrightCoreEntry)) throw new Error('playwright-core must resolve from the protected target dependency tree')
  let playwrightCoreRoot = path.dirname(playwrightCoreEntry)
  while (path.dirname(playwrightCoreRoot) !== playwrightCoreRoot && path.basename(playwrightCoreRoot) !== 'playwright-core') playwrightCoreRoot = path.dirname(playwrightCoreRoot)
  const browsersFile = path.join(playwrightCoreRoot, 'browsers.json')
  const browsersStat = fs.lstatSync(browsersFile)
  if (!browsersStat.isFile() || browsersStat.isSymbolicLink() || browsersStat.size > 262_144) throw new Error('playwright-core browsers.json is unsafe')
  const browserDeclaration = readJson(browsersFile)?.browsers?.find((entry) => entry.name === 'chromium-headless-shell')
  if (!/^[0-9]+$/.test(browserDeclaration?.revision ?? '')) throw new Error('Playwright does not declare a bounded Chromium headless-shell revision')
  const chromiumExecutable = requireFromTarget('@playwright/test').chromium.executablePath()
  let chromiumRoot = path.dirname(fs.realpathSync(chromiumExecutable))
  while (path.dirname(chromiumRoot) !== chromiumRoot && !/^chromium-[0-9]+$/.test(path.basename(chromiumRoot))) chromiumRoot = path.dirname(chromiumRoot)
  if (!/^chromium-[0-9]+$/.test(path.basename(chromiumRoot))) throw new Error('the Playwright browser cache root could not be bounded')
  const browserRoot = path.join(path.dirname(chromiumRoot), `chromium_headless_shell-${browserDeclaration.revision}`)
  const browserStat = fs.lstatSync(browserRoot)
  if (!browserStat.isDirectory() || browserStat.isSymbolicLink()) throw new Error('the exact Playwright Chromium headless-shell runtime is unavailable')
  const marker = path.join(browserRoot, 'INSTALLATION_COMPLETE')
  if (!fs.lstatSync(marker).isFile()) throw new Error('the Playwright Chromium headless-shell runtime is incomplete')
  const executableNames = new Set(process.platform === 'win32' ? ['headless_shell.exe'] : ['chrome-headless-shell', 'headless_shell'])
  const executables = []
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const child = path.join(directory, name)
      const entry = fs.lstatSync(child)
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('the Playwright Chromium headless-shell runtime contains an unsafe entry')
      if (entry.isDirectory()) visit(child)
      else if (executableNames.has(name)) executables.push(child)
    }
  }
  visit(browserRoot)
  if (executables.length !== 1) throw new Error('the Playwright Chromium headless-shell executable could not be identified exactly')
  const cacheLink = path.join(isolatedCache, path.basename(browserRoot))
  fs.symlinkSync(browserRoot, cacheLink, process.platform === 'win32' ? 'junction' : 'dir')
  return { browserRoot: fs.realpathSync(browserRoot), isolatedCache, executable: fs.realpathSync(executables[0]) }
}

export function buildReleasePlan({ cases, registry, releaseMatrix, fixtures, seeds, targetsManifest, root, primaryRunner, portabilityRunner, targetsMayNotExist = false }) {
  const allCaseIds = cases.map((item) => item.id)
  const writableCases = cases.filter((item) => WRITABLE_KINDS.has(item.evaluationKind))
  const writableCaseIds = writableCases.map((item) => item.id)
  const reviewEligibleCaseIds = [...writableCaseIds]
  const violations = []
  const release = releaseMatrix?.releaseSuite ?? {}
  const deterministicIds = resolveCaseSelector(releaseMatrix?.deterministic?.caseIds, allCaseIds)
  const deterministicMissingCaseIds = difference(allCaseIds, deterministicIds)
  const deterministicUnexpectedCaseIds = difference(deterministicIds, allCaseIds)
  addCoverageViolation(violations, 'deterministic matrix is missing cases', deterministicMissingCaseIds)
  addCoverageViolation(violations, 'deterministic matrix contains unknown cases', deterministicUnexpectedCaseIds)
  if (releaseMatrix?.deterministic?.caseIds !== 'all') violations.push('deterministic matrix must use the exact all-cases selector')

  const supportedRunners = Array.isArray(release.supportedRunners) ? release.supportedRunners : []
  if (JSON.stringify(supportedRunners) !== JSON.stringify(RELEASE_SUPPORTED_RUNNERS)) {
    violations.push(`release supported runners must be exactly: ${RELEASE_SUPPORTED_RUNNERS.join(', ')}`)
  }
  if (!RUNNERS.has(primaryRunner)) violations.push('release requires one valid primary runner')
  if (portabilityRunner !== undefined && !RUNNERS.has(portabilityRunner)) violations.push('release portability runner is invalid')
  if (portabilityRunner !== undefined && portabilityRunner === primaryRunner) violations.push('release portability runner must differ from the primary runner')
  const configuredRunnerNames = Object.keys(releaseMatrix?.routing?.runners ?? {})
  if (JSON.stringify(configuredRunnerNames) !== JSON.stringify(RELEASE_SUPPORTED_RUNNERS)) {
    violations.push(`routing matrix must configure exactly: ${RELEASE_SUPPORTED_RUNNERS.join(', ')}`)
  }
  for (const runner of RELEASE_SUPPORTED_RUNNERS) {
    if (!validModelSelector(releaseMatrix?.routing?.runners?.[runner]?.modelSelector)) violations.push(`routing matrix lacks a valid bounded ${runner} model selector`)
  }
  const requiredCaseIds = resolveCaseSelector(releaseMatrix?.routing?.required?.caseIds, allCaseIds)
  const requiredUnknownCaseIds = difference(requiredCaseIds, allCaseIds)
  addCoverageViolation(violations, 'primary routing matrix contains unknown cases', requiredUnknownCaseIds)
  if (releaseMatrix?.routing?.required?.caseIds !== 'all') violations.push('primary routing matrix must use the exact all-cases selector')
  const portabilityCaseIds = resolveCaseSelector(releaseMatrix?.routing?.portability?.caseIds, allCaseIds)
  const portabilityUnknownCaseIds = difference(portabilityCaseIds, allCaseIds)
  addCoverageViolation(violations, 'portability routing matrix contains unknown cases', portabilityUnknownCaseIds)
  if (JSON.stringify(portabilityCaseIds) !== JSON.stringify(writableCaseIds)) {
    violations.push('portability routing matrix must match the exact writable case set in catalog order')
  }
  const routing = []
  if (RUNNERS.has(primaryRunner)) routing.push({ lane: 'primary', runner: primaryRunner, expectedCaseIds: requiredCaseIds, unknownCaseIds: requiredUnknownCaseIds })
  if (RUNNERS.has(portabilityRunner) && portabilityRunner !== primaryRunner) {
    routing.push({ lane: 'portability', runner: portabilityRunner, expectedCaseIds: portabilityCaseIds, unknownCaseIds: portabilityUnknownCaseIds })
  }

  const writableEntries = Array.isArray(releaseMatrix?.writable) ? releaseMatrix.writable : []
  const assignedWritableIds = writableEntries.map((entry) => entry?.caseId)
  const missingWritableMatrixCaseIds = difference(writableCaseIds, assignedWritableIds)
  const unexpectedWritableMatrixCaseIds = difference(assignedWritableIds, writableCaseIds)
  const duplicateWritableMatrixCaseIds = duplicates(assignedWritableIds)
  addCoverageViolation(violations, 'writable release matrix is missing cases', missingWritableMatrixCaseIds)
  addCoverageViolation(violations, 'writable release matrix contains non-writable cases', unexpectedWritableMatrixCaseIds)
  addCoverageViolation(violations, 'writable release matrix contains duplicate cases', duplicateWritableMatrixCaseIds)
  for (const entry of writableEntries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 1 || typeof entry.caseId !== 'string') violations.push(`writable release assignment must be runner-neutral: ${String(entry?.caseId)}`)
  }

  const configuredReviewIds = Array.isArray(releaseMatrix?.generativeJudge?.caseIds)
    ? releaseMatrix.generativeJudge.caseIds
    : []
  const missingReviewMatrixCaseIds = difference(reviewEligibleCaseIds, configuredReviewIds)
  const unexpectedReviewMatrixCaseIds = difference(configuredReviewIds, reviewEligibleCaseIds)
  const duplicateReviewMatrixCaseIds = duplicates(configuredReviewIds)
  addCoverageViolation(violations, 'generated-code review matrix is missing eligible cases', missingReviewMatrixCaseIds)
  addCoverageViolation(violations, 'generated-code review matrix contains ineligible cases', unexpectedReviewMatrixCaseIds)
  addCoverageViolation(violations, 'generated-code review matrix contains duplicate cases', duplicateReviewMatrixCaseIds)
  if (JSON.stringify(configuredReviewIds) !== JSON.stringify(reviewEligibleCaseIds)) {
    violations.push('generated-code review matrix must list every writable case exactly once in catalog order')
  }
  if (release.requireGenerativeJudge !== true) violations.push('release suite must require the generative judge')
  if (release.requireGeneratedCodeReview !== true) violations.push('release suite must retain generated-code review compatibility')
  if (releaseMatrix?.generativeJudge?.skill !== 'om-judge-agent-session') violations.push('generative judge must explicitly use om-judge-agent-session')
  if (releaseMatrix?.generativeJudge?.reviewSkill !== 'om-code-review') violations.push('generative judge must explicitly compose om-code-review')
  if (releaseMatrix?.generativeJudge?.required !== true) violations.push('generative judge must be mandatory for every writable case')
  if (releaseMatrix?.generatedCodeReview?.skill !== 'om-code-review'
    || JSON.stringify(releaseMatrix.generatedCodeReview?.caseIds) !== JSON.stringify(configuredReviewIds)
    || JSON.stringify(releaseMatrix.generatedCodeReview?.runners) !== JSON.stringify(releaseMatrix.generativeJudge?.runners)) {
    violations.push('generated-code review compatibility matrix must match the generative judge')
  }
  const reviewRunners = releaseMatrix?.generativeJudge?.runners ?? {}
  for (const runner of RELEASE_SUPPORTED_RUNNERS) {
    if (!validModelSelector(reviewRunners?.[runner]?.modelSelector)) violations.push(`generated-code review lacks a valid bounded ${runner} model selector`)
  }
  for (const runner of Object.keys(reviewRunners)) {
    if (!RUNNERS.has(runner)) violations.push(`generated-code review declares an invalid runner: ${runner}`)
  }
  const reviewSkillFiles = [
    '.ai/skills/om-judge-agent-session/SKILL.md',
    '.ai/skills/om-judge-agent-session/references/agentic-setup.md',
    '.ai/skills/om-judge-agent-session/references/input-normalization.md',
    '.ai/skills/om-judge-agent-session/references/judge-workflow.md',
    '.ai/skills/om-judge-agent-session/references/report-template.md',
    '.ai/skills/om-judge-agent-session/references/rules.md',
    '.agents/skills/om-code-review/SKILL.md',
    '.agents/skills/om-code-review/references/agentic-setup.md',
    '.agents/skills/om-code-review/references/output-format.md',
    '.agents/skills/om-code-review/references/review-checklist.md',
    '.agents/skills/om-code-review/references/rules.md',
    '.agents/skills/.om-external-ownership.json',
  ]
  const reviewSkillReady = !root || reviewSkillFiles.every((relative) => fs.existsSync(path.join(root, relative)))
  if (!reviewSkillReady) violations.push('generative judge or code-review skill is not installed with ownership evidence')

  const registryCaseCountMatches = registry?.catalog?.expectedCaseCount === cases.length
  if (!registryCaseCountMatches) violations.push(`validator registry expects ${String(registry?.catalog?.expectedCaseCount)} cases but catalog contains ${cases.length}`)
  const registryWritableIds = Array.isArray(registry?.catalog?.writableCaseIds) ? registry.catalog.writableCaseIds : []
  const registryMissingWritableCaseIds = difference(writableCaseIds, registryWritableIds)
  const registryUnexpectedWritableCaseIds = difference(registryWritableIds, writableCaseIds)
  addCoverageViolation(violations, 'validator registry is missing writable cases', registryMissingWritableCaseIds)
  addCoverageViolation(violations, 'validator registry contains non-writable cases', registryUnexpectedWritableCaseIds)

  const missingFixtureCaseIds = []
  const missingOracleCaseIds = []
  for (const item of writableCases) {
    const setupEntries = Array.isArray(item.fixture?.setup) ? item.fixture.setup : []
    const setupIds = setupEntries
      .filter((entry) => typeof entry === 'string' && /^fixture:[a-z0-9-]+$/.test(entry))
      .map((entry) => entry.slice('fixture:'.length))
    const fixtureComplete = item.fixture?.scaffold === 'fresh-standalone'
      && setupIds.length > 0
      && setupIds.length === setupEntries.length
      && setupIds.every((id) => fixtures?.fixtures?.[id] && seeds?.fixtures?.[id])
    if (!fixtureComplete) missingFixtureCaseIds.push(item.id)
    const oracleIds = Array.isArray(item.oracle?.validatorIds) ? item.oracle.validatorIds : []
    const oracleComplete = oracleIds.some((id) => {
      const declaration = registry?.validators?.[id]
      return declaration?.implementation === 'trusted-executable' && Array.isArray(declaration.runners) && declaration.runners.length > 0
    }) && Array.isArray(item.oracle?.expectedArtifacts) && item.oracle.expectedArtifacts.length > 0
    if (!oracleComplete) missingOracleCaseIds.push(item.id)
  }
  addCoverageViolation(violations, 'writable cases lack complete fixture coverage', missingFixtureCaseIds)
  addCoverageViolation(violations, 'writable cases lack trusted oracle coverage', missingOracleCaseIds)

  const targetEntries = validTargetsManifest(targetsManifest) ? targetsManifest.targets : {}
  if (!validTargetsManifest(targetsManifest)) violations.push('writable target manifest must use schemaVersion 1 and a targets object')
  const targetIds = Object.keys(targetEntries)
  const missingTargetCaseIds = writableCaseIds.filter((id) => typeof targetEntries[id] !== 'string' || !path.isAbsolute(targetEntries[id]))
  const unexpectedTargetCaseIds = difference(targetIds, writableCaseIds)
  const duplicateTargetCaseIds = []
  const invalidTargetCaseIds = []
  const targetOwners = new Map()
  const controllerRoot = root ? fs.realpathSync(root) : undefined
  for (const id of writableCaseIds) {
    const target = targetEntries[id]
    if (typeof target !== 'string' || !path.isAbsolute(target)) continue
    let normalized = path.resolve(target)
    if (root && !targetsMayNotExist) {
      try {
        const stat = fs.lstatSync(target)
        normalized = fs.realpathSync(target)
        const required = ['package.json', 'src/modules.ts', '.ai/harness/cases.json']
        const requiredAreSafe = required.every((relative) => {
          const absolute = path.join(normalized, relative)
          try {
            const entry = fs.lstatSync(absolute)
            return entry.isFile() && !entry.isSymbolicLink() && isPathInside(normalized, fs.realpathSync(absolute))
          } catch { return false }
        })
        const dependencyPath = path.join(normalized, 'node_modules')
        let dependenciesAreSafe = false
        try {
          const dependencyEntry = fs.lstatSync(dependencyPath)
          dependenciesAreSafe = dependencyEntry.isSymbolicLink()
            && fs.statSync(dependencyPath).isDirectory()
            && root
            && fs.realpathSync(dependencyPath) === fs.realpathSync(path.join(root, 'node_modules'))
        } catch { /* invalid target below */ }
        if (!stat.isDirectory() || stat.isSymbolicLink() || normalized === root
          || !requiredAreSafe || !dependenciesAreSafe
          || fs.existsSync(path.join(normalized, '.ai', 'harness', 'DISPOSABLE'))) invalidTargetCaseIds.push(id)
      } catch { invalidTargetCaseIds.push(id) }
    }
    if (controllerRoot && (isPathInside(controllerRoot, normalized) || isPathInside(normalized, controllerRoot))) invalidTargetCaseIds.push(id)
    for (const [ownedRoot, ownerId] of targetOwners) {
      if (isPathInside(ownedRoot, normalized) || isPathInside(normalized, ownedRoot)) duplicateTargetCaseIds.push(id, ownerId)
    }
    targetOwners.set(normalized, id)
  }
  addCoverageViolation(violations, 'writable target manifest is missing absolute targets', sortedUnique(missingTargetCaseIds))
  addCoverageViolation(violations, 'writable target manifest contains unknown cases', unexpectedTargetCaseIds)
  addCoverageViolation(violations, 'writable target manifest reuses targets', sortedUnique(duplicateTargetCaseIds))
  addCoverageViolation(violations, 'writable target manifest contains invalid or reused app roots', sortedUnique(invalidTargetCaseIds))

  const validationCommands = Array.isArray(release.validationCommands) ? release.validationCommands : []
  if (validationCommands.length === 0) violations.push('release suite must declare validation commands')
  for (const command of validationCommands) {
    if (!ALLOWED_VALIDATION_COMMANDS.has(command)) violations.push(`release validation command is not allowed: ${String(command)}`)
  }
  const missingValidationCommands = difference([...ALLOWED_VALIDATION_COMMANDS], validationCommands)
  addCoverageViolation(violations, 'release suite is missing validation commands', missingValidationCommands)
  if (JSON.stringify(validationCommands) !== JSON.stringify(RELEASE_VALIDATION_COMMANDS)) {
    violations.push('release validation commands must be the exact ordered four-command gate')
  }

  const generatedTestCases = writableCases.filter((item) => item.tags?.some((tag) => ['unit-tests', 'api-tests', 'browser-tests'].includes(tag)))
  const expectedGeneratedTestIds = generatedTestCases.map((item) => item.id)
  const generatedTestEntries = Array.isArray(releaseMatrix?.generatedTests?.entries) ? releaseMatrix.generatedTests.entries : []
  const configuredGeneratedTestIds = generatedTestEntries.map((entry) => entry.caseId)
  const missingGeneratedTestIds = difference(expectedGeneratedTestIds, configuredGeneratedTestIds)
  const unexpectedGeneratedTestIds = difference(configuredGeneratedTestIds, expectedGeneratedTestIds)
  const duplicateGeneratedTestIds = duplicates(configuredGeneratedTestIds)
  if (releaseMatrix?.generatedTests?.required !== true) violations.push('generated test execution must be required')
  addCoverageViolation(violations, 'generated test execution matrix is missing cases', missingGeneratedTestIds)
  addCoverageViolation(violations, 'generated test execution matrix contains ineligible cases', unexpectedGeneratedTestIds)
  addCoverageViolation(violations, 'generated test execution matrix contains duplicate cases', duplicateGeneratedTestIds)
  for (const entry of generatedTestEntries) {
    const item = generatedTestCases.find((candidate) => candidate.id === entry.caseId)
    const expectedRunner = item?.tags?.includes('unit-tests') ? 'jest'
      : item?.tags?.includes('api-tests') ? 'playwright-api'
        : item?.tags?.includes('browser-tests') ? 'playwright-browser' : undefined
    const expectedNetwork = expectedRunner === 'jest' ? 'none' : 'loopback'
    const canonicalPath = expectedRunner === 'jest'
      ? /^src\/modules\/[a-z0-9_]+\/(?:[^/]+\/)*__tests__\/[A-Za-z0-9._-]+\.(?:test|spec)\.tsx?$/
      : /^src\/modules\/[a-z0-9_]+\/(?:[^/]+\/)*__integration__\/[A-Za-z0-9._-]+\.spec\.tsx?$/
    if (!item || !GENERATED_TEST_RUNNERS.has(entry.runner) || entry.runner !== expectedRunner
      || entry.network !== expectedNetwork || typeof entry.artifact !== 'string'
      || !canonicalPath.test(entry.artifact) || !item.oracle?.expectedArtifacts?.includes(entry.artifact)
      || !item.allowedWrites?.includes(entry.artifact)) {
      violations.push(`generated test execution assignment is invalid: ${String(entry.caseId)}`)
    }
  }

  const steps = [
    { id: 'deterministic:all', kind: 'deterministic', expectedCaseIds: deterministicIds },
    ...validationCommands.map((command) => ({ id: `validation:${command.slice('yarn '.length)}`, kind: 'validation', command })),
    ...routing.map((entry) => ({ id: `routing:${entry.lane}:${entry.runner}`, kind: 'routing', lane: entry.lane, runner: entry.runner, modelSelector: releaseMatrix.routing.runners[entry.runner].modelSelector, expectedCaseIds: entry.expectedCaseIds })),
  ]
  for (const caseId of writableCaseIds) {
    const assignment = writableEntries.find((entry) => entry?.caseId === caseId)
    if (!assignment || !RUNNERS.has(primaryRunner)) continue
    steps.push({ id: `fixture:${caseId}`, kind: 'fixture', caseId })
    steps.push({ id: `writable:${caseId}`, kind: 'writable', caseId, runner: primaryRunner, modelSelector: releaseMatrix.routing.runners[primaryRunner].modelSelector })
    for (const command of validationCommands) {
      steps.push({ id: `target-validation:${caseId}:${command.slice('yarn '.length)}`, kind: 'target-validation', caseId, command })
    }
    const generatedTest = generatedTestEntries.find((entry) => entry.caseId === caseId)
    if (generatedTest) {
      const executionContract = generatedTestExecutionContract(generatedTest)
      steps.push({
        id: `generated-test:${caseId}:${generatedTest.runner}`,
        kind: 'generated-test',
        caseId,
        testRunner: generatedTest.runner,
        artifact: generatedTest.artifact,
        network: generatedTest.network,
        ...executionContract,
      })
    }
    if (configuredReviewIds.includes(caseId)) {
      const modelSelector = releaseMatrix.generativeJudge?.runners?.[primaryRunner]?.modelSelector
      if (!validModelSelector(modelSelector)) violations.push(`generative judge lacks a valid bounded ${primaryRunner} model selector for ${caseId}`)
      steps.push({ id: `review:${caseId}`, kind: 'review', caseId, runner: primaryRunner, modelSelector })
    }
  }

  return {
    runnerPolicy: { primaryRunner: RUNNERS.has(primaryRunner) ? primaryRunner : null, portabilityRunner: RUNNERS.has(portabilityRunner) ? portabilityRunner : null },
    catalog: {
      caseCount: cases.length,
      writableCaseCount: writableCaseIds.length,
      reviewEligibleCaseCount: reviewEligibleCaseIds.length,
    },
    coverage: {
      deterministic: { expectedCaseIds: allCaseIds, configuredCaseIds: deterministicIds, missingMatrixCaseIds: deterministicMissingCaseIds, unexpectedMatrixCaseIds: deterministicUnexpectedCaseIds },
      routing,
      writable: {
        expectedCaseIds: writableCaseIds,
        configuredCaseIds: assignedWritableIds,
        missingMatrixCaseIds: missingWritableMatrixCaseIds,
        unexpectedMatrixCaseIds: unexpectedWritableMatrixCaseIds,
        duplicateMatrixCaseIds: duplicateWritableMatrixCaseIds,
        missingTargetCaseIds: sortedUnique(missingTargetCaseIds),
        unexpectedTargetCaseIds,
        duplicateTargetCaseIds: sortedUnique(duplicateTargetCaseIds),
        invalidTargetCaseIds: sortedUnique(invalidTargetCaseIds),
        missingFixtureCaseIds: sortedUnique(missingFixtureCaseIds),
        missingOracleCaseIds: sortedUnique(missingOracleCaseIds),
      },
      review: { expectedCaseIds: reviewEligibleCaseIds, configuredCaseIds: configuredReviewIds, missingMatrixCaseIds: missingReviewMatrixCaseIds, unexpectedMatrixCaseIds: unexpectedReviewMatrixCaseIds, skillReady: reviewSkillReady },
      registry: { caseCountMatches: registryCaseCountMatches, missingWritableCaseIds: registryMissingWritableCaseIds, unexpectedWritableCaseIds: registryUnexpectedWritableCaseIds },
      validation: { expectedCommands: [...ALLOWED_VALIDATION_COMMANDS], configuredCommands: validationCommands, missingCommands: missingValidationCommands },
      targetValidation: { expectedCaseIds: writableCaseIds, commands: validationCommands },
      generatedTests: {
        expectedCaseIds: expectedGeneratedTestIds,
        configuredCaseIds: configuredGeneratedTestIds,
        missingMatrixCaseIds: missingGeneratedTestIds,
        unexpectedMatrixCaseIds: unexpectedGeneratedTestIds,
        duplicateMatrixCaseIds: duplicateGeneratedTestIds,
      },
    },
    targets: targetEntries,
    steps,
    violations: sortedUnique(violations),
  }
}

export function releaseHostPrerequisiteViolations(releaseMatrix, platform = process.platform, env = process.env) {
  const entries = Array.isArray(releaseMatrix?.generatedTests?.entries) ? releaseMatrix.generatedTests.entries : []
  const requiresLoopback = entries.some((entry) => entry?.network === 'loopback')
  const modes = ['none', ...(requiresLoopback ? ['loopback'] : [])]
  const violations = []
  for (const mode of modes) {
    try {
      assertSandboxRuntimeAvailable(mode, platform, env)
    } catch (error) {
      violations.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (platform === 'linux' && requiresLoopback && violations.length === 0) {
    try {
      verifyLinuxSandboxIsolation(env)
    } catch (error) {
      violations.push(error instanceof Error ? error.message : String(error))
    }
  }
  return [...new Set(violations)]
}

function percentage(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100
}

function percentile(values, value) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
}

function violationCategory(value) {
  const text = String(value)
  if (/forbidden|unsafe|out-of-root|outside allowlist|protected roots|inspection|modified (?:target|bundle)|trace unavailable|no observed context/i.test(text)) return 'safety'
  if (/route|skill|context|decision|pattern|budget|missing|required|unexpected|mismatch/i.test(text)) return 'contract'
  if (/process|environment|structured output|timed out|runner/i.test(text)) return 'execution'
  return 'quality'
}

export function aggregateQualityMetrics(results) {
  const contextTokens = []
  const initialContextTokens = []
  let passed = 0
  let corrections = 0
  let resultsWithCorrections = 0
  let firstPassPassed = 0
  let totalViolations = 0
  let resultsWithViolations = 0
  const violationsByCategory = { safety: 0, contract: 0, execution: 0, quality: 0 }
  const verdicts = { approve: 0, requestChanges: 0, error: 0 }
  for (const result of results) {
    if (result.status === 'pass') passed += 1
    const resultCorrections = Number.isInteger(result.corrections) ? result.corrections : Math.max(0, (result.attempts ?? 1) - 1)
    corrections += resultCorrections
    if (resultCorrections > 0) resultsWithCorrections += 1
    if (result.status === 'pass' && resultCorrections === 0) firstPassPassed += 1
    if (Number.isInteger(result.actualContext?.estimatedTokens)) contextTokens.push(result.actualContext.estimatedTokens)
    if (Number.isInteger(result.actualContext?.estimatedInitialTokens)) initialContextTokens.push(result.actualContext.estimatedInitialTokens)
    const resultViolations = Array.isArray(result.violations) ? result.violations : []
    if (resultViolations.length) resultsWithViolations += 1
    totalViolations += resultViolations.length
    for (const violation of resultViolations) violationsByCategory[violationCategory(violation)] += 1
    if (result.verdict === 'approve') verdicts.approve += 1
    else if (result.verdict === 'request changes') verdicts.requestChanges += 1
    else if (result.verdict === 'error') verdicts.error += 1
  }
  const totalContextTokens = contextTokens.reduce((sum, value) => sum + value, 0)
  const totalInitialContextTokens = initialContextTokens.reduce((sum, value) => sum + value, 0)
  return {
    outcomes: { results: results.length, passed, failed: results.length - passed },
    firstPass: { eligibleResults: results.length, passedFirstPass: firstPassPassed, ratePct: percentage(firstPassPassed, results.length) },
    corrections: { total: corrections, resultsWithCorrections, ratePct: percentage(resultsWithCorrections, results.length) },
    context: {
      measuredResults: contextTokens.length,
      totalEstimatedTokens: totalContextTokens,
      averageEstimatedTokens: contextTokens.length ? Math.round(totalContextTokens / contextTokens.length) : 0,
      p95EstimatedTokens: percentile(contextTokens, 0.95),
      maxEstimatedTokens: contextTokens.length ? Math.max(...contextTokens) : 0,
      totalEstimatedInitialTokens: totalInitialContextTokens,
      averageEstimatedInitialTokens: initialContextTokens.length ? Math.round(totalInitialContextTokens / initialContextTokens.length) : 0,
    },
    misuse: { totalViolations, resultsWithViolations, ratePct: percentage(resultsWithViolations, results.length), byCategory: violationsByCategory },
    reviewVerdicts: verdicts,
  }
}

export function sanitizeReportText(value, roots = []) {
  let result = String(value ?? '')
  for (const root of [...roots, os.homedir()].filter(Boolean).sort((left, right) => right.length - left.length)) result = result.split(root).join('<redacted-path>')
  const environmentSecrets = [...new Set(Object.entries(process.env)
    .filter(([key, entry]) => SENSITIVE_ENV_KEY.test(key) && typeof entry === 'string' && entry.length >= 4)
    .map(([, entry]) => entry))]
    .sort((left, right) => right.length - left.length)
  for (const secret of environmentSecrets) result = result.split(secret).join('<redacted-secret>')
  result = result.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1<redacted-secret>@')
  result = result.replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs]|AKIA)[-_A-Za-z0-9]{10,}\b/g, '<redacted-secret>')
  result = result.replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '<redacted-secret>')
  return result.slice(0, ERROR_LIMIT)
}

function sanitizeObject(value, roots) {
  if (typeof value === 'string') return sanitizeReportText(value, roots)
  if (Array.isArray(value)) return value.map((entry) => sanitizeObject(entry, roots))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeObject(entry, roots)]))
  return value
}

function schemaTypeMatches(value, expected) {
  if (expected === 'null') return value === null
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (expected === 'integer') return Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === expected
}

function resolveSchemaReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) throw new Error(`unsupported release schema reference ${reference}`)
  return reference.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], rootSchema)
}

function validateJsonSchema(value, schema, rootSchema = schema, location = '$') {
  if (schema.$ref) return validateJsonSchema(value, resolveSchemaReference(rootSchema, schema.$ref), rootSchema, location)
  const errors = []
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type) => schemaTypeMatches(value, type))) return [`${location} has the wrong type`]
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${location} differs from its constant`)
  if (schema.enum && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) errors.push(`${location} is outside its enum`)
  if (typeof value === 'string') {
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${location} exceeds maxLength`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} does not match its pattern`)
  }
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${location} is below minimum`)
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${location} exceeds maximum`)
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${location} exceeds maxItems`)
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) errors.push(`${location} must contain unique items`)
    if (schema.items) value.forEach((entry, index) => errors.push(...validateJsonSchema(entry, schema.items, rootSchema, `${location}[${index}]`)))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${location}.${key} is not allowed`)
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateJsonSchema(value[key], childSchema, rootSchema, `${location}.${key}`))
    }
  }
  return errors
}

function resultFiles(root) {
  const directory = path.join(root, '.ai', 'harness', 'results')
  if (!fs.existsSync(directory)) return new Set()
  return new Set(fs.readdirSync(directory).filter((file) => file.endsWith('.json')))
}

function readNewResults(root, before) {
  const directory = path.join(root, '.ai', 'harness', 'results')
  if (!fs.existsSync(directory)) return []
  const results = []
  for (const file of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json') && !before.has(entry)).sort()) {
    const absolute = path.join(directory, file)
    const stat = fs.lstatSync(absolute)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RESULT_LIMIT || file.includes('-release-')) continue
    try { results.push({ path: path.relative(root, absolute).replaceAll(path.sep, '/'), value: readJson(absolute) }) } catch { /* evaluator owns schema validation */ }
  }
  return results
}

function execute(command, args, cwd, timeout, env = process.env) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env })
  return { ...result, durationMs: Date.now() - started }
}

function protectedTreeFingerprint(target) {
  if (!fs.existsSync(target)) return '<missing>'
  const hash = createHash('sha256')
  const visit = (absolute, relative = '.') => {
    let stat
    try { stat = fs.lstatSync(absolute) } catch { hash.update(`${relative}:<unreadable>\n`); return }
    hash.update(`${relative}:${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}\n`)
    if (stat.isSymbolicLink()) {
      try { hash.update(`link:${fs.readlinkSync(absolute)}\n`) } catch { /* metadata still detects the entry */ }
      return
    }
    if (!stat.isDirectory()) return
    for (const entry of fs.readdirSync(absolute).sort()) visit(path.join(absolute, entry), relative === '.' ? entry : `${relative}/${entry}`)
  }
  visit(target)
  return hash.digest('hex')
}

export function dependencyContentFingerprint(appRoot) {
  const dependencyRoot = path.join(appRoot, 'node_modules')
  const stat = fs.lstatSync(dependencyRoot)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('controller node_modules must remain a regular directory')
  const hash = createHash('sha256')
  const ownershipFiles = ['package.json', 'yarn.lock']
  for (const relative of ownershipFiles) {
    const absolute = path.join(appRoot, relative)
    if (!fs.existsSync(absolute)) continue
    const fileStat = fs.lstatSync(absolute)
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 8 * 1024 * 1024) throw new Error(`dependency ownership file is unsafe: ${relative}`)
    hash.update(relative)
    hash.update(fs.readFileSync(absolute))
  }
  let entries = 0
  const visit = (directory, relativeDirectory = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      entries += 1
      if (entries > 500_000) throw new Error('dependency content fingerprint exceeds its 500000-entry safety bound')
      const absolute = path.join(directory, name)
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      const entry = fs.lstatSync(absolute)
      hash.update(`${relative}:${entry.mode}:${entry.size}\n`)
      if (entry.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(absolute)}\n`)
      else if (entry.isDirectory()) visit(absolute, relative)
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute))
      else throw new Error(`dependency tree contains an unsupported entry: ${relative}`)
    }
  }
  visit(dependencyRoot)
  return hash.digest('hex')
}

function targetSnapshot(root) {
  const result = new Map()
  const protectedRoots = new Set(['.git', 'node_modules', '.next', 'dist', '.ai/harness/results'])
  const visit = (directory, relativeDirectory = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      if ([...protectedRoots].some((entry) => relative === entry || relative.startsWith(`${entry}/`))) continue
      const absolute = path.join(directory, name)
      let entry
      try { entry = fs.lstatSync(absolute) } catch { result.set(relative, '<unreadable>'); continue }
      if (entry.isSymbolicLink()) {
        try { result.set(relative, `<symlink:${fs.readlinkSync(absolute)}>`) } catch { result.set(relative, '<symlink:unreadable>') }
      } else if (entry.isDirectory()) {
        result.set(relative, `<directory:${entry.mode & 0o777}>`)
        visit(absolute, relative)
      }
      else if (entry.isFile()) {
        try { result.set(relative, `<file:${entry.mode & 0o777}:${sha256(fs.readFileSync(absolute))}>`) } catch { result.set(relative, '<unreadable>') }
      } else result.set(relative, `<special:${entry.mode & 0o170000}>`)
    }
  }
  visit(root)
  for (const relative of ['.git', 'node_modules', '.next', 'dist', '.ai/harness/results']) {
    result.set(relative, protectedTreeFingerprint(path.join(root, relative)))
  }
  return result
}

function containedValidationSymlink(relative, fingerprint, command, after) {
  if (!validationOutputRoot(relative, command, after)) return false
  const target = fingerprint.slice('<symlink:'.length, -1)
  if (!target || path.isAbsolute(target)) return false
  const resolved = path.normalize(path.join(path.dirname(relative), target))
  return resolved !== '..' && !resolved.startsWith(`..${path.sep}`) && !path.isAbsolute(resolved)
}

function unsafeChangedTargetEntries(after, changed, command) {
  const protectedRoots = new Set(['.git', 'node_modules', '.next', 'dist', '.ai/harness/results'])
  return changed.flatMap((relative) => {
    if (protectedRoots.has(relative)) return []
    const fingerprint = after.get(relative)
    if (typeof fingerprint !== 'string') return []
    if (fingerprint.startsWith('<symlink:') && !containedValidationSymlink(relative, fingerprint, command, after)) return [`${relative} (symbolic link)`]
    if (fingerprint.startsWith('<special:')) return [`${relative} (special file)`]
    if (fingerprint === '<unreadable>') return [`${relative} (unreadable)`]
    return []
  })
}

function targetSnapshotFingerprint(snapshot) {
  const hash = createHash('sha256')
  for (const [relative, fingerprint] of [...snapshot.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(relative)
    hash.update('\0')
    hash.update(fingerprint)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function targetContentFingerprint(root) {
  return targetSnapshotFingerprint(targetSnapshot(root))
}

function stepResult(step, execution, artifacts, roots, expectedArtifacts) {
  const artifactMismatch = Number.isInteger(expectedArtifacts) && artifacts.length !== expectedArtifacts
  const status = execution.status === 0 && !execution.error && !artifactMismatch ? 'pass' : 'fail'
  const diagnostic = artifactMismatch
    ? `expected ${expectedArtifacts} result artifacts, found ${artifacts.length}`
    : execution.error?.message || (status === 'fail'
        ? [execution.stderr, execution.stdout].filter(Boolean).join('\n')
        : execution.stderr)
  return {
    id: step.id,
    kind: step.kind,
    ...(step.caseId ? { caseId: step.caseId } : {}),
    ...(step.runner ? { runner: step.runner } : {}),
    ...(step.testRunner ? { testRunner: step.testRunner } : {}),
    ...(step.artifact ? { artifact: step.artifact } : {}),
    ...(step.network ? { network: step.network } : {}),
    ...(step.executor ? { executor: step.executor } : {}),
    ...(step.cliPackage ? { cliPackage: step.cliPackage } : {}),
    ...(step.cliSha256 ? { cliSha256: step.cliSha256 } : {}),
    ...(step.argv ? { argv: step.argv } : {}),
    ...(step.command ? { command: step.command } : {}),
    status,
    exitStatus: execution.status,
    durationMs: execution.durationMs,
    resultPaths: artifacts.map((entry) => entry.path),
    ...(diagnostic ? { sanitizedError: sanitizeReportText(diagnostic, roots) } : {}),
  }
}

function skippedStep(step, reason) {
  return {
    id: step.id,
    kind: step.kind,
    ...(step.caseId ? { caseId: step.caseId } : {}),
    ...(step.runner ? { runner: step.runner } : {}),
    ...(step.testRunner ? { testRunner: step.testRunner } : {}),
    ...(step.artifact ? { artifact: step.artifact } : {}),
    ...(step.network ? { network: step.network } : {}),
    ...(step.executor ? { executor: step.executor } : {}),
    ...(step.cliPackage ? { cliPackage: step.cliPackage } : {}),
    ...(step.cliSha256 ? { cliSha256: step.cliSha256 } : {}),
    ...(step.argv ? { argv: step.argv } : {}),
    ...(step.command ? { command: step.command } : {}),
    status: 'skipped',
    exitStatus: null,
    durationMs: 0,
    resultPaths: [],
    sanitizedError: reason,
  }
}

export function createMinimalValidationEnvironment(tempRoot, pathValue = process.env.PATH ?? '') {
  const home = path.join(tempRoot, 'home')
  const temporary = path.join(tempRoot, 'tmp')
  const cache = path.join(tempRoot, 'cache')
  for (const directory of [home, temporary, cache]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const env = {
    PATH: pathValue,
    HOME: home,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    CI: '1',
    NO_COLOR: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    YARN_ENABLE_TELEMETRY: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    TZ: 'UTC',
    __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0',
  }
  const configuredCorepackHome = process.env.COREPACK_HOME || path.join(os.homedir(), '.cache', 'node', 'corepack')
  const corepackHome = fs.existsSync(configuredCorepackHome) && fs.statSync(configuredCorepackHome).isDirectory()
    ? fs.realpathSync(configuredCorepackHome)
    : undefined
  if (corepackHome) env.COREPACK_HOME = corepackHome
  for (const key of ['SystemRoot', 'WINDIR', 'PATHEXT', 'ComSpec']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key]
  }
  return { env, toolReadRoots: corepackHome ? [corepackHome] : [] }
}

function validationOutputRoot(relative, command, after) {
  if (
    relative === '.env'
    && (command === 'yarn generate' || command === 'yarn build')
    && after.get('.env') === after.get('.env.example')
  ) return '.env'
  return (RELEASE_VALIDATION_OUTPUT_ROOTS.get(command) ?? []).find((root) => relative === root
    || relative.startsWith(`${root}/`)
    || (root.startsWith(`${relative}/`) && after.get(relative)?.startsWith('<directory:')))
}

function cloneValidationDependencies(source, destination) {
  const sourceRoot = fs.realpathSync(source)
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name)
      const entry = fs.lstatSync(absolute)
      if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync(absolute)
        if (resolved !== sourceRoot && !isPathInside(sourceRoot, resolved)) {
          throw new Error(`dependency tree contains an escaping symbolic link: ${path.relative(sourceRoot, absolute)}`)
        }
      } else if (entry.isDirectory()) visit(absolute)
      else if (!entry.isFile()) throw new Error(`dependency tree contains an unsupported entry: ${path.relative(sourceRoot, absolute)}`)
    }
  }
  visit(sourceRoot)
  fs.cpSync(sourceRoot, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    mode: fs.constants.COPYFILE_FICLONE,
  })
}

function prepareValidationWorkspace(target, tempRoot, { allowContainedDependencies = false } = {}) {
  validateScaffoldCopySource(target)
  const workspace = path.join(tempRoot, 'target')
  copyFreshScaffold(target, workspace)
  const dependencyPath = path.join(target, 'node_modules')
  let dependencyRoot
  if (fs.existsSync(dependencyPath)) {
    const sourceDependencyRoot = fs.realpathSync(dependencyPath)
    if (!allowContainedDependencies && isPathInside(fs.realpathSync(target), sourceDependencyRoot)) {
      throw new Error('writable target node_modules must resolve outside the writable target')
    }
    cloneValidationDependencies(sourceDependencyRoot, path.join(workspace, 'node_modules'))
    dependencyRoot = fs.realpathSync(path.join(workspace, 'node_modules'))
  }
  return { workspace: fs.realpathSync(workspace), dependencyRoot }
}

export function runTargetValidationSteps({ steps, target, timeout, roots, yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn', pathValue, allowContainedDependencies = false }) {
  const results = []
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-validation-'))
  const reportRoots = [...roots, tempRoot, fs.realpathSync(tempRoot)]
  const { env, toolReadRoots } = createMinimalValidationEnvironment(tempRoot, pathValue)
  const originalFingerprint = targetContentFingerprint(target)
  let workspace
  let dependencyRoot
  let workspaceError
  try {
    ({ workspace, dependencyRoot } = prepareValidationWorkspace(target, tempRoot, { allowContainedDependencies }))
  } catch (error) {
    workspaceError = error
  }
  let before = workspace ? targetSnapshot(workspace) : new Map()
  let workspaceTainted = false
  try {
    for (const step of steps) {
      if (workspaceTainted) {
        results.push(skippedStep(step, 'validation workspace was tainted by an out-of-contract mutation'))
        continue
      }
      let execution
      if (workspaceError) {
        execution = { status: null, error: workspaceError, stdout: '', stderr: '', durationMs: 0 }
      } else try {
        const readOnlyRoots = [...toolReadRoots]
        if (dependencyRoot) readOnlyRoots.unshift(dependencyRoot)
        const invocation = sandboxedInvocation({
          command: yarnCommand,
          args: [step.command.slice('yarn '.length)],
          cwd: workspace,
          writableRoots: [workspace, tempRoot],
          readOnlyRoots,
          networkMode: 'none',
          env,
        })
        execution = execute(invocation.command, invocation.args, invocation.cwd, timeout, invocation.env)
      } catch (error) {
        execution = { status: null, error, stdout: '', stderr: '', durationMs: 0 }
      }
      const after = workspace ? targetSnapshot(workspace) : before
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).sort()
      const unsafeEntries = unsafeChangedTargetEntries(after, changed, step.command)
      const disallowedEntries = changed.filter((relative) => !validationOutputRoot(relative, step.command, after))
      const touchedOutputRoots = [...new Set(changed.map((relative) => validationOutputRoot(relative, step.command, after)).filter(Boolean))].sort()
      const result = stepResult(step, execution, [], reportRoots)
      result.resultPaths = touchedOutputRoots
      if (disallowedEntries.length || unsafeEntries.length) {
        result.status = 'fail'
        const diagnostics = [
          ...(disallowedEntries.length ? [`validation mutated paths outside explicit command outputs: ${disallowedEntries.join(', ')}`] : []),
          ...(unsafeEntries.length ? [`validation created unsafe filesystem entries: ${unsafeEntries.join(', ')}`] : []),
        ]
        result.sanitizedError = sanitizeReportText(diagnostics.join('; '), reportRoots)
        workspaceTainted = true
      }
      if (targetContentFingerprint(target) !== originalFingerprint) {
        result.status = 'fail'
        result.sanitizedError = sanitizeReportText('original writable target changed during isolated validation', roots)
        workspaceTainted = true
      }
      results.push(result)
      before = after
    }
    return results
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

export function runGeneratedTestStep({ step, target, timeout, roots, browserRuntimeResolver = resolveBrowserRuntime }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-generated-test-'))
  const { env, toolReadRoots } = createMinimalValidationEnvironment(tempRoot)
  const dependencyPath = path.join(target, 'node_modules')
  const readOnlyRoots = [fs.realpathSync(target), ...(fs.existsSync(dependencyPath) ? [fs.realpathSync(dependencyPath)] : []), ...toolReadRoots]
  let execution
  let before
  let cli
  let testCounts
  try {
    const artifact = path.resolve(target, step.artifact)
    const artifactStat = fs.lstatSync(artifact)
    if (!isPathInside(fs.realpathSync(target), fs.realpathSync(artifact)) || !artifactStat.isFile() || artifactStat.isSymbolicLink()) {
      throw new Error('generated test artifact must be a regular file inside the target')
    }
    if (!GENERATED_TEST_RUNNERS.has(step.testRunner) || !['none', 'loopback'].includes(step.network)) {
      throw new Error('generated test runner contract is invalid')
    }
    if (step.testRunner === 'jest' && step.network !== 'none') throw new Error('generated Jest tests must run without network access')
    if (step.testRunner !== 'jest' && step.network !== 'loopback') throw new Error('generated Playwright tests must run with isolated loopback only')
    cli = resolveTargetTestCli(target, step.testRunner)
    if (step.testRunner === 'playwright-browser') {
      const isolatedBrowserCache = path.join(tempRoot, 'browser-cache')
      fs.mkdirSync(isolatedBrowserCache, { mode: 0o700 })
      const browser = browserRuntimeResolver(target, isolatedBrowserCache)
      readOnlyRoots.push(browser.browserRoot)
      env.PLAYWRIGHT_BROWSERS_PATH = browser.isolatedCache
    }
    if (step.testRunner !== 'jest') env.PLAYWRIGHT_JSON_OUTPUT_FILE = path.join(tempRoot, 'playwright-results.json')
    const contract = generatedTestExecutionContract({ runner: step.testRunner, artifact: step.artifact })
    if (step.executor !== contract.executor || step.cliPackage !== contract.cliPackage
      || JSON.stringify(step.argv) !== JSON.stringify(contract.argv) || step.command !== contract.command) {
      throw new Error('generated test execution differs from the fixed direct controller contract')
    }
    const runnerArgs = contract.argv.map((value) => value
      .replace('<resolved-cli>', cli)
      .replace('<isolated-temp>', tempRoot))
    before = targetSnapshot(target)
    const invocation = sandboxedInvocation({
      command: process.execPath,
      args: runnerArgs,
      cwd: target,
      writableRoots: [tempRoot],
      readOnlyRoots,
      networkMode: step.network,
      env,
    })
    execution = execute(invocation.command, invocation.args, invocation.cwd, timeout, invocation.env)
    if (execution.status === 0 && !execution.error) testCounts = generatedTestCounts(step.testRunner, tempRoot)
  } catch (error) {
    execution = { status: null, error, stdout: '', stderr: '', durationMs: 0 }
  }
  try {
    const after = targetSnapshot(target)
    const changed = before
      ? [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).sort()
      : []
    const unsafeEntries = unsafeChangedTargetEntries(after, changed)
    const result = {
      ...stepResult(step, execution, [], roots),
      ...(typeof cli === 'string' && fs.existsSync(cli) ? { cliSha256: sha256(fs.readFileSync(cli)) } : {}),
      ...(testCounts ? { testCounts } : {}),
    }
    if (unsafeEntries.length) {
      result.status = 'fail'
      result.sanitizedError = sanitizeReportText(`generated test created unsafe filesystem entries: ${unsafeEntries.join(', ')}`, roots)
    }
    return result
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function executedCoverage(plan, steps, results) {
  const deterministic = steps.find((step) => step.kind === 'deterministic')?.observedCaseIds ?? []
  const routing = plan.coverage.routing.map((entry) => {
    const executedCaseIds = sortedUnique(results.filter((result) => result.runner === entry.runner && result.evaluationKind === 'routing' && !result.sourceResult).map((result) => result.caseId))
    return { runner: entry.runner, expectedCaseIds: entry.expectedCaseIds, executedCaseIds, missingCaseIds: difference(entry.expectedCaseIds, executedCaseIds) }
  })
  const writableExecuted = sortedUnique(results.filter((result) => WRITABLE_KINDS.has(result.evaluationKind) && !result.sourceResult).map((result) => result.caseId))
  const reviewExecuted = sortedUnique(results.filter((result) => result.sourceResult).map((result) => result.caseId))
  const validationExecuted = steps.filter((step) => step.kind === 'validation' && step.status !== 'skipped').map((step) => `yarn ${step.id.slice('validation:'.length)}`)
  const targetValidationExecuted = []
  const targetValidationPassed = []
  const targetValidationFailed = []
  for (const caseId of plan.coverage.targetValidation.expectedCaseIds) {
    const caseSteps = steps.filter((step) => step.kind === 'target-validation' && step.caseId === caseId)
    if (caseSteps.length !== plan.coverage.targetValidation.commands.length || caseSteps.some((step) => step.status === 'skipped')) continue
    targetValidationExecuted.push(caseId)
    if (caseSteps.every((step) => step.status === 'pass')) targetValidationPassed.push(caseId)
    else targetValidationFailed.push(caseId)
  }
  const generatedTestExecuted = sortedUnique(steps.filter((step) => step.kind === 'generated-test' && step.status !== 'skipped').map((step) => step.caseId))
  const generatedTestPassed = sortedUnique(steps.filter((step) => step.kind === 'generated-test' && step.status === 'pass').map((step) => step.caseId))
  const generatedTestFailed = sortedUnique(steps.filter((step) => step.kind === 'generated-test' && step.status === 'fail').map((step) => step.caseId))
  return {
    deterministic: { ...plan.coverage.deterministic, executedCaseIds: deterministic, missingCaseIds: difference(plan.coverage.deterministic.expectedCaseIds, deterministic) },
    routing,
    writable: { ...plan.coverage.writable, executedCaseIds: writableExecuted, missingCaseIds: difference(plan.coverage.writable.expectedCaseIds, writableExecuted) },
    review: { ...plan.coverage.review, executedCaseIds: reviewExecuted, missingCaseIds: difference(plan.coverage.review.expectedCaseIds, reviewExecuted) },
    registry: plan.coverage.registry,
    validation: { ...plan.coverage.validation, executedCommands: validationExecuted, missingExecutedCommands: difference(plan.coverage.validation.expectedCommands, validationExecuted) },
    targetValidation: {
      ...plan.coverage.targetValidation,
      executedCaseIds: targetValidationExecuted,
      passedCaseIds: targetValidationPassed,
      failedCaseIds: targetValidationFailed,
      missingCaseIds: difference(plan.coverage.targetValidation.expectedCaseIds, targetValidationExecuted),
    },
    generatedTests: {
      ...plan.coverage.generatedTests,
      executedCaseIds: generatedTestExecuted,
      passedCaseIds: generatedTestPassed,
      failedCaseIds: generatedTestFailed,
      missingCaseIds: difference(plan.coverage.generatedTests.expectedCaseIds, generatedTestExecuted),
    },
  }
}

function writeReport(root, report, roots, schema) {
  const directory = path.join(root, '.ai', 'harness', 'results')
  fs.mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(directory, `${stamp}-release-suite.json`)
  const sanitized = sanitizeObject(report, roots)
  const schemaErrors = validateJsonSchema(sanitized, schema)
  if (schemaErrors.length) throw new Error(`release report schema validation failed: ${schemaErrors.slice(0, 8).join('; ')}`)
  fs.writeFileSync(file, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 })
  return path.relative(root, file).replaceAll(path.sep, '/')
}

function writeTargetValidationResult(root, target, caseId, sourceArtifact, commandSteps, generatedTestStep, schema) {
  const sourcePath = path.join(root, sourceArtifact.path)
  const targetFingerprint = targetContentFingerprint(target)
  if (targetFingerprint !== sourceArtifact.value.writable.targetFingerprint) {
    throw new Error('original writable target changed after its trusted oracle; target validation must run only in the isolated copy')
  }
  const record = {
    schemaVersion: 1,
    caseId,
    sourceResult: { path: sourceArtifact.path, sha256: sha256(fs.readFileSync(sourcePath)) },
    beforeValidationFingerprint: sourceArtifact.value.writable.targetFingerprint,
    targetFingerprint,
    commands: commandSteps.map((step) => ({
      command: step.command,
      status: step.status,
      exitStatus: step.exitStatus,
      durationMs: step.durationMs,
    })),
    generatedTests: generatedTestStep ? [{
      runner: generatedTestStep.testRunner,
      artifact: generatedTestStep.artifact,
      artifactSha256: sha256(fs.readFileSync(path.join(target, generatedTestStep.artifact))),
      executor: generatedTestStep.executor,
      cliPackage: generatedTestStep.cliPackage,
      cliSha256: generatedTestStep.cliSha256,
      argv: generatedTestStep.argv,
      command: generatedTestStep.command,
      network: generatedTestStep.network,
      testCounts: generatedTestStep.testCounts,
      status: generatedTestStep.status,
      exitStatus: generatedTestStep.exitStatus,
      durationMs: generatedTestStep.durationMs,
    }] : [],
    status: commandSteps.every((step) => step.status === 'pass') && (!generatedTestStep || generatedTestStep.status === 'pass') ? 'pass' : 'fail',
  }
  const schemaErrors = validateJsonSchema(record, schema)
  if (schemaErrors.length) throw new Error(`target validation result schema failed: ${schemaErrors.slice(0, 8).join('; ')}`)
  const directory = path.join(root, '.ai', 'harness', 'results')
  fs.mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const absolute = path.join(directory, `${stamp}-target-validation-${caseId}.json`)
  fs.writeFileSync(absolute, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return { absolute, relative: path.relative(root, absolute).replaceAll(path.sep, '/'), value: record }
}

function initialReport(plan, startedAt) {
  return {
    schemaVersion: 1,
    status: 'fail',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    runnerPolicy: plan.runnerPolicy,
    catalog: plan.catalog,
    coverage: executedCoverage(plan, [], []),
    steps: [],
    metrics: aggregateQualityMetrics([]),
    violations: plan.violations.map((entry) => entry.slice(0, VIOLATION_LIMIT)),
  }
}

export function main(argv = process.argv.slice(2)) {
  const wallStarted = Date.now()
  const startedAt = new Date().toISOString()
  let options
  try { options = parseArgs(argv) } catch (error) { console.error(error.message); console.error(usage()); return 2 }
  if (options.help) { console.log(usage()); return 0 }
  let root
  try { root = fs.realpathSync(options.root) } catch { console.error('release root is unavailable'); return 2 }
  const harnessDir = path.join(root, '.ai', 'harness')
  if (!fs.existsSync(harnessDir)) { console.error(`harness directory not found under release root`); return 2 }
  let cases
  let registry
  let releaseMatrix
  let fixtures
  let seeds
  let releaseResultSchema
  let targetValidationResultSchema
  try {
    cases = readJson(path.join(harnessDir, 'cases.json'))
    registry = readJson(path.join(harnessDir, 'validators.json'))
    releaseMatrix = readJson(path.join(harnessDir, 'release-matrix.json'))
    fixtures = readJson(path.join(harnessDir, 'fixtures', 'index.json'))
    seeds = readJson(path.join(harnessDir, 'fixtures', 'seeds.json'))
    releaseResultSchema = readJson(path.join(harnessDir, 'release-result.schema.json'))
    targetValidationResultSchema = readJson(path.join(harnessDir, 'target-validation-result.schema.json'))
  } catch {
    console.error('release harness inputs are missing or invalid')
    return 2
  }
  const hostPrerequisiteViolations = releaseHostPrerequisiteViolations(releaseMatrix)
  if (hostPrerequisiteViolations.length) {
    console.error('release host prerequisites are not satisfied:')
    for (const violation of hostPrerequisiteViolations) console.error(`- ${violation}`)
    return 2
  }
  let targetsManifest
  let controllerDependencyFingerprint
  try { controllerDependencyFingerprint = dependencyContentFingerprint(root) } catch (error) {
    console.error(`controller dependency verification failed: ${error.message}`)
    return 2
  }
  if (options.writableTargets) {
    try {
      const stat = fs.lstatSync(options.writableTargets)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RESULT_LIMIT) throw new Error('manifest must be a bounded regular file')
      targetsManifest = readJson(options.writableTargets)
    } catch (error) {
      console.error(`cannot read writable target manifest: ${error.message}`)
      return 2
    }
  } else {
    let prepareRoot
    try { prepareRoot = resolvePreparationRoot(options.prepareTargets, root) } catch (error) { console.error(error.message); return 2 }
    const writableIds = cases.filter((item) => WRITABLE_KINDS.has(item.evaluationKind)).map((item) => item.id)
    const proposedManifest = { schemaVersion: 1, targets: Object.fromEntries(writableIds.map((id) => [id, path.join(prepareRoot, id)])) }
    const preliminary = buildReleasePlan({ cases, registry, releaseMatrix, fixtures, seeds, targetsManifest: proposedManifest, root, primaryRunner: options.runner, portabilityRunner: options.portabilityRunner, targetsMayNotExist: true })
    const proposedRoots = Object.values(proposedManifest.targets)
    if (preliminary.violations.length) {
      const report = initialReport(preliminary, startedAt)
      report.durationMs = Date.now() - wallStarted
      report.finishedAt = new Date().toISOString()
      const reportPath = writeReport(root, report, [root, ...proposedRoots], releaseResultSchema)
      console.error(`Release preflight failed before target preparation; report: ${reportPath}`)
      return 1
    }
    try {
      targetsManifest = prepareWritableTargets({ root, prepareRoot, caseIds: writableIds })
    } catch (error) {
      preliminary.violations = [`automatic writable target preparation failed: ${error.message}`]
      const report = initialReport(preliminary, startedAt)
      report.durationMs = Date.now() - wallStarted
      report.finishedAt = new Date().toISOString()
      const reportPath = writeReport(root, report, [root, ...proposedRoots], releaseResultSchema)
      console.error(`Automatic target preparation failed; report: ${reportPath}`)
      return 1
    }
  }
  const plan = buildReleasePlan({ cases, registry, releaseMatrix, fixtures, seeds, targetsManifest, root, primaryRunner: options.runner, portabilityRunner: options.portabilityRunner })
  const targetRoots = Object.values(plan.targets).filter((entry) => typeof entry === 'string' && path.isAbsolute(entry)).map((entry) => path.resolve(entry))
  const roots = [root, ...targetRoots]
  if (plan.violations.length) {
    const report = initialReport(plan, startedAt)
    report.durationMs = Date.now() - wallStarted
    report.finishedAt = new Date().toISOString()
    const reportPath = writeReport(root, report, roots, releaseResultSchema)
    console.error(`Release preflight failed; report: ${reportPath}`)
    for (const violation of plan.violations) console.error(`- ${violation}`)
    return 1
  }
  console.log(`Runner policy: primary=${plan.runnerPolicy.primaryRunner}; portability=${plan.runnerPolicy.portabilityRunner ?? 'not requested'}`)

  const evaluator = path.join(root, 'scripts', 'evaluate-agent-harness.mjs')
  const preparer = path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs')
  const sharedDependencyBefore = controllerDependencyFingerprint
  const steps = []
  const resultArtifacts = []
  const deterministicStep = plan.steps.find((step) => step.kind === 'deterministic')
  const validationSteps = plan.steps.filter((step) => step.kind === 'validation')
  const foundationTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-foundation-'))
  const { env: foundationEnv } = createMinimalValidationEnvironment(foundationTempRoot)
  let deterministicResult
  try {
    const deterministic = deterministicInvocation({ evaluator, root })
    const deterministicExecution = execute(
      process.execPath,
      deterministic.args,
      root,
      deterministic.timeout,
      foundationEnv,
    )
    const deterministicObserved = sortedUnique((deterministicExecution.stdout ?? '').match(/^PASS (OMH-[0-9]{3})/gm)?.map((entry) => entry.slice('PASS '.length)) ?? [])
    deterministicResult = stepResult(deterministicStep, deterministicExecution, [], roots)
    deterministicResult.observedCaseIds = deterministicObserved
    if (deterministicObserved.length !== plan.catalog.caseCount) {
      deterministicResult.status = 'fail'
      deterministicResult.sanitizedError = `expected ${plan.catalog.caseCount} deterministic cases, observed ${deterministicObserved.length}`
    }
    steps.push(deterministicResult)

    if (deterministicResult.status === 'pass') {
      steps.push(...runTargetValidationSteps({
        steps: validationSteps,
        target: root,
        timeout: options.validationTimeout,
        roots,
        allowContainedDependencies: true,
      }))
    } else {
      for (const step of validationSteps) steps.push(skippedStep(step, 'deterministic gate failed'))
    }
  } finally {
    fs.rmSync(foundationTempRoot, { recursive: true, force: true })
  }

  const foundationsPassed = deterministicResult.status === 'pass'
    && steps.filter((step) => step.kind === 'validation').every((step) => step.status === 'pass')
  const modelSteps = plan.steps.filter((step) => ['routing', 'fixture', 'writable', 'target-validation', 'generated-test', 'review'].includes(step.kind))
  if (!foundationsPassed) {
    for (const step of modelSteps) steps.push(skippedStep(step, 'deterministic or validation foundation failed'))
  } else {
    for (const step of plan.steps.filter((entry) => entry.kind === 'routing')) {
      const before = resultFiles(root)
      const { args: routingArgs, timeout: routingTimeout } = routingInvocation({
        evaluator, root, step, cases, caseTimeout: options.caseTimeout,
      })
      const execution = execute(process.execPath, routingArgs, root, routingTimeout)
      const artifacts = readNewResults(root, before)
      resultArtifacts.push(...artifacts)
      steps.push(stepResult(step, execution, artifacts, roots, step.expectedCaseIds.length))
    }

    for (const caseId of plan.coverage.writable.expectedCaseIds) {
      const fixtureStep = plan.steps.find((step) => step.id === `fixture:${caseId}`)
      const writableStep = plan.steps.find((step) => step.id === `writable:${caseId}`)
      const targetValidationSteps = plan.steps.filter((step) => step.kind === 'target-validation' && step.caseId === caseId)
      const generatedTestStep = plan.steps.find((step) => step.kind === 'generated-test' && step.caseId === caseId)
      const reviewStep = plan.steps.find((step) => step.id === `review:${caseId}`)
      const target = plan.targets[caseId]
      const fixtureExecution = execute(process.execPath, [preparer, '--case', caseId, '--target', target, '--acknowledge-writes'], root, 120_000)
      const fixtureResult = stepResult(fixtureStep, fixtureExecution, [], roots)
      steps.push(fixtureResult)
      if (fixtureResult.status !== 'pass') {
        steps.push(skippedStep(writableStep, 'fixture preparation failed'))
        for (const step of targetValidationSteps) steps.push(skippedStep(step, 'writable gate did not pass'))
        if (generatedTestStep) steps.push(skippedStep(generatedTestStep, 'writable gate did not pass'))
        if (reviewStep) steps.push(skippedStep(reviewStep, 'writable gate did not pass'))
        continue
      }
      const beforeWritable = resultFiles(root)
      const caseTimeout = effectiveCaseTimeout(cases, caseId, options.caseTimeout)
      const writableExecution = execute(process.execPath, [
        evaluator, '--root', root, '--runner', writableStep.runner, '--case', caseId,
        '--model', writableStep.modelSelector, '--timeout', String(caseTimeout),
        '--writable-root', target, '--acknowledge-writes',
      ], root, caseTimeout + 120_000)
      const writableArtifacts = readNewResults(root, beforeWritable)
      resultArtifacts.push(...writableArtifacts)
      const writableResult = stepResult(writableStep, writableExecution, writableArtifacts, roots, 1)
      steps.push(writableResult)
      const sourceArtifact = writableArtifacts.find((entry) => entry.value.caseId === caseId && WRITABLE_KINDS.has(entry.value.evaluationKind))
      const targetValidationResults = runTargetValidationSteps({
        steps: targetValidationSteps,
        target,
        timeout: options.validationTimeout,
        roots,
      })
      steps.push(...targetValidationResults)
      const failedTargetCommands = targetValidationResults.filter((step) => step.status !== 'pass')
      let generatedTestResult
      if (generatedTestStep) {
        if (writableResult.status !== 'pass' || !sourceArtifact || sourceArtifact.value.status !== 'pass') {
          generatedTestResult = skippedStep(generatedTestStep, 'trusted writable oracle did not pass')
        } else if (failedTargetCommands.length) {
          generatedTestResult = skippedStep(generatedTestStep, 'target validation did not pass')
        } else {
          generatedTestResult = runGeneratedTestStep({
            step: generatedTestStep,
            target,
            timeout: options.validationTimeout,
            roots,
          })
        }
        steps.push(generatedTestResult)
      }
      if (!reviewStep) continue
      if (writableResult.status !== 'pass' || !sourceArtifact || sourceArtifact.value.status !== 'pass') {
        steps.push(skippedStep(reviewStep, 'writable gate did not pass'))
        continue
      }
      if (failedTargetCommands.length) {
        steps.push(skippedStep(reviewStep, `target validation failed: ${failedTargetCommands.map((step) => step.command).join(', ')}`))
        continue
      }
      if (generatedTestResult && generatedTestResult.status !== 'pass') {
        steps.push(skippedStep(reviewStep, 'generated test execution did not pass'))
        continue
      }
      let targetValidationArtifact
      try {
        targetValidationArtifact = writeTargetValidationResult(
          root, target, caseId, sourceArtifact, targetValidationResults, generatedTestResult, targetValidationResultSchema,
        )
      } catch (error) {
        const finalValidation = targetValidationResults.at(-1)
        finalValidation.status = 'fail'
        finalValidation.sanitizedError = sanitizeReportText(`validation attestation failed: ${error.message}`, roots)
        steps.push(skippedStep(reviewStep, 'target validation attestation failed'))
        continue
      }
      const beforeReview = resultFiles(root)
      const reviewExecution = execute(process.execPath, [
        evaluator, '--root', root, '--runner', reviewStep.runner,
        '--model', reviewStep.modelSelector, '--timeout', String(caseTimeout),
        '--judge-writable-result', path.join(root, sourceArtifact.path), '--writable-root', target,
        '--judge-validation-result', targetValidationArtifact.absolute,
      ], root, caseTimeout + 60_000)
      const reviewArtifacts = readNewResults(root, beforeReview)
      resultArtifacts.push(...reviewArtifacts)
      steps.push(stepResult(reviewStep, reviewExecution, reviewArtifacts, roots, 1))
    }
  }

  if (sharedDependencyBefore) {
    let sharedDependencyAfter
    let dependencyError
    try { sharedDependencyAfter = dependencyContentFingerprint(root) } catch (error) { dependencyError = error }
    steps.push({
      id: 'shared-dependencies:unchanged',
      kind: 'dependency-guard',
      status: !dependencyError && sharedDependencyAfter === sharedDependencyBefore ? 'pass' : 'fail',
      exitStatus: null,
      durationMs: 0,
      resultPaths: [],
      ...(!dependencyError && sharedDependencyAfter === sharedDependencyBefore ? {} : {
        sanitizedError: dependencyError
          ? sanitizeReportText(`shared dependency verification failed: ${dependencyError.message}`, roots)
          : 'shared dependency tree changed during release execution; restore dependencies and rerun with fresh targets',
      }),
    })
  }

  const values = resultArtifacts.map((entry) => entry.value)
  const coverage = executedCoverage(plan, steps, values)
  const executionViolations = steps
    .filter((step) => step.status !== 'pass')
    .map((step) => `${step.id} ${step.status}${step.sanitizedError ? `: ${step.sanitizedError}` : ''}`)
    .slice(0, 256)
  const coverageIncomplete = coverage.deterministic.missingCaseIds.length
    || coverage.routing.some((entry) => entry.missingCaseIds.length)
    || coverage.writable.missingCaseIds.length
    || coverage.review.missingCaseIds.length
    || coverage.validation.missingExecutedCommands.length
    || coverage.targetValidation.missingCaseIds.length
    || coverage.targetValidation.failedCaseIds.length
    || coverage.generatedTests.missingCaseIds.length
    || coverage.generatedTests.failedCaseIds.length
  const status = executionViolations.length === 0 && !coverageIncomplete ? 'pass' : 'fail'
  const report = {
    schemaVersion: 1,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - wallStarted,
    runnerPolicy: plan.runnerPolicy,
    catalog: plan.catalog,
    coverage,
    steps,
    metrics: aggregateQualityMetrics(values),
    violations: executionViolations.map((entry) => entry.slice(0, VIOLATION_LIMIT)),
  }
  const reportPath = writeReport(root, report, roots, releaseResultSchema)
  console.log(`${status === 'pass' ? 'PASS' : 'FAIL'} release suite — ${reportPath}`)
  return status === 'pass' ? 0 : 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = main()
