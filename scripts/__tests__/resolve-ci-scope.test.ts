import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  CiScopeError,
  SCOPE_CONTROL_PATHS,
  extractChangedModules,
  globToRegExp,
  isScopeLabel,
  parseCiScopeConfig,
  resolveCiScope,
  type CiScopeConfig,
  type CiScopeInput,
} from '../ci/resolve-ci-scope.mts'
import { REPOSITORY, runCiScopeStep, scopeStep } from './fixtures/ci-scope-step.mjs'

type RealPr = {
  number: number
  title: string
  headRef: string
  isFork: boolean
  labels: string[]
  files: string[]
}

type Expected = { level: string; modules: string[]; skip: boolean; lane?: 'code' | 'docs' }

const readJson = (relative: string): unknown => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'))

const rawConfig = readJson('../../.github/ci-scope.json') as Record<string, unknown>
const schema = readJson('../../.github/ci-scope.schema.json') as { required: string[]; properties: Record<string, unknown> }
const config: CiScopeConfig = parseCiScopeConfig(rawConfig)
const realPrs = readJson('./fixtures/resolve-ci-scope-prs.json') as RealPr[]

const legacyScopeScript = fs.readFileSync(new URL('./fixtures/legacy-prepare-scope.sh', import.meta.url), 'utf8')
const FULL_SHARDS = Array.from({ length: 15 }, (_, index) => `${index + 1}/15`)

function todayForcesFullSuite(input: CiScopeInput): boolean {
  return (input.event ?? 'pull_request') === 'pull_request' && !input.isFork && (input.headRef.toLowerCase().startsWith('stabilize/') || input.labels.some((label) => label.toLowerCase() === 'ci-full'))
}

const gnuGrepAvailable = spawnSync('bash', ['-c', "echo packages/a/src/modules/b/x | grep -oP 'src/modules/\\K[^/]+'"], { encoding: 'utf8' }).stdout.trim() === 'b'

function runTodayPrepareScope(input: CiScopeInput): Expected {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ci-scope-'))
  try {
    const output = path.join(directory, 'output')
    const script = `git() { printf '%s\\n' "$CHANGED_LIST"; }\n${legacyScopeScript.replaceAll('${{ github.event_name }}', input.event ?? 'pull_request')}`
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        FORCE_FULL_SUITE: String(todayForcesFullSuite(input)),
        CHANGED_LIST: input.changedFiles.join('\n'),
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }))
    const full = JSON.stringify(JSON.parse(values.shard_matrix)) === JSON.stringify(FULL_SHARDS)
    return {
      level: full ? 'full' : 'scoped',
      modules: values.modules ? values.modules.split(',') : [],
      skip: values.skip === 'true',
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function resolve(overrides: Partial<CiScopeInput> & { changedFiles: string[] }) {
  return resolveCiScope({ labels: [], headRef: 'fix/example', baseRef: 'main', isFork: false, ...overrides }, config)
}

function assertParity(input: CiScopeInput, expected: Expected, t: { skip: (message: string) => void }) {
  const result = resolveCiScope(input, config)
  assert.equal(result.level, expected.level, result.summary)
  assert.deepEqual(result.modules, expected.modules)
  assert.equal(result.skipIntegration, expected.skip)
  if (expected.lane) assert.equal(result.lane, expected.lane)
  if (!gnuGrepAvailable) {
    t.skip('GNU grep -P unavailable: compared against the recorded expectation only')
    return
  }
  assert.deepEqual(runTodayPrepareScope(input), { level: expected.level, modules: expected.modules, skip: expected.skip })
}

function runWorkflowStep(input: CiScopeInput) {
  return runCiScopeStep({
    eventName: input.event ?? 'pull_request',
    changedFiles: [...input.changedFiles],
    labels: [...input.labels],
    headRef: input.headRef,
    baseRef: input.baseRef,
    headRepo: input.isFork ? 'contributor/open-mercato' : REPOSITORY,
  })
}

function assertWorkflowStep(input: CiScopeInput, expected: Expected) {
  const step = runWorkflowStep(input)
  assert.equal(step.status, 0, step.stderr)
  assert.deepEqual(
    { level: step.full ? 'full' : 'scoped', modules: step.values.modules ? step.values.modules.split(',') : [], skip: step.values.skip === 'true' },
    { level: expected.level, modules: expected.modules, skip: expected.skip },
  )
  if (!step.full) assert.deepEqual(JSON.parse(step.values.shard_matrix), ['none'])
  const summaryLines = step.summary.trim().split('\n')
  assert.equal(summaryLines.length, 1, step.summary)
  assert.match(summaryLines[0], new RegExp(`^CI scope: ${expected.level} · `))
  return step
}

test('ci-scope.json parses and matches its schema keys', () => {
  const keys = Object.keys(rawConfig).filter((key) => key !== '$schema').sort()
  assert.deepEqual(keys, [...schema.required].sort())
  assert.deepEqual(Object.keys(schema.properties).filter((key) => key !== '$schema').sort(), keys)
  assert.equal(config.default, 'scoped')
  assert.deepEqual(config.levels, ['ci-targeted', 'ci-full'])
})

test('fullSuitePatterns are exactly FULL_SUITE_PATTERN from the pre-resolver prepare job', () => {
  const match = /FULL_SUITE_PATTERN='([^']+)'/.exec(legacyScopeScript)
  assert.ok(match, 'FULL_SUITE_PATTERN not found in the frozen pre-resolver script')
  assert.equal(config.fullSuitePatterns.join('|'), match[1])
})

test('the prepare job no longer carries inline scope rules', () => {
  const run = String(scopeStep.run)
  assert.doesNotMatch(run, /FULL_SUITE_PATTERN|FORCE_FULL_SUITE|\$\{\{/)
  assert.equal(scopeStep.env.FORCE_FULL_SUITE, undefined)
})

test('the prepare job loads the resolver and scope file from the PR base commit, not the checkout', () => {
  const run = String(scopeStep.run)
  assert.equal(scopeStep.env.BASE_SHA, '${{ github.event.pull_request.base.sha }}')
  assert.match(run, /git show "\$\{SCOPE_SOURCE\}:\$\{RESOLVER_PATH\}"/)
  assert.match(run, /git show "\$\{SCOPE_SOURCE\}:\$\{SCOPE_FILE_PATH\}"/)
  assert.match(run, /RESOLVER_PATH=scripts\/ci\/resolve-ci-scope\.mts\n/)
  assert.match(run, /SCOPE_FILE_PATH=\.github\/ci-scope\.json\n/)
  assert.doesNotMatch(run, /\.\/scripts\/ci\/resolve-ci-scope|import .*['"]\.\.?\/scripts/)
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/sales/a.ts'] })
  assert.equal(step.status, 0, step.stderr)
  assert.ok(step.calls.includes('git show base-sha:scripts/ci/resolve-ci-scope.mts'), step.calls.join('\n'))
  assert.ok(step.calls.includes('git show base-sha:.github/ci-scope.json'), step.calls.join('\n'))
  assert.ok(!step.calls.some((call) => call.startsWith('git fetch')), step.calls.join('\n'))
})

test('a base that predates the scope rules uses the default branch copy and says so', () => {
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/sales/a.ts'], baseRef: 'release/v0.10.x', scopeRulesAtBase: false })
  assert.equal(step.status, 0, step.stderr)
  assert.ok(step.calls.includes('git fetch --no-tags --depth=1 origin refs/heads/main'), step.calls.join('\n'))
  assert.ok(step.calls.includes('git show default-branch-tip:scripts/ci/resolve-ci-scope.mts'), step.calls.join('\n'))
  assert.equal(step.values.modules, 'sales')
  assert.equal(step.summary, 'CI scope: scoped · sales (changed) · scope rules from main (base release/v0.10.x predates them)\n')
})

test('the step env maps every input from the event, so fork detection compares the real head and base repos', () => {
  assert.deepEqual(scopeStep.env, {
    EVENT_NAME: '${{ github.event_name }}',
    GH_TOKEN: '${{ github.token }}',
    REPOSITORY: '${{ github.repository }}',
    DEFAULT_BRANCH: '${{ github.event.repository.default_branch }}',
    PR_NUMBER: '${{ github.event.pull_request.number }}',
    BASE_SHA: '${{ github.event.pull_request.base.sha }}',
    BASE_REF: '${{ github.base_ref }}',
    HEAD_REF: '${{ github.head_ref }}',
    HEAD_REPO: '${{ github.event.pull_request.head.repo.full_name }}',
  })
})

test('a fork PR is detected from HEAD_REPO and keeps its scope despite ci-full', () => {
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/catalog/a.ts'], labels: ['ci-full'], headRepo: 'contributor/open-mercato' })
  assert.equal(step.status, 0, step.stderr)
  assert.equal(step.full, false)
  assert.equal(step.values.modules, 'catalog')
})

test('a base commit missing from the shallow checkout is fetched by SHA before the scope files are read', () => {
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/sales/a.ts'], baseCommitPresent: false })
  assert.equal(step.status, 0, step.stderr)
  const fetchIndex = step.calls.indexOf('git fetch --no-tags --depth=1 origin base-sha')
  assert.ok(fetchIndex >= 0, step.calls.join('\n'))
  assert.ok(step.calls.indexOf('git show base-sha:scripts/ci/resolve-ci-scope.mts') > fetchIndex, step.calls.join('\n'))
  assert.equal(step.values.modules, 'sales')
})

test('a failing fetch of the base commit fails the step without running the resolver', () => {
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/sales/a.ts'], baseCommitPresent: false, fetchFails: true })
  assert.notEqual(step.status, 0)
  assert.ok(step.calls.includes('git fetch --no-tags --depth=1 origin base-sha'), step.calls.join('\n'))
  assert.ok(!step.calls.some((call) => call.startsWith('git show')), step.calls.join('\n'))
  assert.deepEqual(step.values, {})
  assert.equal(step.summary, '')
})

test('an empty diff runs the full suite in the step (the pre-resolver script skipped integration)', (t) => {
  const step = runCiScopeStep({ changedFiles: [] })
  assert.equal(step.status, 0, step.stderr)
  assert.equal(step.full, true)
  assert.equal(step.values.skip, 'false')
  assert.equal(step.values.modules, '')
  assert.match(step.summary, /^CI scope: full · no changed files reported/)
  if (!gnuGrepAvailable) return t.skip('GNU grep -P unavailable: pre-resolver comparison skipped')
  assert.deepEqual(runTodayPrepareScope({ changedFiles: [], labels: [], headRef: 'fix/example', baseRef: 'main', isFork: false }), { level: 'scoped', modules: [], skip: true })
})

test('risk-high on a same-repo scripts-only PR runs the full suite in the step (the pre-resolver script skipped integration)', (t) => {
  const input: CiScopeInput = { changedFiles: ['scripts/dev.mjs', 'package.json'], labels: ['risk-high'], headRef: 'fix/example', baseRef: 'main', isFork: false }
  const step = runCiScopeStep({ changedFiles: [...input.changedFiles], labels: [...input.labels] })
  assert.equal(step.status, 0, step.stderr)
  assert.equal(step.full, true)
  assert.deepEqual(JSON.parse(step.values.shard_matrix), FULL_SHARDS)
  assert.match(step.summary, /^CI scope: full · .*label risk-high implies ci-targeted; targeted requested but no module changed and no ci-area label/)
  if (!gnuGrepAvailable) return t.skip('GNU grep -P unavailable: pre-resolver comparison skipped')
  assert.deepEqual(runTodayPrepareScope(input), { level: 'scoped', modules: [], skip: true })
})

test('the prepare job reads labels from the API at job time, not from the event payload', () => {
  assert.doesNotMatch(JSON.stringify(scopeStep), /pull_request\.labels/)
  const step = runCiScopeStep({ changedFiles: ['README.md'], labels: ['ci-full'] })
  assert.equal(step.status, 0, step.stderr)
  assert.ok(step.calls.includes(`gh api repos/${REPOSITORY}/pulls/4242 --jq .labels[].name`), step.calls.join('\n'))
  assert.equal(step.full, true)
  assert.equal(step.summary, 'CI scope: full · label ci-full\n')
})

test('push events run the full suite without the diff, the API or the resolver', () => {
  const step = runCiScopeStep({ eventName: 'push' })
  assert.equal(step.status, 0, step.stderr)
  assert.equal(step.full, true)
  assert.equal(step.values.skip, 'false')
  assert.equal(step.values.modules, '')
  assert.deepEqual(step.calls, [])
  assert.equal(step.summary, 'CI scope: full · push event\n')
})

test('the prepare job turns area labels into a single-runner module list', () => {
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['ci-area:portal', 'bug'] })
  assert.equal(step.status, 0, step.stderr)
  assert.equal(step.values.skip, 'false')
  assert.equal(step.values.modules, 'customer_accounts,portal,sales')
  assert.deepEqual(JSON.parse(step.values.shard_matrix), ['none'])
  assert.equal(step.summary, 'CI scope: targeted · sales (changed) + portal area (label)\n')
})

test('an unknown ci-* label fails the prepare job with a clear error and summary', () => {
  const step = runCiScopeStep({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['ci-fulll'] })
  assert.notEqual(step.status, 0)
  assert.match(step.stdout, /::error title=CI scope::Unknown CI label "ci-fulll"/)
  assert.match(step.summary, /^CI scope: error · Unknown CI label "ci-fulll"/)
  assert.equal(step.values.shard_matrix, undefined)
})

test('a failing diff fails the prepare job before the API or the resolver runs', () => {
  const step = runCiScopeStep({ diffFails: true })
  assert.notEqual(step.status, 0)
  assert.deepEqual(step.calls, ['git diff --name-only HEAD^1 HEAD'])
  assert.deepEqual(step.values, {})
  assert.equal(step.summary, '')
})

test('docsOnly is an allow-list without blanket markdown and covers apps/docs mdx', () => {
  assert.ok(!config.docsOnly.includes('**/*.md'))
  assert.ok(!config.docsOnly.includes('**/*'))
  assert.ok(config.docsOnly.includes('apps/docs/**'))
  assert.deepEqual(
    [...config.docsOnly].sort(),
    ['.ai/docs/**/*.md', '.ai/specs/**/*.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'README.md', 'apps/docs/**'],
  )
})

test('implies covers risk-high, security and backport labels', () => {
  assert.deepEqual(config.implies, { 'risk-high': 'ci-targeted', security: 'ci-targeted', 'backport *': 'ci-targeted' })
})

const REAL_PR_EXPECTATIONS: Record<number, Expected> = {
  10756: { level: 'scoped', modules: [], skip: true, lane: 'docs' },
  10745: { level: 'scoped', modules: ['customer_accounts'], skip: false, lane: 'code' },
  10731: { level: 'full', modules: [], skip: false },
  10718: { level: 'scoped', modules: ['wms'], skip: false, lane: 'code' },
  10713: { level: 'full', modules: [], skip: false },
  10674: { level: 'scoped', modules: [], skip: true, lane: 'code' },
  10658: { level: 'scoped', modules: [], skip: true, lane: 'code' },
  10653: { level: 'scoped', modules: ['workflows'], skip: false },
  10629: { level: 'full', modules: [], skip: false },
  10579: { level: 'full', modules: [], skip: false },
  10524: { level: 'full', modules: [], skip: false },
  10509: { level: 'full', modules: [], skip: false },
  10477: { level: 'scoped', modules: [], skip: true, lane: 'code' },
  10637: { level: 'scoped', modules: ['ai_assistant'], skip: false, lane: 'code' },
  10572: { level: 'scoped', modules: [], skip: true },
}

test('every real-PR fixture has an expectation', () => {
  assert.deepEqual(realPrs.map((pr) => pr.number).sort(), Object.keys(REAL_PR_EXPECTATIONS).map(Number).sort())
})

for (const pr of realPrs) {
  test(`parity with today's prepare job: real PR #${pr.number} (${pr.title})`, (t) => {
    const input: CiScopeInput = {
      changedFiles: pr.files,
      labels: pr.labels.filter((label) => label === 'ci-full'),
      headRef: pr.headRef,
      baseRef: 'main',
      isFork: pr.isFork,
    }
    assertParity(input, REAL_PR_EXPECTATIONS[pr.number], t)
    assertWorkflowStep(input, REAL_PR_EXPECTATIONS[pr.number])
  })
}

const SYNTHETIC_PARITY: Array<[string, CiScopeInput, Expected]> = [
  ['ci.yml change', { changedFiles: ['.github/workflows/ci.yml'], labels: [], headRef: 'fix/ci', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['other workflow change', { changedFiles: ['.github/workflows/release.yml'], labels: [], headRef: 'fix/ci', baseRef: 'main', isFork: false }, { level: 'scoped', modules: [], skip: true }],
  ['shared lib', { changedFiles: ['packages/shared/src/lib/example.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['core lib', { changedFiles: ['packages/core/src/lib/x.ts', 'packages/core/src/modules/sales/a.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['enterprise lib', { changedFiles: ['packages/enterprise/src/lib/x.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['cli testing harness', { changedFiles: ['packages/cli/src/lib/testing/runner.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['app shell layout', { changedFiles: ['apps/mercato/src/layout.tsx'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['app shell prefix quirk', { changedFiles: ['apps/mercato/src/application.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['app module', { changedFiles: ['apps/mercato/src/modules/example/index.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'scoped', modules: ['example'], skip: false }],
  ['fork touching shared code', { changedFiles: ['packages/ui/src/x.tsx'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: true }, { level: 'full', modules: [], skip: false }],
  ['several modules across packages', {
    changedFiles: [
      'packages/core/src/modules/sales/api/orders.ts',
      'packages/core/src/modules/customers/api/people.ts',
      'packages/core/src/modules/customer_accounts/index.ts',
      'packages/enterprise/src/modules/sso/setup.ts',
      'packages/gateway-stripe/src/modules/gateway_stripe/index.ts',
      'packages/core/src/modules/sales/data/entities.ts',
    ],
    labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false,
  }, { level: 'scoped', modules: ['customer_accounts', 'customers', 'gateway_stripe', 'sales', 'sso'], skip: false }],
  ['file directly under modules/', { changedFiles: ['packages/enterprise/src/modules/security.ts'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'scoped', modules: ['security.ts'], skip: false }],
  ['scripts only', { changedFiles: ['scripts/dev.mjs', 'package.json'], labels: [], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'scoped', modules: [], skip: true }],
  ['stabilize/ head on a same-repo PR', { changedFiles: ['README.md'], labels: [], headRef: 'stabilize/main-2026-11-26', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['stabilize/ head on a fork PR', { changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: [], headRef: 'stabilize/main-2026-11-26', baseRef: 'main', isFork: true }, { level: 'scoped', modules: ['sales'], skip: false }],
  ['stabilize in the middle of a branch name', { changedFiles: ['scripts/a.mjs'], labels: [], headRef: 'fix/stabilize/main', baseRef: 'main', isFork: false }, { level: 'scoped', modules: [], skip: true }],
  ['ci-full on a same-repo PR', { changedFiles: ['README.md'], labels: ['ci-full'], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['CI-Full label on a same-repo PR (contains() ignores case)', { changedFiles: ['README.md'], labels: ['CI-Full'], headRef: 'fix/a', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['Stabilize/ head on a same-repo PR (startsWith() ignores case)', { changedFiles: ['scripts/a.mjs'], labels: [], headRef: 'Stabilize/main-2026-11-26', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['STABILIZE/ head on a fork PR is not forced', { changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: [], headRef: 'STABILIZE/main', baseRef: 'main', isFork: true }, { level: 'scoped', modules: ['sales'], skip: false }],
  ['ci-full on a fork PR is not forced', { changedFiles: ['packages/core/src/modules/catalog/a.ts'], labels: ['ci-full'], headRef: 'fix/a', baseRef: 'main', isFork: true }, { level: 'scoped', modules: ['catalog'], skip: false }],
  ['push event', { event: 'push', changedFiles: ['README.md'], labels: [], headRef: 'main', baseRef: 'main', isFork: false }, { level: 'full', modules: [], skip: false }],
  ['PR into a release line', { changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: [], headRef: 'backport/x', baseRef: 'release/v0.10.x', isFork: false }, { level: 'scoped', modules: ['sales'], skip: false }],
]

for (const [name, input, expected] of SYNTHETIC_PARITY) {
  test(`parity with today's prepare job: ${name}`, (t) => {
    assertParity(input, expected, t)
    assertWorkflowStep(input, expected)
  })
}

test('area label adds the area modules and implies targeted', () => {
  const result = resolve({ changedFiles: ['scripts/a.mjs'], labels: ['ci-area:portal'] })
  assert.equal(result.level, 'targeted')
  assert.deepEqual(result.areas, ['portal'])
  assert.deepEqual(result.modules, ['customer_accounts', 'portal'])
  assert.equal(result.skipIntegration, false)
  assert.equal(result.summary, 'targeted · portal area (label)')
})

test('area modules are unioned with changed modules', () => {
  const result = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts', 'packages/core/src/modules/catalog/b.ts'], labels: ['ci-area:crm', 'bug'] })
  assert.equal(result.level, 'targeted')
  assert.deepEqual(result.modules, [...new Set(['catalog', 'sales', ...config.areas.crm])].sort())
  assert.equal(result.summary, 'targeted · catalog, sales (changed) + crm area (label)')
})

test('ci-targeted without an area runs the affected modules', () => {
  const result = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['ci-targeted'] })
  assert.equal(result.level, 'targeted')
  assert.deepEqual(result.modules, ['sales'])
})

test('ci-full wins over ci-targeted and areas', () => {
  const result = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['ci-targeted', 'ci-area:crm', 'ci-full'] })
  assert.equal(result.level, 'full')
  assert.deepEqual(result.modules, [])
  assert.equal(result.skipIntegration, false)
})

for (const label of ['risk-high', 'security', 'backport release/v0.10.x', 'backport release/v0.9.x', 'backport main']) {
  test(`${label} implies targeted`, () => {
    const result = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: [label] })
    assert.equal(result.level, 'targeted')
    assert.deepEqual(result.modules, ['sales'])
    assert.ok(result.reasons.includes(`label ${label} implies ci-targeted`))
  })
}

for (const label of ['risk-medium', 'risk-low', 'backport', 'bug', 'priority-high', 'needs-qa']) {
  test(`${label} does not change the scope`, () => {
    const result = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: [label] })
    assert.equal(result.level, 'scoped')
    assert.equal(isScopeLabel(label, config), false)
  })
}

for (const [name, implies] of [
  ['narrow pattern first', { 'backport *': 'ci-targeted', 'backport release/*': 'ci-full' }],
  ['broad pattern first', { 'backport release/*': 'ci-full', 'backport *': 'ci-targeted' }],
] as const) {
  test(`overlapping implies patterns use the highest level (${name})`, () => {
    const overlapping = parseCiScopeConfig({ ...rawConfig, implies })
    const input: CiScopeInput = { changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['backport release/v0.10.x'], headRef: 'fix/a', baseRef: 'main', isFork: false }
    const result = resolveCiScope(input, overlapping)
    assert.equal(result.level, 'full')
    assert.deepEqual(result.modules, [])
    assert.ok(result.reasons.includes('label backport release/v0.10.x implies ci-full'), result.reasons.join('; '))
    const narrower = resolveCiScope({ ...input, labels: ['backport main'] }, overlapping)
    assert.equal(narrower.level, 'targeted')
    assert.deepEqual(narrower.modules, ['sales'])
  })
}

test('labels do not raise the scope of a fork PR', () => {
  const result = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['ci-area:crm', 'risk-high', 'ci-targeted'], isFork: true })
  assert.equal(result.level, 'scoped')
  assert.deepEqual(result.modules, ['sales'])
  assert.ok(result.reasons.includes('fork PR: labels do not change the scope'))
})

test('real PR #10713 with its real security and backport labels still gets the full suite', () => {
  const pr = realPrs.find((candidate) => candidate.number === 10713)!
  const result = resolve({ changedFiles: pr.files, labels: pr.labels, headRef: pr.headRef })
  assert.equal(result.level, 'full')
})

test('real PR #10653 (fork) keeps its scope with real labels', () => {
  const pr = realPrs.find((candidate) => candidate.number === 10653)!
  const result = resolve({ changedFiles: pr.files, labels: pr.labels, headRef: pr.headRef, isFork: pr.isFork })
  assert.equal(result.level, 'scoped')
  assert.deepEqual(result.modules, ['workflows'])
})

test('ci-monitoring is a known non-scope label', () => {
  const result = resolve({ changedFiles: ['scripts/a.mjs'], labels: ['ci-monitoring'] })
  assert.equal(result.level, 'scoped')
  assert.equal(isScopeLabel('ci-monitoring', config), false)
})

for (const files of [
  ['.ai/specs/2026-11-25-example.md'],
  ['.ai/specs/implemented/2026-01-01-old.md'],
  ['.ai/specs/enterprise/2026-01-01-x.md'],
  ['.ai/docs/pr-workflow.md'],
  ['apps/docs/docs/framework/ai-assistant/agents.mdx'],
  ['apps/docs/docusaurus.config.ts'],
  ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md'],
]) {
  test(`docs lane for ${files.join(', ')}`, () => {
    const result = resolve({ changedFiles: files })
    assert.equal(result.lane, 'docs')
    assert.equal(result.level, 'scoped')
    assert.equal(result.skipIntegration, true)
  })
}

for (const files of [
  ['CHANGELOG.md'],
  ['UPGRADE_NOTES.md'],
  ['packages/create-app/AGENTS.md'],
  ['packages/core/README.md'],
  ['packages/core/src/modules/sales/AGENTS.md'],
  ['.ai/skills/om-auto-create-pr/SKILL.md'],
  ['.ai/runs/2026-11-25-stabilize-main.md'],
  ['.ai/specs/notes.txt'],
  ['docs/README.md'],
  ['README.md', 'scripts/dev.mjs'],
]) {
  test(`normal lane for ${files.length ? files.join(', ') : 'an empty diff'}`, () => {
    assert.equal(resolve({ changedFiles: files }).lane, 'code')
  })
}

test('an empty changed-file list escalates to full instead of skipping integration', () => {
  for (const isFork of [false, true]) {
    const result = resolve({ changedFiles: [], isFork })
    assert.equal(result.lane, 'code')
    assert.equal(result.level, 'full')
    assert.deepEqual(result.modules, [])
    assert.equal(result.skipIntegration, false)
    assert.match(result.summary, /no changed files reported/)
  }
})

for (const labels of [['security'], ['risk-high'], ['backport release/v0.10.x'], ['ci-targeted']]) {
  test(`${labels.join(', ')} with no module to scope to escalates to full`, () => {
    const result = resolve({ changedFiles: ['scripts/a.mjs', 'package.json'], labels })
    assert.equal(result.level, 'full')
    assert.deepEqual(result.modules, [])
    assert.equal(result.skipIntegration, false)
    assert.match(result.summary, /targeted requested but no module changed and no ci-area label/)
  })
}

test('security on a packages/core/src/lib change runs the full suite', () => {
  const result = resolve({ changedFiles: ['packages/core/src/lib/crypto.ts'], labels: ['security'] })
  assert.equal(result.level, 'full')
  assert.equal(result.skipIntegration, false)
})

test('a raised level with an area label keeps the targeted scope', () => {
  const result = resolve({ changedFiles: ['scripts/a.mjs'], labels: ['security', 'ci-area:portal'] })
  assert.equal(result.level, 'targeted')
  assert.deepEqual(result.modules, ['customer_accounts', 'portal'])
})

test('labels match case-insensitively, like GitHub contains()', () => {
  const targeted = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: ['CI-Targeted', 'CI-Area:Portal'] })
  assert.equal(targeted.level, 'targeted')
  assert.deepEqual(targeted.areas, ['portal'])
  assert.deepEqual(targeted.modules, ['customer_accounts', 'portal', 'sales'])
  for (const label of ['Security', 'RISK-HIGH', 'Backport release/v0.10.x']) {
    const implied = resolve({ changedFiles: ['packages/core/src/modules/sales/a.ts'], labels: [label] })
    assert.equal(implied.level, 'targeted', label)
    assert.ok(isScopeLabel(label, config), label)
  }
  assert.equal(resolve({ changedFiles: ['README.md'], labels: ['Ci-Full'] }).level, 'full')
  assert.equal(resolve({ changedFiles: ['scripts/a.mjs'], labels: ['CI-Monitoring'] }).level, 'scoped')
  assert.equal(isScopeLabel('CI-Monitoring', config), false)
  assert.throws(() => resolve({ changedFiles: ['scripts/a.mjs'], labels: ['CI-Area:Nope'] }), /"CI-Area:Nope"/)
})

test('docs-only change with a level label takes the normal lane', () => {
  const result = resolve({ changedFiles: ['.ai/specs/x.md'], labels: ['ci-full'] })
  assert.equal(result.level, 'full')
  assert.equal(result.lane, 'code')
})

for (const file of SCOPE_CONTROL_PATHS) {
  for (const isFork of [false, true]) {
    test(`changing ${file} resolves to full (${isFork ? 'fork' : 'same-repo'} PR)`, () => {
      const result = resolve({ changedFiles: ['README.md', file], isFork })
      assert.equal(result.level, 'full')
      assert.equal(result.skipIntegration, false)
      assert.match(result.summary, /CI scope files changed/)
    })
  }
}

test('the scope control paths are the scope file, its schema and the resolver', () => {
  assert.deepEqual([...SCOPE_CONTROL_PATHS].sort(), ['.github/ci-scope.json', '.github/ci-scope.schema.json', 'scripts/ci/resolve-ci-scope.mts'])
  for (const file of SCOPE_CONTROL_PATHS) assert.ok(fs.existsSync(new URL(`../../${file}`, import.meta.url)), file)
})

for (const labels of [['ci-ful'], ['ci-area:sales'], ['ci-targetted', 'ci-area:nope']]) {
  test(`unknown ci label ${labels.join(', ')} is an error`, () => {
    assert.throws(
      () => resolve({ changedFiles: ['scripts/a.mjs'], labels }),
      (error: unknown) => {
        assert.ok(error instanceof CiScopeError)
        for (const label of labels) assert.ok(error.message.includes(`"${label}"`), error.message)
        assert.match(error.message, /Known ci-\* labels: ci-targeted, ci-full, ci-area:commerce/)
        assert.match(error.message, /\.github\/ci-scope\.json/)
        return true
      },
    )
  })
}

for (const label of ['ci-area:constructor', 'ci-area:toString', 'ci-area:__proto__', 'ci-area:hasOwnProperty']) {
  test(`area label ${label} naming an inherited Object property is an unknown label`, () => {
    assert.throws(() => resolve({ changedFiles: ['scripts/a.mjs'], labels: [label] }), (error: unknown) => {
      assert.ok(error instanceof CiScopeError)
      assert.ok(error.message.includes(`"${label}"`), error.message)
      return true
    })
  })
}

test('an unknown ci label is an error on a fork PR too', () => {
  assert.throws(() => resolve({ changedFiles: ['scripts/a.mjs'], labels: ['ci-fulll'], isFork: true }), CiScopeError)
})

function moduleDirectories(relativeDir: string): string[] {
  const directory = new URL(`../../${relativeDir}/`, import.meta.url)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

function areaOf(moduleId: string): string | undefined {
  return Object.entries(config.areas).find(([, modules]) => modules.includes(moduleId))?.[0]
}

test('every provider package module maps to an area', () => {
  const providerPackages = fs.readdirSync(new URL('../../packages/', import.meta.url)).filter((entry) => /^(channel|gateway|carrier|sync|storage)-/.test(entry))
  assert.ok(providerPackages.length > 0, 'no provider packages found')
  for (const entry of providerPackages) {
    const modules = moduleDirectories(`packages/${entry}/src/modules`)
    assert.ok(modules.length > 0, `packages/${entry} has no src/modules directory`)
    for (const moduleId of modules) assert.ok(areaOf(moduleId), `packages/${entry}: module ${moduleId} is in no ci-scope area`)
  }
})

test('every enterprise module maps to an area', () => {
  const modules = moduleDirectories('packages/enterprise/src/modules')
  assert.ok(modules.length > 0, 'no enterprise modules found')
  for (const moduleId of modules) assert.ok(areaOf(moduleId), `enterprise module ${moduleId} is in no ci-scope area`)
})

test('every area module is a real module directory', () => {
  const root = new URL('../../', import.meta.url)
  const known = new Set<string>()
  for (const base of ['packages', 'apps']) {
    for (const entry of fs.readdirSync(new URL(`${base}/`, root))) {
      const modulesDir = new URL(`${base}/${entry}/src/modules/`, root)
      if (fs.existsSync(modulesDir)) for (const moduleId of fs.readdirSync(modulesDir)) known.add(moduleId)
    }
  }
  for (const [area, modules] of Object.entries(config.areas)) {
    for (const moduleId of modules) assert.ok(known.has(moduleId), `${area}: ${moduleId} is not a module directory`)
  }
})

test('parseCiScopeConfig rejects a module in two areas', () => {
  assert.throws(() => parseCiScopeConfig({ ...rawConfig, areas: { a: ['sales'], b: ['sales'] } }), /"sales" is in both "a" and "b"/)
})

test('parseCiScopeConfig rejects implies to an unknown level', () => {
  assert.throws(() => parseCiScopeConfig({ ...rawConfig, implies: { 'risk-high': 'ci-huge' } }), /implies\["risk-high"\]/)
})

test('parseCiScopeConfig rejects unknown keys and bad regular expressions', () => {
  assert.throws(() => parseCiScopeConfig({ ...rawConfig, extra: true }), /unknown key "extra"/)
  assert.throws(() => parseCiScopeConfig({ ...rawConfig, fullSuitePatterns: ['^packages/(shared'] }), /not a valid regular expression/)
  assert.throws(() => parseCiScopeConfig({ ...rawConfig, default: 'fast' }), /"default" must be "scoped"/)
})

test('globToRegExp: ** spans directories, * stays in one segment', () => {
  assert.ok(globToRegExp('.ai/specs/**/*.md').test('.ai/specs/a.md'))
  assert.ok(globToRegExp('.ai/specs/**/*.md').test('.ai/specs/x/y/a.md'))
  assert.ok(!globToRegExp('.ai/specs/**/*.md').test('.ai/specs/a.mdx'))
  assert.ok(globToRegExp('apps/docs/**').test('apps/docs/a/b.mdx'))
  assert.ok(!globToRegExp('README.md').test('packages/core/README.md'))
  assert.ok(!globToRegExp('README.md').test('READMEXmd'))
})

test('extractChangedModules mirrors grep -oP over every path', () => {
  assert.deepEqual(
    extractChangedModules(['packages/core/src/modules/b/x.ts', 'apps/mercato/src/modules/a/y.ts', 'packages/core/src/lib/z.ts', 'packages/core/src/modules/b/w.ts']),
    ['a', 'b'],
  )
})
