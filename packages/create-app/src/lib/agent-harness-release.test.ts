import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const releaseScript = fileURLToPath(new URL('../../agentic/shared/scripts/run-agent-harness-release.mjs', import.meta.url))
const releaseSchema = fileURLToPath(new URL('../../agentic/shared/ai/harness/release-result.schema.json', import.meta.url))
const targetValidationSchema = fileURLToPath(new URL('../../agentic/shared/ai/harness/target-validation-result.schema.json', import.meta.url))
const executionSandboxScript = fileURLToPath(new URL('../../agentic/shared/scripts/execution-sandbox.mjs', import.meta.url))
const monorepoNodeModules = fs.realpathSync(fileURLToPath(new URL('../../../../node_modules', import.meta.url)))
const release = await import(pathToFileURL(releaseScript).href) as {
  buildReleasePlan: (input: Record<string, unknown>) => any
  effectiveCaseTimeout: (cases: Array<{ id: string; timeoutMs?: number }>, caseId: string, fallback: number) => number
  aggregateQualityMetrics: (results: any[]) => any
  sanitizeReportText: (value: string, roots?: string[]) => string
  createMinimalValidationEnvironment: (tempRoot: string, pathValue?: string) => { env: NodeJS.ProcessEnv; toolReadRoots: string[] }
  prepareWritableTargets: (input: { root: string; prepareRoot: string; caseIds: string[] }) => { schemaVersion: number; targets: Record<string, string> }
  resolvePreparationRoot: (requested: string, controllerRoot: string) => string
  dependencyContentFingerprint: (appRoot: string) => string
  runTargetValidationSteps: (input: { steps: any[]; target: string; timeout: number; roots: string[]; yarnCommand: string; pathValue?: string; allowContainedDependencies?: boolean }) => any[]
  runGeneratedTestStep: (input: { steps?: never; step: any; target: string; timeout: number; roots: string[]; browserRuntimeResolver?: (target: string, cache: string) => any }) => any
  generatedTestExecutionContract: (entry: { runner: string; artifact: string }) => { executor: string; cliPackage: string; argv: string[]; command: string }
  targetContentFingerprint: (root: string) => string
  releaseHostPrerequisiteViolations: (matrix: Record<string, unknown>, platform?: string, env?: NodeJS.ProcessEnv) => string[]
}
const executionSandbox = await import(pathToFileURL(executionSandboxScript).href) as {
  assertSandboxNetworkModeSupported: (network: string, platform?: string) => void
  assertSandboxRuntimeAvailable: (network: string, platform?: string, env?: NodeJS.ProcessEnv) => void
  verifyLinuxSandboxIsolation: (env?: NodeJS.ProcessEnv) => void
  collapseReadOnlyRoots: (roots: string[]) => string[]
  linuxMergedUsrSymlinkArgs: () => string[]
  linuxNamespaceArgs: (network: string) => string[]
  linuxIsolationArgs: (network: string) => string[]
  linuxNetworkReadFiles: (network: string) => string[]
  macSandboxProfile: (input: { command: string; writableRoots: string[]; readOnlyRoots: string[]; networkMode: string; env: NodeJS.ProcessEnv }) => string
  sandboxedInvocation: (input: Record<string, unknown>) => { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }
}
const targetSandboxAvailable = process.platform === 'darwin'
  || (process.platform === 'linux' && spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status === 0)
const bwrapPresent = process.platform === 'linux'
  && spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status === 0
const isolatedLoopbackAvailable = (() => {
  if (!bwrapPresent) return false
  try {
    executionSandbox.verifyLinuxSandboxIsolation(process.env)
    return true
  } catch { return false }
})()

test('case-local writable timeout raises but never lowers the operator timeout floor', () => {
  const cases = [{ id: 'OMH-184' }, { id: 'OMH-185', timeoutMs: 600_000 }]
  assert.equal(release.effectiveCaseTimeout(cases, 'OMH-184', 120_000), 120_000)
  assert.equal(release.effectiveCaseTimeout(cases, 'OMH-185', 120_000), 600_000)
  assert.equal(release.effectiveCaseTimeout(cases, 'OMH-185', 900_000), 900_000)
})

// The browser lane needs a launchable Chromium headless shell, which depends on host
// libraries Playwright installs separately (`npx playwright install-deps`). Without them the
// binary dies with a linker error that surfaces as an opaque "browser has been closed", so
// probe the real runtime and skip with a clear reason instead of reporting a harness defect.
const browserRuntimeLaunchable = (() => {
  if (!isolatedLoopbackAvailable) return false
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
  try {
    const revision = fs.readdirSync(cacheRoot).filter((entry) => entry.startsWith('chromium_headless_shell-')).sort().at(-1)
    if (!revision) return false
    const candidates = ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac/chrome-headless-shell']
      .map((relative) => path.join(cacheRoot, revision, relative))
    const executable = candidates.find((candidate) => fs.existsSync(candidate))
    if (!executable) return false
    return spawnSync(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', 'about:blank'], {
      encoding: 'utf8',
      timeout: 30_000,
    }).status === 0
  } catch { return false }
})()

function releaseInputs() {
  const targetA = path.join(os.tmpdir(), 'om-release-OMH-002')
  const targetB = path.join(os.tmpdir(), 'om-release-OMH-003')
  const cases = [
    { id: 'OMH-001', family: 'architecture', mode: 'analysis', evaluationKind: 'routing' },
    {
      id: 'OMH-002', family: 'module', mode: 'one-shot', evaluationKind: 'implementation',
      fixture: { scaffold: 'fresh-standalone', setup: ['fixture:module'] },
      oracle: { validatorIds: ['oracle.module'], expectedArtifacts: ['src/modules/example/entity.ts'] },
    },
    {
      id: 'OMH-003', family: 'bugfix', mode: 'bugfix', evaluationKind: 'regression',
      fixture: { scaffold: 'fresh-standalone', setup: ['fixture:regression'] },
      oracle: { validatorIds: ['oracle.regression'], expectedArtifacts: ['src/modules/example/fix.ts'] },
    },
  ]
  const registry = {
    catalog: { expectedCaseCount: 3, writableCaseIds: ['OMH-002', 'OMH-003'] },
    validators: {
      'oracle.module': { implementation: 'trusted-executable', runners: ['writable-ast-oracles.mjs'] },
      'oracle.regression': { implementation: 'trusted-executable', runners: ['writable-ast-oracles.mjs', 'writable-behavior-oracles.mjs'] },
    },
  }
  const releaseMatrix = {
    deterministic: { caseIds: 'all' },
    releaseSuite: {
      supportedRunners: ['codex', 'claude'],
      requireGenerativeJudge: true,
      requireGeneratedCodeReview: true,
      validationCommands: ['yarn generate', 'yarn typecheck', 'yarn lint', 'yarn build'],
    },
    routing: {
      required: { caseIds: 'all' },
      portability: { caseIds: ['OMH-002', 'OMH-003'] },
      runners: { codex: { modelSelector: 'default' }, claude: { modelSelector: 'sonnet' } },
    },
    writable: [
      { caseId: 'OMH-002' },
      { caseId: 'OMH-003' },
    ],
    generatedCodeReview: {
      required: true,
      skill: 'om-code-review',
      caseIds: ['OMH-002', 'OMH-003'],
      runners: { codex: { modelSelector: 'default' }, claude: { modelSelector: 'sonnet' } },
    },
    generativeJudge: {
      required: true,
      skill: 'om-judge-agent-session',
      reviewSkill: 'om-code-review',
      caseIds: ['OMH-002', 'OMH-003'],
      runners: { codex: { modelSelector: 'default' }, claude: { modelSelector: 'sonnet' } },
    },
    generatedTests: { required: true, entries: [] },
  }
  const fixtures = { fixtures: { module: {}, regression: {} } }
  const seeds = { fixtures: { module: {}, regression: {} } }
  const targetsManifest = { schemaVersion: 1, targets: { 'OMH-002': targetA, 'OMH-003': targetB } }
  return { cases, registry, releaseMatrix, fixtures, seeds, targetsManifest, primaryRunner: 'codex', portabilityRunner: undefined as string | undefined }
}

test('release plan derives every count and command from catalog and matrix data', () => {
  const plan = release.buildReleasePlan(releaseInputs())
  assert.deepEqual(plan.violations, [])
  assert.deepEqual(plan.catalog, { caseCount: 3, writableCaseCount: 2, reviewEligibleCaseCount: 2 })
  assert.deepEqual(plan.coverage.deterministic.configuredCaseIds, ['OMH-001', 'OMH-002', 'OMH-003'])
  assert.deepEqual(plan.runnerPolicy, { primaryRunner: 'codex', portabilityRunner: null })
  assert.deepEqual(plan.coverage.writable.configuredCaseIds, ['OMH-002', 'OMH-003'])
  assert.deepEqual(plan.coverage.review.configuredCaseIds, ['OMH-002', 'OMH-003'])
  assert.deepEqual(plan.steps.map((step: { id: string }) => step.id), [
    'deterministic:all',
    'validation:generate', 'validation:typecheck', 'validation:lint', 'validation:build',
    'routing:primary:codex',
    'fixture:OMH-002', 'writable:OMH-002',
    'target-validation:OMH-002:generate', 'target-validation:OMH-002:typecheck', 'target-validation:OMH-002:lint', 'target-validation:OMH-002:build',
    'review:OMH-002',
    'fixture:OMH-003', 'writable:OMH-003',
    'target-validation:OMH-003:generate', 'target-validation:OMH-003:typecheck', 'target-validation:OMH-003:lint', 'target-validation:OMH-003:build',
    'review:OMH-003',
  ])
})

test('release preflight selects one primary runner and an optional distinct portability runner', () => {
  const codex = release.buildReleasePlan(releaseInputs())
  assert.deepEqual(codex.coverage.routing.map((entry: any) => [entry.lane, entry.runner, entry.expectedCaseIds]), [
    ['primary', 'codex', ['OMH-001', 'OMH-002', 'OMH-003']],
  ])
  assert.ok(codex.steps.filter((entry: any) => ['writable', 'review'].includes(entry.kind)).every((entry: any) => entry.runner === 'codex'))

  const claudeInput = releaseInputs()
  claudeInput.primaryRunner = 'claude'
  claudeInput.portabilityRunner = 'codex'
  const claude = release.buildReleasePlan(claudeInput)
  assert.deepEqual(claude.runnerPolicy, { primaryRunner: 'claude', portabilityRunner: 'codex' })
  assert.deepEqual(claude.coverage.routing.map((entry: any) => [entry.lane, entry.runner, entry.expectedCaseIds]), [
    ['primary', 'claude', ['OMH-001', 'OMH-002', 'OMH-003']],
    ['portability', 'codex', ['OMH-002', 'OMH-003']],
  ])
  assert.ok(claude.steps.filter((entry: any) => ['writable', 'review'].includes(entry.kind)).every((entry: any) => entry.runner === 'claude'))

  const sameRunner = releaseInputs()
  sameRunner.portabilityRunner = 'codex'
  assert.ok(release.buildReleasePlan(sameRunner).violations.some((entry: string) => entry.includes('must differ')))
})

test('release preflight rejects weakened runner, review, command, and model contracts', () => {
  const missingRunner = releaseInputs()
  missingRunner.primaryRunner = 'other'
  assert.ok(release.buildReleasePlan(missingRunner).violations.some((entry: string) => entry.includes('valid primary runner')))

  const missingSupportedRunner = releaseInputs()
  missingSupportedRunner.releaseMatrix.releaseSuite.supportedRunners = ['codex']
  assert.ok(release.buildReleasePlan(missingSupportedRunner).violations.some((entry: string) => entry.includes('supported runners must be exactly')))

  const missingPortabilityCase = releaseInputs()
  missingPortabilityCase.releaseMatrix.routing.portability.caseIds = ['OMH-003']
  assert.ok(release.buildReleasePlan(missingPortabilityCase).violations.some((entry: string) => entry.includes('exact writable case set')))

  const duplicateDeterministic = releaseInputs()
  duplicateDeterministic.releaseMatrix.deterministic.caseIds = ['OMH-001', 'OMH-002', 'OMH-003', 'OMH-003']
  assert.ok(release.buildReleasePlan(duplicateDeterministic).violations.some((entry: string) => entry.includes('exact all-cases selector')))

  const duplicateReview = releaseInputs()
  duplicateReview.releaseMatrix.generativeJudge.caseIds.push('OMH-002')
  const duplicateReviewViolations = release.buildReleasePlan(duplicateReview).violations
  assert.ok(duplicateReviewViolations.some((entry: string) => entry.includes('review matrix contains duplicate cases')))
  assert.ok(duplicateReviewViolations.some((entry: string) => entry.includes('exactly once in catalog order')))

  const duplicateValidation = releaseInputs()
  duplicateValidation.releaseMatrix.releaseSuite.validationCommands = [
    'yarn generate', 'yarn generate', 'yarn typecheck', 'yarn lint', 'yarn build',
  ]
  assert.ok(release.buildReleasePlan(duplicateValidation).violations.some((entry: string) => entry.includes('exact ordered four-command gate')))

  for (const mutate of [
    (input: ReturnType<typeof releaseInputs>) => { input.releaseMatrix.routing.runners.codex.modelSelector = '' },
    (input: ReturnType<typeof releaseInputs>) => { input.releaseMatrix.generativeJudge.runners.codex.modelSelector = '' },
  ]) {
    const emptySelector = releaseInputs()
    mutate(emptySelector)
    assert.ok(release.buildReleasePlan(emptySelector).violations.some((entry: string) => entry.includes('valid bounded')), JSON.stringify(emptySelector.releaseMatrix))
  }

  const mixedWritable = releaseInputs()
  Object.assign(mixedWritable.releaseMatrix.writable[0], { runner: 'codex' })
  assert.ok(release.buildReleasePlan(mixedWritable).violations.some((entry: string) => entry.includes('runner-neutral')))
})

test('automatic target preparation clones only fresh source inputs and safely shares installed dependencies', { skip: process.platform === 'win32' }, () => {
  const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-source-')))
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-target-parent-')))
  const prepareRoot = path.join(parent, 'targets')
  fs.mkdirSync(path.join(controller, 'src', 'app', 'api', 'auth'), { recursive: true })
  fs.mkdirSync(path.join(controller, 'src', 'modules', 'integrations', 'credentials'), { recursive: true })
  fs.mkdirSync(path.join(controller, 'node_modules', 'example'), { recursive: true })
  fs.mkdirSync(path.join(controller, '.ai', 'harness', 'results'), { recursive: true })
  fs.mkdirSync(path.join(controller, '.ai', 'framework-context'), { recursive: true })
  fs.mkdirSync(path.join(controller, '.mercato', 'generated'), { recursive: true })
  fs.mkdirSync(path.join(controller, '.mercato', 'next'), { recursive: true })
  fs.mkdirSync(path.join(controller, 'build'), { recursive: true })
  fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(controller, 'src', 'modules.ts'), 'export default []\n')
  fs.writeFileSync(path.join(controller, 'src', 'app', 'api', 'auth', 'route.ts'), 'export const GET = () => null\n')
  fs.writeFileSync(path.join(controller, 'src', 'modules', 'integrations', 'credentials', 'route.ts'), 'export const GET = () => null\n')
  fs.writeFileSync(path.join(controller, '.ai', 'harness', 'cases.json'), '[]\n')
  fs.writeFileSync(path.join(controller, '.ai', 'harness', 'results', 'old.json'), '{}\n')
  fs.writeFileSync(path.join(controller, '.ai', 'framework-context', 'old.txt'), 'context\n')
  fs.writeFileSync(path.join(controller, 'build', 'old.js'), 'build\n')
  fs.writeFileSync(path.join(controller, '.mercato', 'generated', 'old.ts'), 'generated\n')
  fs.writeFileSync(path.join(controller, '.mercato', 'next', 'BUILD_ID'), 'build\n')
  fs.writeFileSync(path.join(controller, 'next-env.d.ts'), 'generated\n')
  fs.writeFileSync(path.join(controller, 'tsconfig.tsbuildinfo'), 'generated\n')
  fs.writeFileSync(path.join(controller, 'README.md'), 'fresh\n')
  fs.writeFileSync(path.join(controller, '.env.example'), 'DATABASE_URL=postgres://localhost/example\n')
  fs.writeFileSync(path.join(controller, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
  try {
    const manifest = release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002', 'OMH-003'] })
    assert.deepEqual(Object.keys(manifest.targets), ['OMH-002', 'OMH-003'])
    const target = manifest.targets['OMH-002']
    assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'fresh\n')
    assert.equal(fs.existsSync(path.join(target, 'src', 'app', 'api', 'auth', 'route.ts')), true)
    assert.equal(fs.existsSync(path.join(target, 'src', 'modules', 'integrations', 'credentials', 'route.ts')), true)
    assert.equal(fs.existsSync(path.join(target, 'build')), false)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'harness', 'results')), false)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'framework-context')), false)
    assert.equal(fs.existsSync(path.join(target, '.mercato', 'generated')), false)
    assert.equal(fs.existsSync(path.join(target, '.mercato', 'next')), false)
    assert.equal(fs.existsSync(path.join(target, 'next-env.d.ts')), false)
    assert.equal(fs.existsSync(path.join(target, 'tsconfig.tsbuildinfo')), false)
    assert.equal(fs.readFileSync(path.join(target, '.env.example'), 'utf8'), 'DATABASE_URL=postgres://localhost/example\n')
    assert.equal(fs.readFileSync(path.join(target, '.yarnrc.yml'), 'utf8'), 'nodeLinker: node-modules\n')
    assert.equal(fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink(), true)
    assert.equal(fs.realpathSync(path.join(target, 'node_modules')), fs.realpathSync(path.join(controller, 'node_modules')))
    fs.writeFileSync(path.join(target, 'README.md'), 'changed\n')
    assert.equal(fs.readFileSync(path.join(controller, 'README.md'), 'utf8'), 'fresh\n')
    assert.throws(() => release.resolvePreparationRoot(prepareRoot, controller), /must be empty/)
    assert.throws(() => release.resolvePreparationRoot(path.join(controller, 'unsafe-targets'), controller), /separate from the controller/)
    assert.throws(() => release.resolvePreparationRoot(path.join(controller, '..targets'), controller), /separate from the controller/)
    const linkedRoot = path.join(parent, 'linked-targets')
    fs.symlinkSync(controller, linkedRoot, 'dir')
    assert.throws(() => release.resolvePreparationRoot(linkedRoot, controller), /regular directory/)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
    fs.rmSync(controller, { recursive: true, force: true })
  }
})

test('automatic target preparation rejects local environment, auth-store, credential, and private-key files without copying them', { skip: process.platform === 'win32' }, () => {
  const sensitiveFiles = [
    '.env', '.env.local', '.npmrc', '.netrc', '.yarnrc.yaml', '.YARNRC.YML', 'config/.yarnrc.yml', '.pypirc', '.git-credentials',
    '.docker/config.json', '.codex/auth.json', '.kube/config', 'config/secrets.json',
    'config/service-account-credentials.json', 'certs/signing.key',
  ]
  for (const relative of sensitiveFiles) {
    const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-sensitive-source-')))
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-sensitive-target-')))
    const prepareRoot = path.join(parent, 'targets')
    fs.mkdirSync(path.join(controller, 'src'), { recursive: true })
    fs.mkdirSync(path.join(controller, 'node_modules', 'example'), { recursive: true })
    fs.mkdirSync(path.join(controller, '.ai', 'harness'), { recursive: true })
    fs.mkdirSync(path.dirname(path.join(controller, relative)), { recursive: true })
    fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(controller, 'src', 'modules.ts'), 'export default []\n')
    fs.writeFileSync(path.join(controller, '.ai', 'harness', 'cases.json'), '[]\n')
    fs.writeFileSync(path.join(controller, relative), 'must-not-be-copied\n')
    try {
      assert.throws(
        () => release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002'] }),
        /sanitized fresh scaffold/,
        relative,
      )
      assert.equal(fs.existsSync(prepareRoot), false, relative)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
      fs.rmSync(controller, { recursive: true, force: true })
    }
  }
})

test('automatic target preparation accepts generated and Yarn-migrated credential-free config', { skip: process.platform === 'win32' }, () => {
  const safeConfigs = [
    `nodeLinker: node-modules
unsafeHttpWhitelist:
  - "localhost"
  - "host.docker.internal"
npmScopes:
  open-mercato:
    npmRegistryServer: "http://localhost:4873"
    npmMinimalAgeGate: 0
`,
    `approvedGitRepositories:
  - "**"

enableScripts: true

nodeLinker: node-modules

npmMinimalAgeGate: 0
`,
    `approvedGitRepositories:
  - "**"

enableScripts: true

nodeLinker: node-modules

npmMinimalAgeGate: 0

npmScopes:
  open-mercato:
    npmMinimalAgeGate: 0
    npmRegistryServer: "https://registry.example.com/npm"
`,
    `approvedGitRepositories:
  - "**"

enableScripts: true

nodeLinker: node-modules

npmMinimalAgeGate: 0

npmScopes:
  open-mercato:
    npmMinimalAgeGate: 0
    npmRegistryServer: "http://localhost:4873"

unsafeHttpWhitelist:
  - "localhost"
  - "host.docker.internal"
`,
  ]
  for (const yarnConfig of safeConfigs) {
    const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-registry-source-')))
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-registry-target-')))
    const prepareRoot = path.join(parent, 'targets')
    fs.mkdirSync(path.join(controller, 'node_modules', 'example'), { recursive: true })
    fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(controller, '.yarnrc.yml'), yarnConfig)
    try {
      const manifest = release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002'] })
      assert.equal(
        fs.readFileSync(path.join(manifest.targets['OMH-002'], '.yarnrc.yml'), 'utf8'),
        fs.readFileSync(path.join(controller, '.yarnrc.yml'), 'utf8'),
      )
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
      fs.rmSync(controller, { recursive: true, force: true })
    }
  }
})

test('automatic target preparation rejects auth-bearing or non-generated Yarn config', { skip: process.platform === 'win32' }, () => {
  const unsafeConfigs = [
    `nodeLinker: node-modules
npmScopes:
  open-mercato:
    npmRegistryServer: "https://registry.example.com"
    npmAuthToken: "secret"
    npmMinimalAgeGate: 0
`,
    `nodeLinker: node-modules
npmScopes:
  open-mercato:
    npmRegistryServer: "https://user:secret@registry.example.com"
    npmMinimalAgeGate: 0
`,
    `nodeLinker: node-modules
npmScopes:
  open-mercato:
    npmRegistryServer: "https://registry.example.com?token=secret"
    npmMinimalAgeGate: 0
`,
  ]
  for (const yarnConfig of unsafeConfigs) {
    const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-unsafe-registry-source-')))
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-unsafe-registry-target-')))
    const prepareRoot = path.join(parent, 'targets')
    fs.mkdirSync(path.join(controller, 'node_modules', 'example'), { recursive: true })
    fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(controller, '.yarnrc.yml'), yarnConfig)
    try {
      assert.throws(
        () => release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002'] }),
        /unsafe Yarn registry configuration/,
      )
      assert.equal(fs.existsSync(prepareRoot), false)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
      fs.rmSync(controller, { recursive: true, force: true })
    }
  }
})

test('externally prepared targets must be realpath-disjoint from the controller and every other target', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-disjoint-')))
  const controller = path.join(parent, 'controller')
  const outside = path.join(parent, 'outside')
  fs.mkdirSync(controller)
  fs.mkdirSync(outside)
  const sentinel = path.join(outside, 'sentinel.txt')
  fs.writeFileSync(sentinel, 'outside-original')
  try {
    const controllerOverlap = releaseInputs()
    controllerOverlap.targetsManifest.targets = {
      'OMH-002': path.join(controller, 'nested-target'),
      'OMH-003': parent,
    }
    const controllerPlan = release.buildReleasePlan({ ...controllerOverlap, root: controller, targetsMayNotExist: true })
    assert.deepEqual(controllerPlan.coverage.writable.invalidTargetCaseIds, ['OMH-002', 'OMH-003'])

    const targetOverlap = releaseInputs()
    targetOverlap.targetsManifest.targets = {
      'OMH-002': path.join(outside, 'target'),
      'OMH-003': path.join(outside, 'target', 'nested'),
    }
    const targetPlan = release.buildReleasePlan({ ...targetOverlap, root: controller, targetsMayNotExist: true })
    assert.deepEqual(targetPlan.coverage.writable.duplicateTargetCaseIds, ['OMH-002', 'OMH-003'])
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside-original')
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('externally prepared targets reject regular nested dependency trees before execution', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-nested-deps-')))
  const controller = path.join(parent, 'controller')
  const targets = ['OMH-002', 'OMH-003'].map((caseId) => path.join(parent, caseId))
  fs.mkdirSync(path.join(controller, 'node_modules'), { recursive: true })
  for (const target of targets) {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true })
    fs.mkdirSync(path.join(target, '.ai', 'harness'), { recursive: true })
    fs.mkdirSync(path.join(target, 'node_modules', 'example'), { recursive: true })
    fs.writeFileSync(path.join(target, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(target, 'src', 'modules.ts'), 'export default []\n')
    fs.writeFileSync(path.join(target, '.ai', 'harness', 'cases.json'), '[]\n')
    fs.writeFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'original\n')
  }
  try {
    const input = releaseInputs()
    input.targetsManifest.targets = { 'OMH-002': targets[0], 'OMH-003': targets[1] }
    const plan = release.buildReleasePlan({ ...input, root: controller })
    assert.deepEqual(plan.coverage.writable.invalidTargetCaseIds, ['OMH-002', 'OMH-003'])
    for (const target of targets) {
      assert.equal(fs.readFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'utf8'), 'original\n')
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('every target validation command runs and failures retain actionable sanitized diagnostics', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-')))
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
console.error('called ' + process.argv[2])
if (process.argv[2] === 'lint') { console.error('lint rule failed in ' + process.cwd()); process.exit(7) }
`)
  fs.chmodSync(fakeYarn, 0o755)
  const commands = ['generate', 'typecheck', 'lint', 'build'].map((name) => ({
    id: `target-validation:OMH-002:${name}`, kind: 'target-validation', caseId: 'OMH-002', command: `yarn ${name}`,
  }))
  try {
    const results = release.runTargetValidationSteps({ steps: commands, target, timeout: 10_000, roots: [target], yarnCommand: fakeYarn })
    assert.deepEqual(results.map((entry) => entry.status), ['pass', 'pass', 'fail', 'pass'])
    assert.deepEqual(results.map((entry) => entry.sanitizedError?.match(/called (generate|typecheck|lint|build)/)?.[1]), ['generate', 'typecheck', 'lint', 'build'])
    assert.equal(results[2].command, 'yarn lint')
    assert.match(results[2].sanitizedError, /lint rule failed in <redacted-path>/)
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('target validation hides host secrets and denies out-of-root reads and writes', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-contained-')))
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-secret-')))
  const secret = path.join(outside, 'secret.txt')
  const escapedWrite = path.join(outside, 'escaped.txt')
  fs.writeFileSync(secret, 'do-not-read')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
if (process.env.FAKE_PROVIDER_SECRET) process.exit(21)
try { fs.readFileSync(${JSON.stringify(secret)}, 'utf8'); process.exit(22) } catch (error) { if (!['EPERM', 'EACCES', 'ENOENT'].includes(error.code)) throw error }
try { fs.writeFileSync(${JSON.stringify(escapedWrite)}, 'escaped'); process.exit(23) } catch (error) { if (!['EPERM', 'EACCES', 'ENOENT', 'EROFS'].includes(error.code)) throw error }
`)
  fs.chmodSync(fakeYarn, 0o755)
  const step = { id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }
  const previous = process.env.FAKE_PROVIDER_SECRET
  process.env.FAKE_PROVIDER_SECRET = 'must-not-cross-boundary'
  try {
    const [result] = release.runTargetValidationSteps({ steps: [step], target, timeout: 10_000, roots: [target, outside], yarnCommand: fakeYarn })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.equal(fs.readFileSync(secret, 'utf8'), 'do-not-read')
    assert.equal(fs.existsSync(escapedWrite), false)
  } finally {
    if (previous === undefined) delete process.env.FAKE_PROVIDER_SECRET
    else process.env.FAKE_PROVIDER_SECRET = previous
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('target validation runs in an isolated copy and rejects ordinary source or config mutations', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-source-write-')))
  fs.mkdirSync(path.join(target, 'src'))
  fs.writeFileSync(path.join(target, 'src', 'existing.ts'), 'export const original = true\n')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.mkdirSync('.mercato', { recursive: true })
fs.writeFileSync('.mercato/unrelated.txt', 'not a build output')
fs.writeFileSync('src/unreviewed.ts', 'export const hidden = true\\n')
fs.writeFileSync('package.json', '{"scripts":{"build":"true"}}\\n')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const before = release.targetContentFingerprint(target)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }],
      target, timeout: 10_000, roots: [target], yarnCommand: fakeYarn,
    })
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError, /outside explicit command outputs: \.mercato\/unrelated\.txt, package\.json, src\/unreviewed\.ts/)
    assert.equal(fs.existsSync(path.join(target, 'src', 'unreviewed.ts')), false)
    assert.equal(fs.existsSync(path.join(target, 'package.json')), false)
    assert.equal(release.targetContentFingerprint(target), before)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('target validation permits only explicit generated and build outputs inside its isolated copy', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-outputs-')))
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
const command = process.argv[2]
if (command === 'generate') {
  fs.mkdirSync('.mercato/generated', { recursive: true })
  fs.writeFileSync('.mercato/generated/modules.generated.ts', 'export default []\\n')
}
if (command === 'typecheck') fs.writeFileSync('tsconfig.tsbuildinfo', '{}')
if (command === 'build') {
  fs.mkdirSync('.mercato/next', { recursive: true })
  fs.mkdirSync('.mercato/next/node_modules', { recursive: true })
  fs.writeFileSync('.mercato/next/BUILD_ID', 'contained')
  fs.symlinkSync('../../../node_modules/example', '.mercato/next/node_modules/example')
  fs.writeFileSync('next-env.d.ts', '/// <reference types="next" />\\n')
}
`)
  fs.chmodSync(fakeYarn, 0o755)
  const before = release.targetContentFingerprint(target)
  const steps = ['generate', 'typecheck', 'lint', 'build'].map((name) => ({
    id: `target-validation:OMH-002:${name}`, kind: 'target-validation', caseId: 'OMH-002', command: `yarn ${name}`,
  }))
  try {
    const results = release.runTargetValidationSteps({ steps, target, timeout: 10_000, roots: [target], yarnCommand: fakeYarn })
    assert.deepEqual(results.map((entry) => entry.status), ['pass', 'pass', 'pass', 'pass'])
    assert.deepEqual(results.map((entry) => entry.resultPaths), [
      ['.mercato/generated'], ['tsconfig.tsbuildinfo'], [], ['.mercato/next', 'next-env.d.ts'],
    ])
    assert.equal(fs.existsSync(path.join(target, '.mercato')), false)
    assert.equal(fs.existsSync(path.join(target, 'tsconfig.tsbuildinfo')), false)
    assert.equal(fs.existsSync(path.join(target, 'next-env.d.ts')), false)
    assert.equal(release.targetContentFingerprint(target), before)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('target validation rejects an escaping symlink even inside a declared build output', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-output-link-')))
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.mkdirSync('.mercato/next', { recursive: true })
fs.symlinkSync('../../../../outside', '.mercato/next/escape')
`)
  fs.chmodSync(fakeYarn, 0o755)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }],
      target,
      timeout: 10_000,
      roots: [target],
      yarnCommand: fakeYarn,
    })
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError, /escape \(symbolic link\)/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('foundation validation accepts an exact generated env copy without mutating a controller-owned dependency tree', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-foundation-validation-')))
  fs.mkdirSync(path.join(target, 'node_modules', 'example'), { recursive: true })
  fs.writeFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'original')
  fs.writeFileSync(path.join(target, '.env.example'), 'SAFE_EXAMPLE=1\n')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.copyFileSync('.env.example', '.env')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const before = release.targetContentFingerprint(target)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'validation:generate', kind: 'validation', command: 'yarn generate' }],
      target,
      timeout: 10_000,
      roots: [target],
      yarnCommand: fakeYarn,
      allowContainedDependencies: true,
    })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.deepEqual(result.resultPaths, ['.env'])
    assert.equal(fs.existsSync(path.join(target, '.env')), false)
    assert.equal(fs.readFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'utf8'), 'original')
    assert.equal(release.targetContentFingerprint(target), before)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('minimal validation environment omits provider secrets and process diagnostics redact inherited scalars and URL userinfo', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-redaction-')))
  const environmentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-env-')))
  const scalar = 'provider-scalar-must-not-persist'
  const databaseUrl = 'postgres://release-user:database-password@db.example.test:5432/app'
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
if (process.env.FAKE_PROVIDER_SECRET) process.exit(21)
console.error(${JSON.stringify(`${scalar} ${databaseUrl}`)})
process.exit(7)
`)
  fs.chmodSync(fakeYarn, 0o755)
  const previous = process.env.FAKE_PROVIDER_SECRET
  process.env.FAKE_PROVIDER_SECRET = scalar
  try {
    const minimal = release.createMinimalValidationEnvironment(environmentRoot)
    assert.equal(minimal.env.FAKE_PROVIDER_SECRET, undefined)
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:lint', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn lint' }],
      target,
      timeout: 10_000,
      roots: [target, environmentRoot],
      yarnCommand: fakeYarn,
    })
    assert.equal(result.status, 'fail')
    assert.equal(result.exitStatus, 7)
    assert.doesNotMatch(result.sanitizedError, /provider-scalar-must-not-persist|release-user|database-password/)
    assert.match(result.sanitizedError, /postgres:\/\/<redacted-secret>@db\.example\.test/)
  } finally {
    if (previous === undefined) delete process.env.FAKE_PROVIDER_SECRET
    else process.env.FAKE_PROVIDER_SECRET = previous
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(environmentRoot, { recursive: true, force: true })
  }
})

test('target validation cannot mutate nested files in shared dependencies', { skip: !targetSandboxAvailable }, () => {
  const controllerDependencies = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-shared-deps-')))
  const nested = path.join(controllerDependencies, 'example', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(nested, 'original')
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-deps-')))
  fs.symlinkSync(controllerDependencies, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('node_modules/example/nested.js', 'tampered')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const step = { id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }
  try {
    const [result] = release.runTargetValidationSteps({ steps: [step], target, timeout: 10_000, roots: [target, controllerDependencies], yarnCommand: fakeYarn })
    assert.equal(result.status, 'fail')
    assert.equal(fs.readFileSync(nested, 'utf8'), 'original')
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(controllerDependencies, { recursive: true, force: true })
  }
})

test('target validation fails closed when a regular dependency tree overlaps the writable target', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-nested-deps-')))
  const nested = path.join(target, 'node_modules', 'example', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(nested, 'original')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('node_modules/example/nested.js', 'tampered')
fs.writeFileSync('MODEL_RAN', 'unsafe')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const step = { id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }
  try {
    const [result] = release.runTargetValidationSteps({ steps: [step], target, timeout: 10_000, roots: [target], yarnCommand: fakeYarn })
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError, /writable target node_modules must resolve outside the writable target/)
    assert.equal(fs.readFileSync(nested, 'utf8'), 'original')
    assert.equal(fs.existsSync(path.join(target, 'MODEL_RAN')), false)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('sandbox read-only descendants override a writable parent root', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-sandbox-nested-readonly-')))
  const dependencyRoot = path.join(target, 'node_modules')
  const nested = path.join(dependencyRoot, 'example', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(nested, 'original')
  const probe = path.join(target, 'sandbox-probe')
  fs.writeFileSync(probe, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('allowed.txt', 'allowed')
fs.writeFileSync('node_modules/example/nested.js', 'tampered')
`)
  fs.chmodSync(probe, 0o755)
  try {
    const invocation = executionSandbox.sandboxedInvocation({
      command: probe,
      cwd: target,
      writableRoots: [target],
      readOnlyRoots: [dependencyRoot],
      networkMode: 'none',
      env: process.env,
    })
    const result = spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: 'utf8' })
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(path.join(target, 'allowed.txt'), 'utf8'), 'allowed')
    assert.equal(fs.readFileSync(nested, 'utf8'), 'original')
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('Linux sandbox namespaces are private by default and host networking is shared only when explicitly requested', () => {
  assert.deepEqual(executionSandbox.linuxNamespaceArgs('none'), ['--unshare-all'])
  assert.deepEqual(executionSandbox.linuxNamespaceArgs('loopback'), ['--unshare-all'])
  assert.deepEqual(executionSandbox.linuxNamespaceArgs('all'), ['--unshare-all', '--share-net'])
  assert.deepEqual(executionSandbox.linuxIsolationArgs('none'), ['--unshare-all', '--cap-drop', 'ALL'])
  assert.deepEqual(executionSandbox.linuxIsolationArgs('loopback'), ['--unshare-all', '--cap-drop', 'ALL'])
  assert.deepEqual(executionSandbox.linuxIsolationArgs('all'), ['--unshare-all', '--share-net', '--cap-drop', 'ALL'])
  assert.deepEqual(executionSandbox.linuxNetworkReadFiles('none'), [])
  assert.deepEqual(executionSandbox.linuxNetworkReadFiles('loopback'), [])
  assert.deepEqual(
    executionSandbox.linuxNetworkReadFiles('all'),
    ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf'],
  )
  assert.throws(() => executionSandbox.linuxNamespaceArgs('provider'), /invalid sandbox network mode/)
  assert.throws(() => executionSandbox.linuxNetworkReadFiles('provider'), /invalid sandbox network mode/)
})

test('Linux Bubblewrap relies on its empty root instead of masking later bind sources', () => {
  const source = fs.readFileSync(executionSandboxScript, 'utf8')
  assert.doesNotMatch(source, /'--tmpfs', '\/'/)
})

test('sandbox runtime mounts collapse nested read roots before Bubblewrap applies them', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-read-roots-')))
  const nested = path.join(root, 'nested')
  const leaf = path.join(nested, 'leaf')
  fs.mkdirSync(leaf, { recursive: true })
  try {
    assert.deepEqual(
      executionSandbox.collapseReadOnlyRoots([leaf, root, nested, leaf]),
      [root],
    )
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Linux Bubblewrap recreates only exact merged-usr root aliases', () => {
  const expected = [
    ['/bin', 'usr/bin'],
    ['/sbin', 'usr/sbin'],
    ['/lib', 'usr/lib'],
    ['/lib64', 'usr/lib64'],
  ].flatMap(([alias, target]) => {
    try {
      return fs.lstatSync(alias).isSymbolicLink() && fs.readlinkSync(alias) === target
        ? ['--symlink', target, alias]
        : []
    } catch { return [] }
  })
  assert.deepEqual(executionSandbox.linuxMergedUsrSymlinkArgs(), expected)
})

test('macOS sandbox policy never grants wildcard host Mach lookup or POSIX IPC', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-mac-policy-')))
  try {
    const profile = executionSandbox.macSandboxProfile({
      command: process.execPath,
      writableRoots: [root],
      readOnlyRoots: [],
      networkMode: 'none',
      env: process.env,
    })
    assert.doesNotMatch(profile, /\(allow mach-lookup\)/)
    assert.doesNotMatch(profile, /\(allow ipc-posix\*\)/)
    assert.equal(profile.match(/\(allow mach-/g)?.length, 2)
    assert.equal(profile.match(/MachPortRendezvousServer/g)?.length, 2)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('macOS sandbox rejects loopback because it cannot isolate host listeners', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-mac-loopback-')))
  try {
    assert.throws(
      () => executionSandbox.macSandboxProfile({
        command: process.execPath,
        writableRoots: [root],
        readOnlyRoots: [],
        networkMode: 'loopback',
        env: process.env,
      }),
      /isolated loopback is unavailable with macOS sandbox-exec; run this lane in a Linux VM\/container with Bubblewrap/,
    )
    assert.throws(
      () => executionSandbox.assertSandboxNetworkModeSupported('loopback', 'darwin'),
      /isolated loopback is unavailable/,
    )
    assert.doesNotThrow(() => executionSandbox.assertSandboxNetworkModeSupported('loopback', 'linux'))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('sandboxed network-free lanes cannot connect to an evaluator-owned host listener', { skip: !targetSandboxAvailable }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-host-listener-')))
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const invocation = executionSandbox.sandboxedInvocation({
      command: process.execPath,
      args: ['-e', `
const socket = require('node:net').connect(${address.port}, '127.0.0.1')
socket.once('connect', () => { console.log('HOST_LOOPBACK_REACHED'); process.exit(91) })
socket.once('error', () => process.exit(0))
setTimeout(() => process.exit(0), 500).unref()
`],
      cwd: root,
      writableRoots: [],
      readOnlyRoots: [root],
      networkMode: process.platform === 'linux' ? 'loopback' : 'none',
      env: process.env,
    })
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      encoding: 'utf8',
      timeout: 5_000,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.doesNotMatch(result.stdout, /HOST_LOOPBACK_REACHED/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('release preflight requires Linux isolation when the matrix contains loopback lanes', { skip: !targetSandboxAvailable }, () => {
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-fake-bwrap-')))
  const fakeBwrap = path.join(bin, 'bwrap')
  fs.writeFileSync(fakeBwrap, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(fakeBwrap, 0o755)
  const matrix = releaseInputs().releaseMatrix
  matrix.generatedTests.entries = [{ caseId: 'OMH-002', network: 'loopback' }]
  try {
    // The platform argument is simulated, but the implementation legitimately probes the
    // real filesystem for that platform's sandbox binary — so running this from Linux adds
    // a "macOS target isolation requires /usr/bin/sandbox-exec" violation for the
    // network-free lanes that a real macOS host would not produce. Assert the invariant
    // under test (a loopback lane demands Linux Bubblewrap) rather than its position.
    const loopbackRequirement = /Linux VM\/container with Bubblewrap/
    assert.ok(
      release.releaseHostPrerequisiteViolations(matrix, 'darwin').some((violation: string) => loopbackRequirement.test(violation)),
      'a loopback lane on macOS must demand Linux Bubblewrap',
    )
    assert.match(release.releaseHostPrerequisiteViolations(matrix, 'linux', { PATH: bin })[0], /root-owned|isolation probe failed/)
    fs.writeFileSync(fakeBwrap, '#!/bin/sh\nwhile [ "$1" != "--" ] && [ "$#" -gt 0 ]; do shift; done\nshift\nexec "$@"\n')
    fs.chmodSync(fakeBwrap, 0o755)
    assert.match(release.releaseHostPrerequisiteViolations(matrix, 'linux', { PATH: bin })[0], /root-owned|isolation probe failed/)
    assert.match(release.releaseHostPrerequisiteViolations(matrix, 'linux', { PATH: '' })[0], /bwrap/)
    matrix.generatedTests.entries = []
    assert.ok(
      !release.releaseHostPrerequisiteViolations(matrix, 'darwin').some((violation: string) => loopbackRequirement.test(violation)),
      'without a loopback lane macOS must not be told to move to Linux',
    )
  } finally { fs.rmSync(bin, { recursive: true, force: true }) }
})

test('Linux release preflight proves private loopback with the trusted Bubblewrap runtime', { skip: !bwrapPresent }, () => {
  assert.doesNotThrow(() => executionSandbox.verifyLinuxSandboxIsolation(process.env))
})

test('Linux isolated payloads receive exact argv and no capabilities', { skip: !isolatedLoopbackAvailable }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-linux-caps-')))
  const sentinels = ['space value', 'line\nbreak', ';$(touch SHOULD_NOT_EXIST)']
  try {
    const invocation = executionSandbox.sandboxedInvocation({
      command: process.execPath,
      args: ['-e', `
const fs = require('node:fs')
const capabilities = Object.fromEntries(fs.readFileSync('/proc/self/status', 'utf8')
  .split('\\n').filter((line) => /^Cap(?:Inh|Prm|Eff|Bnd|Amb):/.test(line))
  .map((line) => line.split(/:\\s+/)))
console.log(JSON.stringify({ capabilities, argv: process.argv.slice(1) }))
`, ...sentinels],
      cwd: root,
      writableRoots: [],
      readOnlyRoots: [root],
      networkMode: 'loopback',
      env: process.env,
    })
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      encoding: 'utf8',
      timeout: 5_000,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const payload = JSON.parse(result.stdout)
    assert.deepEqual(payload.argv, sentinels)
    assert.deepEqual(Object.keys(payload.capabilities).sort(), ['CapAmb', 'CapBnd', 'CapEff', 'CapInh', 'CapPrm'])
    for (const value of Object.values(payload.capabilities)) assert.match(String(value), /^0+$/)
    assert.equal(fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('macOS release preflight rejects loopback before dependencies or writable targets are touched', { skip: process.platform !== 'darwin' }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-mac-preflight-')))
  const harness = path.join(root, '.ai', 'harness')
  const prepareRoot = path.join(root, 'prepared-targets')
  const input = releaseInputs()
  input.releaseMatrix.generatedTests.entries = [{ caseId: 'OMH-002', network: 'loopback' }]
  fs.mkdirSync(path.join(harness, 'fixtures'), { recursive: true })
  fs.mkdirSync(prepareRoot)
  fs.writeFileSync(path.join(harness, 'cases.json'), JSON.stringify(input.cases))
  fs.writeFileSync(path.join(harness, 'validators.json'), JSON.stringify(input.registry))
  fs.writeFileSync(path.join(harness, 'release-matrix.json'), JSON.stringify(input.releaseMatrix))
  fs.copyFileSync(releaseSchema, path.join(harness, 'release-result.schema.json'))
  fs.copyFileSync(targetValidationSchema, path.join(harness, 'target-validation-result.schema.json'))
  fs.writeFileSync(path.join(harness, 'fixtures', 'index.json'), JSON.stringify(input.fixtures))
  fs.writeFileSync(path.join(harness, 'fixtures', 'seeds.json'), JSON.stringify(input.seeds))
  try {
    const run = spawnSync(process.execPath, [
      releaseScript, '--root', root, '--runner', 'codex', '--prepare-targets', prepareRoot, '--acknowledge-writes',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stderr, /release host prerequisites are not satisfied/)
    assert.match(run.stderr, /Linux VM\/container with Bubblewrap/)
    assert.deepEqual(fs.readdirSync(prepareRoot), [])
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('release target fingerprints bind empty directories and file or directory mode changes', { skip: process.platform === 'win32' }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-target-fingerprint-')))
  const source = path.join(target, 'source.ts')
  const directory = path.join(target, 'existing')
  fs.writeFileSync(source, 'export const value = 1\n')
  fs.mkdirSync(directory)
  try {
    const initial = release.targetContentFingerprint(target)
    fs.chmodSync(source, 0o755)
    const fileMode = release.targetContentFingerprint(target)
    assert.notEqual(fileMode, initial)
    fs.chmodSync(directory, 0o700)
    const directoryMode = release.targetContentFingerprint(target)
    assert.notEqual(directoryMode, fileMode)
    fs.mkdirSync(path.join(target, 'UNDECLARED_EMPTY'))
    assert.notEqual(release.targetContentFingerprint(target), directoryMode)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('macOS validation resolves a lexical PATH node launcher without authorizing a broad temporary parent', { skip: process.platform !== 'darwin' }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-target-')))
  const launcherBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-parent-')))
  const launcherParent = path.join(launcherBase, 'xfs-deadbeef')
  fs.mkdirSync(launcherParent)
  const launcher = path.join(launcherParent, 'node')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(fs.realpathSync(process.execPath))}  "$@"\n`)
  fs.chmodSync(launcher, 0o755)
  fs.writeFileSync(fakeYarn, '#!/usr/bin/env node\nconsole.error("xfs-ok")\n')
  fs.chmodSync(fakeYarn, 0o755)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }],
      target, timeout: 10_000, roots: [target, launcherParent], yarnCommand: fakeYarn,
      pathValue: `${launcherParent}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.match(result.sanitizedError, /xfs-ok/)
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(launcherBase, { recursive: true, force: true })
  }
})

test('macOS validation rejects a lookalike XFS node wrapper', { skip: process.platform !== 'darwin' }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-reject-target-')))
  const launcherBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-reject-parent-')))
  const launcherParent = path.join(launcherBase, 'xfs-badc0de')
  fs.mkdirSync(launcherParent)
  const launcher = path.join(launcherParent, 'node')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(fs.realpathSync(process.execPath))} "$@"\n`)
  fs.chmodSync(launcher, 0o755)
  fs.writeFileSync(fakeYarn, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("unsafe.txt", "ran")\n')
  fs.chmodSync(fakeYarn, 0o755)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }],
      target, timeout: 10_000, roots: [target, launcherParent], yarnCommand: fakeYarn,
      pathValue: `${launcherParent}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 'fail')
    assert.equal(fs.existsSync(path.join(target, 'unsafe.txt')), false)
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(launcherBase, { recursive: true, force: true })
  }
})

function stageGeneratedTestTarget(): string {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-generated-tests-')))
  fs.mkdirSync(path.join(target, 'src', 'modules'), { recursive: true })
  fs.mkdirSync(path.join(target, '.ai', 'qa', 'tests'), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"generated-test-target","private":true,"type":"module"}\n')
  fs.writeFileSync(path.join(target, 'jest.config.cjs'), 'module.exports = { testEnvironment: "node", transform: {} }\n')
  fs.writeFileSync(path.join(target, '.ai', 'qa', 'tests', 'playwright.config.ts'), `
import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: ${JSON.stringify(target)}, timeout: 10000, retries: 0, workers: 1, use: { headless: true } })
`)
  fs.symlinkSync(monorepoNodeModules, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return target
}

function writeGeneratedTest(target: string, relative: string, source: string): void {
  const file = path.join(target, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source)
}

function generatedTestStep(caseId: string, testRunner: string, artifact: string, network: string): any {
  const contract = release.generatedTestExecutionContract({ runner: testRunner, artifact })
  return { id: `generated-test:${caseId}:${testRunner}`, kind: 'generated-test', caseId, testRunner, artifact, network, ...contract }
}

test('generated Jest tests run through the direct fixed runner with a read-only target and no network', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'generated-test-target', private: true, type: 'module',
    scripts: { test: 'node -e "require(\\"node:fs\\").writeFileSync(\\"TARGET_SCRIPT_RAN\\",\\"unsafe\\")"' },
  }))
  writeGeneratedTest(target, artifact, `
test('already approved', () => expect(() => { throw new Error('already approved') }).toThrow('already approved'))
test('requester', () => expect(() => { throw new Error('requester') }).toThrow('requester'))
test('injected failure rolls back', () => expect(0).toBe(0))
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.equal(result.exitStatus, 0)
    assert.equal(result.executor, 'node')
    assert.equal(result.cliPackage, 'jest')
    assert.match(result.cliSha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(result.argv, [
      '<resolved-cli>', '--config', 'jest.config.cjs', '--runInBand', '--runTestsByPath', artifact,
      '--cacheDirectory', '<isolated-temp>/jest-cache', '--json', '--outputFile', '<isolated-temp>/jest-results.json',
    ])
    assert.deepEqual(result.testCounts, { passedTests: 3, skippedTests: 0, todoTests: 0, expectedFailureTests: 0 })
    assert.equal(result.command, `node ${result.argv.join(' ')}`)
    assert.equal(fs.existsSync(path.join(target, 'TARGET_SCRIPT_RAN')), false)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated test code cannot mutate the read-only target', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
  const packageBefore = fs.readFileSync(path.join(target, 'package.json'), 'utf8')
  writeGeneratedTest(target, artifact, `
import fs from 'node:fs'
test('cannot rewrite trusted target inputs', () => { fs.writeFileSync('package.json', '{"tampered":true}') })
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'fail')
    assert.equal(fs.readFileSync(path.join(target, 'package.json'), 'utf8'), packageBefore)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated tests reject a fictional package-script command instead of attesting it', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
  writeGeneratedTest(target, artifact, `test('would pass', () => expect(true).toBe(true))\n`)
  const step = generatedTestStep('OMH-163', 'jest', artifact, 'none')
  step.command = `yarn test --runInBand --runTestsByPath ${artifact}`
  try {
    const result = release.runGeneratedTestStep({ step, target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError, /fixed direct controller contract/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated Jest evidence rejects zero-exit skipped and todo tests from the runtime report', { skip: !targetSandboxAvailable }, () => {
  for (const [label, source] of [
    ['skipped', "test.skip('disabled', () => expect(true).toBe(true))\ntest('enabled', () => expect(true).toBe(true))\n"],
    ['todo', "test.todo('later')\ntest('enabled', () => expect(true).toBe(true))\n"],
  ] as const) {
    const target = stageGeneratedTestTarget()
    const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
    writeGeneratedTest(target, artifact, source)
    try {
      const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 30_000, roots: [target] })
      assert.equal(result.status, 'fail', `${label} coverage was incorrectly accepted`)
      assert.match(result.sanitizedError, /zero failed, skipped, todo, or expected-failure tests/)
    } finally { fs.rmSync(target, { recursive: true, force: true }) }
  }
})

test('generated API Playwright tests can use isolated loopback but cannot reach an external address', { skip: !isolatedLoopbackAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/customer_api/__integration__/TC-API-CUSTOMERS-001.spec.ts'
  writeGeneratedTest(target, artifact, `
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
test('loopback only', async ({ request }) => {
  const server = createServer((_request, response) => response.end('ok'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    expect(await (await request.get('http://127.0.0.1:' + address.port)).text()).toBe('ok')
    await expect(request.get('http://1.1.1.1', { timeout: 500 })).rejects.toThrow()
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-164', 'playwright-api', artifact, 'loopback'), target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'pass', result.sanitizedError)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated browser Playwright tests launch the exact bounded headless runtime', { skip: !browserRuntimeLaunchable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts'
  writeGeneratedTest(target, artifact, `
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
test('real browser', async ({ page }) => {
  const server = createServer((_request, response) => response.end('<button>Approve quote</button><p role="status">Ready</p>'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    await page.goto('http://127.0.0.1:' + address.port)
    await expect(page.getByRole('button', { name: 'Approve quote' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Ready')
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-165', 'playwright-browser', artifact, 'loopback'), target, timeout: 45_000, roots: [target] })
    assert.equal(result.status, 'pass', result.sanitizedError)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated Playwright evidence rejects skipped and expected-failure tests even when the runner exits zero', { skip: !isolatedLoopbackAvailable }, () => {
  for (const [label, body] of [
    ['skipped', "test.skip(true, 'disabled')"],
    ['expected failure', "test.fail(); throw new Error('expected failure')"],
  ] as const) {
    const target = stageGeneratedTestTarget()
    const artifact = 'src/modules/customer_api/__integration__/TC-API-CUSTOMERS-001.spec.ts'
    writeGeneratedTest(target, artifact, `
import { expect, test } from '@playwright/test'
test(${JSON.stringify(label)}, async () => { ${body}; expect(true).toBe(true) })
`)
    try {
      const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-164', 'playwright-api', artifact, 'loopback'), target, timeout: 30_000, roots: [target] })
      assert.equal(result.status, 'fail', `${label} coverage was incorrectly accepted`)
      assert.match(result.sanitizedError, /zero skipped, focused, flaky, unexpected, or expected-failure tests/)
    } finally { fs.rmSync(target, { recursive: true, force: true }) }
  }
})

test('generated-test execution fails closed for missing runtimes and browser prerequisites', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts'
  writeGeneratedTest(target, artifact, "import { test } from '@playwright/test'; test('x', async () => {})\n")
  try {
    const browserFailure = release.runGeneratedTestStep({
      step: generatedTestStep('OMH-165', 'playwright-browser', artifact, 'loopback'), target, timeout: 10_000, roots: [target],
      browserRuntimeResolver: () => { throw new Error('browser runtime absent') },
    })
    assert.equal(browserFailure.status, 'fail')
    assert.match(browserFailure.sanitizedError, /browser runtime absent/)
    fs.rmSync(path.join(target, 'node_modules'), { recursive: true, force: true })
    fs.mkdirSync(path.join(target, 'node_modules'))
    const runtimeFailure = release.runGeneratedTestStep({
      step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 10_000, roots: [target],
    })
    assert.equal(runtimeFailure.status, 'fail')
    assert.match(runtimeFailure.sanitizedError, /Cannot find module|CLI/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('the suite-level dependency fingerprint detects nested package file mutations', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-dependency-fingerprint-')))
  const nested = path.join(root, 'node_modules', 'example', 'lib', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n')
  fs.writeFileSync(nested, 'original\n')
  try {
    const before = release.dependencyContentFingerprint(root)
    fs.writeFileSync(nested, 'mutated\n')
    const after = release.dependencyContentFingerprint(root)
    assert.notEqual(after, before)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone template exposes the documented one-command release entrypoint', () => {
  const template = JSON.parse(fs.readFileSync(new URL('../../template/package.json.template', import.meta.url), 'utf8'))
  assert.equal(template.scripts['harness:release'], 'node ./scripts/run-agent-harness-release.mjs')
})

test('release command requires one explicit primary runner and rejects a duplicate portability runner', () => {
  const missing = spawnSync(process.execPath, [
    releaseScript, '--prepare-targets', path.join(os.tmpdir(), 'om-release-unused-targets'), '--acknowledge-writes',
  ], { encoding: 'utf8' })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /--runner must be codex or claude/)

  const duplicate = spawnSync(process.execPath, [
    releaseScript, '--runner', 'codex', '--portability-runner', 'codex',
    '--prepare-targets', path.join(os.tmpdir(), 'om-release-unused-targets'), '--acknowledge-writes',
  ], { encoding: 'utf8' })
  assert.equal(duplicate.status, 2)
  assert.match(duplicate.stderr, /must differ/)
})

test('release preflight names newly writable business coverage instead of assuming a fixed matrix size', () => {
  const input = releaseInputs()
  input.cases.push({
    id: 'OMH-004', family: 'business', mode: 'one-shot', evaluationKind: 'implementation',
    fixture: { scaffold: 'fresh-standalone', setup: ['fixture:missing-business'] },
    oracle: { validatorIds: [], expectedArtifacts: [] },
  })
  input.registry.catalog.expectedCaseCount = 4
  const plan = release.buildReleasePlan(input)
  assert.deepEqual(plan.coverage.writable.expectedCaseIds, ['OMH-002', 'OMH-003', 'OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingMatrixCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingTargetCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingFixtureCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingOracleCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.review.missingMatrixCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.registry.missingWritableCaseIds, ['OMH-004'])
  assert.ok(plan.violations.every((entry: string) => entry.includes('OMH-004') || entry.includes('live routing')
    || entry.includes('exactly once in catalog order') || entry.includes('exact writable case set')))
})

test('release preflight requires the reusable judge and explicit om-code-review gate', () => {
  const input = releaseInputs()
  input.releaseMatrix.generativeJudge.reviewSkill = 'generic-review'
  const plan = release.buildReleasePlan(input)
  assert.ok(plan.violations.includes('generative judge must explicitly compose om-code-review'))
})

test('quality metrics expose first-pass, correction, context, review, and categorized misuse rates', () => {
  const metrics = release.aggregateQualityMetrics([
    { status: 'pass', attempts: 1, corrections: 0, violations: [], actualContext: { estimatedTokens: 100, estimatedInitialTokens: 40 } },
    { status: 'pass', attempts: 2, corrections: 1, violations: ['unsafe out-of-root context read'], actualContext: { estimatedTokens: 300, estimatedInitialTokens: 80 } },
    { status: 'fail', attempts: 1, corrections: 0, violations: ['missing route module-data'], verdict: 'request changes', actualContext: { estimatedTokens: 200, estimatedInitialTokens: 60 } },
  ])
  assert.deepEqual(metrics.outcomes, { results: 3, passed: 2, failed: 1 })
  assert.deepEqual(metrics.firstPass, { eligibleResults: 3, passedFirstPass: 1, ratePct: 33.33 })
  assert.deepEqual(metrics.corrections, { total: 1, resultsWithCorrections: 1, ratePct: 33.33 })
  assert.equal(metrics.context.averageEstimatedTokens, 200)
  assert.equal(metrics.context.p95EstimatedTokens, 300)
  assert.deepEqual(metrics.misuse.byCategory, { safety: 1, contract: 1, execution: 0, quality: 0 })
  assert.equal(metrics.reviewVerdicts.requestChanges, 1)
})

test('release command fails closed before execution and stores a sanitized exact coverage report', { skip: !targetSandboxAvailable }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-controller-')))
  const harness = path.join(root, '.ai', 'harness')
  fs.mkdirSync(path.join(harness, 'fixtures'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  const input = releaseInputs()
  input.targetsManifest = { schemaVersion: 1, targets: {} }
  fs.writeFileSync(path.join(harness, 'cases.json'), JSON.stringify(input.cases))
  fs.writeFileSync(path.join(harness, 'validators.json'), JSON.stringify(input.registry))
  fs.writeFileSync(path.join(harness, 'release-matrix.json'), JSON.stringify(input.releaseMatrix))
  fs.copyFileSync(releaseSchema, path.join(harness, 'release-result.schema.json'))
  fs.copyFileSync(targetValidationSchema, path.join(harness, 'target-validation-result.schema.json'))
  fs.writeFileSync(path.join(harness, 'fixtures', 'index.json'), JSON.stringify(input.fixtures))
  fs.writeFileSync(path.join(harness, 'fixtures', 'seeds.json'), JSON.stringify(input.seeds))
  const targetsPath = path.join(root, 'targets-secret.json')
  fs.writeFileSync(targetsPath, JSON.stringify(input.targetsManifest))
  try {
    const run = spawnSync(process.execPath, [
      releaseScript, '--root', root, '--runner', 'codex', '--writable-targets', targetsPath, '--acknowledge-writes',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stderr, /Release preflight failed/)
    const resultDirectory = path.join(harness, 'results')
    const [file] = fs.readdirSync(resultDirectory)
    const report = JSON.parse(fs.readFileSync(path.join(resultDirectory, file), 'utf8'))
    assert.equal(report.status, 'fail')
    assert.deepEqual(report.runnerPolicy, { primaryRunner: 'codex', portabilityRunner: null })
    assert.deepEqual(report.coverage.writable.missingTargetCaseIds, ['OMH-002', 'OMH-003'])
    assert.deepEqual(report.steps, [])
    assert.equal(report.metrics.outcomes.results, 0)
    assert.equal(fs.statSync(path.join(resultDirectory, file)).mode & 0o077, 0)
    assert.doesNotMatch(JSON.stringify(report), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('persisted foundation process diagnostics use a minimal environment and redact environment scalars plus URL userinfo', { skip: !targetSandboxAvailable }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-foundation-redaction-')))
  const harness = path.join(root, '.ai', 'harness')
  const fakeBin = path.join(root, 'fake-bin')
  const scalar = 'foundation-provider-secret-must-not-persist'
  const databaseUrl = 'postgres://foundation-user:foundation-password@db.example.test:5432/app'
  fs.mkdirSync(path.join(harness, 'fixtures'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.mkdirSync(fakeBin)
  const input = releaseInputs()
  const targets: Record<string, string> = {}
  for (const caseId of ['OMH-002', 'OMH-003']) {
    const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `om-release-foundation-${caseId}-`)))
    fs.mkdirSync(path.join(target, 'src'), { recursive: true })
    fs.mkdirSync(path.join(target, '.ai', 'harness'), { recursive: true })
    fs.writeFileSync(path.join(target, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(target, 'src', 'modules.ts'), 'export default []\n')
    fs.writeFileSync(path.join(target, '.ai', 'harness', 'cases.json'), '[]\n')
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    targets[caseId] = target
  }
  input.targetsManifest = { schemaVersion: 1, targets }
  fs.writeFileSync(path.join(harness, 'cases.json'), JSON.stringify(input.cases))
  fs.writeFileSync(path.join(harness, 'validators.json'), JSON.stringify(input.registry))
  fs.writeFileSync(path.join(harness, 'release-matrix.json'), JSON.stringify(input.releaseMatrix))
  fs.copyFileSync(releaseSchema, path.join(harness, 'release-result.schema.json'))
  fs.copyFileSync(targetValidationSchema, path.join(harness, 'target-validation-result.schema.json'))
  fs.writeFileSync(path.join(harness, 'fixtures', 'index.json'), JSON.stringify(input.fixtures))
  fs.writeFileSync(path.join(harness, 'fixtures', 'seeds.json'), JSON.stringify(input.seeds))
  const reviewFiles = [
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
  for (const relative of reviewFiles) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), '{}\n')
  }
  fs.writeFileSync(path.join(root, 'scripts', 'evaluate-agent-harness.mjs'), `
if (process.env.FAKE_PROVIDER_SECRET || process.env.DATABASE_URL) process.exit(21)
console.error(${JSON.stringify(`${scalar} ${databaseUrl}`)})
console.log('PASS OMH-001\\nPASS OMH-002\\nPASS OMH-003')
`)
  const fakeYarn = path.join(fakeBin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
if (process.env.FAKE_PROVIDER_SECRET || process.env.DATABASE_URL) process.exit(22)
console.error(${JSON.stringify(`${scalar} ${databaseUrl}`)})
if (process.argv[2] === 'lint') process.exit(7)
`)
  fs.chmodSync(fakeYarn, 0o755)
  const targetsPath = path.join(root, 'targets.json')
  fs.writeFileSync(targetsPath, JSON.stringify(input.targetsManifest))
  try {
    const run = spawnSync(process.execPath, [
      releaseScript, '--root', root, '--runner', 'codex', '--writable-targets', targetsPath, '--acknowledge-writes',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_PROVIDER_SECRET: scalar,
        DATABASE_URL: databaseUrl,
      },
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const resultDirectory = path.join(harness, 'results')
    const reportFile = fs.readdirSync(resultDirectory).find((entry) => entry.endsWith('-release-suite.json'))
    assert.ok(reportFile)
    const reportText = fs.readFileSync(path.join(resultDirectory, reportFile), 'utf8')
    const report = JSON.parse(reportText)
    assert.equal(report.steps.find((step: any) => step.id === 'deterministic:all').status, 'pass')
    assert.equal(report.steps.find((step: any) => step.id === 'validation:lint').exitStatus, 7)
    assert.doesNotMatch(reportText, /foundation-provider-secret|foundation-user|foundation-password/)
    assert.match(reportText, /postgres:\/\/<redacted-secret>@db\.example\.test/)
  } finally {
    for (const target of Object.values(targets)) fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('release sanitization removes controller paths, environment scalars, URL userinfo, and common secret forms', () => {
  const root = path.join(os.tmpdir(), 'sensitive-release-root')
  const scalar = 'fake-provider-value-which-must-not-persist'
  const previous = process.env.FAKE_PROVIDER_SECRET
  process.env.FAKE_PROVIDER_SECRET = scalar
  try {
    const sanitized = release.sanitizeReportText([
      root,
      'token=abc123supersecret',
      'ghp_1234567890abcdefghij',
      scalar,
      'postgres://database-user:database-password@db.example.test:5432/app',
      'https://http-user:http-password@example.test/private',
    ].join(' '), [root])
    assert.doesNotMatch(sanitized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(sanitized, /abc123supersecret|ghp_1234567890abcdefghij|fake-provider-value|database-user|database-password|http-user|http-password/)
    assert.match(sanitized, /postgres:\/\/<redacted-secret>@db\.example\.test/)
    assert.match(sanitized, /https:\/\/<redacted-secret>@example\.test/)
  } finally {
    if (previous === undefined) delete process.env.FAKE_PROVIDER_SECRET
    else process.env.FAKE_PROVIDER_SECRET = previous
  }
})
